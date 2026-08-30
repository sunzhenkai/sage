import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import multipart from '@fastify/multipart';
import { Type, type Static } from 'typebox';
import {
  compileSourcePackage,
  SourceArchiveError,
  SourcePackageError,
  serializeAgentPackageReleaseV1,
  sourceArchiveFilesRecord,
  unpackSourceArchive,
} from '@sage/agent-package-release';
import {
  ReleaseRegistryError,
  type AgentApp,
  type AgentReleaseStore,
  type ReleasePayload,
} from '@sage/agent-release-registry';
import type { AuthenticatedPrincipal } from '@sage/app-contracts';
import {
  extractAssetPreviews,
  extractManifestSummary,
  loadSourcePackageFromFiles,
} from './packages-api.js';

export interface AppsPrincipalAuthenticator {
  authenticateRequest?(request: FastifyRequest): Promise<AuthenticatedPrincipal | undefined> | AuthenticatedPrincipal | undefined;
}

export interface RegisterAppsRoutesOptions {
  readonly tenantId: string;
  readonly store: AgentReleaseStore;
  readonly ownerNamespace: string;
  /** pilot 强认证（5.1）：true 时 stub 信任头停止提权，仅 service token 主体被认可。 */
  readonly serviceTokenRequired?: boolean;
  readonly authenticator: AppsPrincipalAuthenticator;
  readonly engineIds?: readonly string[];
  readonly kernelContractMajor?: number;
}

const APP_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,126}[a-z0-9])?$/;

export const CreateAppRequestSchema = Type.Object({
  appId: Type.String({ minLength: 1, maxLength: 128, pattern: APP_ID_PATTERN.source }),
  name: Type.String({ minLength: 1, maxLength: 128 }),
  description: Type.Optional(Type.String({ maxLength: 2_048 }))
}, { additionalProperties: false });
export type CreateAppRequest = Static<typeof CreateAppRequestSchema>;

export const UploadAppReleaseRequestSchema = Type.Object({
  files: Type.Record(
    Type.String({ minLength: 1, maxLength: 512 }),
    Type.String({ minLength: 1, maxLength: 512 * 1024 })
  )
}, { additionalProperties: false });
export type UploadAppReleaseRequest = Static<typeof UploadAppReleaseRequestSchema>;

function sendError(reply: FastifyReply, status: number, code: string, message: string, retryable = false): FastifyReply {
  return reply.code(status).send({ error: { code, message, retryable } });
}

async function principalFor(request: FastifyRequest, options: RegisterAppsRoutesOptions): Promise<AuthenticatedPrincipal | undefined> {
  if (options.authenticator.authenticateRequest) return options.authenticator.authenticateRequest(request);
  if (options.serviceTokenRequired === true) return undefined;
  const auth = request.headers['x-authentication-id'];
  if (typeof auth === 'string' && auth.length > 0) {
    return { authenticationId: auth, principalId: auth, tenantId: options.tenantId, roles: ['package-registrar'] };
  }
  return undefined;
}

function unauthorized(reply: FastifyReply): FastifyReply {
  return sendError(reply, 401, 'APP_AUTHENTICATION_REQUIRED', 'App API requires authentication', false);
}

function appSummary(app: AgentApp, detail: { readonly latestContentDigest?: string; readonly releases: readonly { readonly packageVersion: string; readonly createdAt: string }[] } | undefined) {
  const latest = detail?.releases[0];
  return {
    appId: app.appId,
    ...(app.name === undefined ? {} : { name: app.name }),
    ...(app.description === undefined ? {} : { description: app.description }),
    status: app.status,
    releaseCount: detail?.releases.length ?? 0,
    ...(latest === undefined ? {} : { latestVersion: latest.packageVersion, updatedAt: latest.createdAt }),
    createdAt: app.createdAt
  };
}

function appDetailPayload(store: AgentReleaseStore, tenantId: string, app: AgentApp) {
  const detail = store.getApp(tenantId, app.appId);
  if (detail === undefined) return undefined;
  const latest = detail.releases[0];
  const stored = latest === undefined ? undefined : store.getStoredRelease(tenantId, latest.release.releaseRef);
  const lock = stored?.lockPayload as Readonly<Record<string, unknown>> | undefined;
  const manifest = extractManifestSummary(lock);
  const assets = extractAssetPreviews(lock);
  return {
    appId: app.appId,
    ...(app.name === undefined ? {} : { name: app.name }),
    ...(app.description === undefined ? {} : { description: app.description }),
    status: app.status,
    createdAt: app.createdAt,
    ...(manifest === undefined ? {} : { manifest }),
    ...(assets === undefined ? {} : { assets }),
    releases: detail.releases.map((record) => ({
      packageVersion: record.packageVersion,
      releaseRef: record.release.releaseRef,
      releaseId: record.release.releaseId,
      contentDigest: record.release.contentDigest,
      lockDigest: record.release.lockDigest,
      compilerBuild: record.release.provenance.compilerBuild,
      createdAt: record.createdAt
    }))
  };
}

const uploadFields = new Set(['files']);
function rejectedUploadFields(body: unknown): string[] {
  const rejected: string[] = [];
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return ['body'];
  for (const key of Object.keys(body as Record<string, unknown>)) {
    if (!uploadFields.has(key)) rejected.push(key);
  }
  const files = (body as Record<string, unknown>).files;
  if (files !== null && typeof files === 'object' && !Array.isArray(files)) {
    for (const key of Object.keys(files as Record<string, unknown>)) {
      if (!/^[A-Za-z0-9._/-]+$/.test(key)) rejected.push(`files.${key}`);
    }
  }
  return rejected;
}

function mapped(reply: FastifyReply, cause: unknown): FastifyReply {
  if (cause instanceof SourceArchiveError) return sendError(reply, 400, cause.code, cause.message);
  if (cause instanceof SourcePackageError) return sendError(reply, 400, cause.code, cause.detail);
  if (cause instanceof ReleaseRegistryError) {
    const status = cause.code === 'APP_NOT_FOUND' || cause.code === 'APP_DELETED' ? 404
      : cause.code === 'APP_ALREADY_EXISTS' ? 409
      : cause.code === 'RELEASE_NOT_FOUND' ? 404 : 409;
    return sendError(reply, status, cause.code, cause.message);
  }
  if (cause instanceof Error) return sendError(reply, 400, 'APP_OPERATION_REJECTED', cause.message);
  return sendError(reply, 503, 'APP_UNAVAILABLE', 'App API is temporarily unavailable', true);
}

async function readMultipartArchive(request: FastifyRequest): Promise<Uint8Array> {
  const file = await request.file();
  if (file === undefined) throw new SourceArchiveError('SOURCE_ARCHIVE_UNSUPPORTED', 'multipart must include a single archive file');
  return file.toBuffer();
}

export function registerAppsRoutes(app: FastifyInstance, options: RegisterAppsRoutesOptions): void {
  const engineIds = options.engineIds ?? ['engine-local'];
  const kernelContractMajor = options.kernelContractMajor ?? 1;
  void app.register(multipart, { limits: { fileSize: 8 * 1024 * 1024, files: 1 } });

  app.post<{ Body: CreateAppRequest }>(
    '/v1/apps',
    { schema: { body: CreateAppRequestSchema } },
    async (request, reply) => {
      const principal = await principalFor(request, options);
      if (!principal) return unauthorized(reply);
      try {
        const created = options.store.createApp({
          tenantId: options.tenantId,
          ownerNamespace: options.ownerNamespace,
          appId: request.body.appId,
          name: request.body.name,
          ...(request.body.description === undefined ? {} : { description: request.body.description })
        });
        return reply.code(201).send({
          schemaVersion: 'App.v1',
          appId: created.appId,
          name: created.name,
          description: created.description,
          status: created.status,
          createdAt: created.createdAt
        });
      } catch (cause) {
        return mapped(reply, cause);
      }
    }
  );

  app.get('/v1/apps', async (request, reply) => {
    const principal = await principalFor(request, options);
    if (!principal) return unauthorized(reply);
    const apps = options.store.listApps(options.tenantId, { limit: 64 });
    return {
      schemaVersion: 'AppList.v1',
      apps: apps.map((entry) => appSummary(entry, options.store.getApp(options.tenantId, entry.appId)))
    };
  });

  app.get<{ Params: { appId: string } }>('/v1/apps/:appId', async (request, reply) => {
    const principal = await principalFor(request, options);
    if (!principal) return unauthorized(reply);
    const app = options.store.getApp(options.tenantId, request.params.appId);
    if (app === undefined) return sendError(reply, 404, 'APP_NOT_FOUND', 'App not found');
    const payload = appDetailPayload(options.store, options.tenantId, app.app);
    if (payload === undefined) return sendError(reply, 404, 'APP_NOT_FOUND', 'App not found');
    return payload;
  });

  app.delete<{ Params: { appId: string } }>('/v1/apps/:appId', async (request, reply) => {
    const principal = await principalFor(request, options);
    if (!principal) return unauthorized(reply);
    const existing = options.store.getApp(options.tenantId, request.params.appId);
    if (existing === undefined) {
      // 幂等：不存在或已删除都视为成功
      return reply.code(200).send({ schemaVersion: 'AppDelete.v1', appId: request.params.appId, status: 'deleted' });
    }
    const deleted = options.store.softDeleteApp(options.tenantId, request.params.appId);
    if (deleted === undefined) return reply.code(200).send({ schemaVersion: 'AppDelete.v1', appId: request.params.appId, status: 'deleted' });
    return reply.code(200).send({ schemaVersion: 'AppDelete.v1', appId: deleted.appId, status: deleted.status, deletedAt: deleted.deletedAt });
  });

  app.post<{ Params: { appId: string }; Body: UploadAppReleaseRequest }>(
    '/v1/apps/:appId/releases',
    {
      preValidation: async (request, reply) => {
        if ((request.headers['content-type'] ?? '').includes('multipart/form-data')) return;
        const rejected = rejectedUploadFields(request.body);
        if (rejected.length > 0) return sendError(reply, 400, 'APP_UPLOAD_UNTRUSTED_FIELD', `Untrusted fields rejected: ${rejected.join(',')}`);
      }
    },
    async (request, reply) => {
      const principal = await principalFor(request, options);
      if (!principal) return unauthorized(reply);
      try {
        // 前置校验：App 必须存在且为 active
        const existing = options.store.getApp(options.tenantId, request.params.appId);
        if (existing === undefined) return sendError(reply, 404, 'APP_NOT_FOUND', 'App not found');
        const files = (request.headers['content-type'] ?? '').includes('multipart/form-data')
          ? sourceArchiveFilesRecord(unpackSourceArchive(await readMultipartArchive(request)))
          : request.body.files;
        const loaded = await loadSourcePackageFromFiles(files);
        // 一致性：manifest.id 必须与路径 appId 一致，防串主体
        if (loaded.manifest.id !== request.params.appId) {
          return sendError(reply, 409, 'APP_PACKAGE_ID_MISMATCH', `manifest.id '${loaded.manifest.id}' does not match appId '${request.params.appId}'`);
        }
        const compiled = compileSourcePackage({
          loaded,
          tenantId: options.tenantId,
          ownerRef: `owner://${options.ownerNamespace}`,
          engineIds,
          kernelContractMajor
        });
        const release = compiled.release;
        const releasePayload: ReleasePayload = JSON.parse(serializeAgentPackageReleaseV1(release)) as ReleasePayload;
        const result = options.store.submit({
          tenantId: options.tenantId,
          ownerNamespace: options.ownerNamespace,
          packageId: release.packageId,
          packageVersion: release.packageVersion,
          idempotencyKey: release.releaseId,
          release: releasePayload,
          lockPayload: compiled.assetLock as unknown as Record<string, unknown>
        });
        return reply.code(result.status === 'stored' ? 201 : 200).send({
          schemaVersion: 'PackageReleaseResult.v1',
          status: result.status,
          appId: release.packageId,
          packageId: release.packageId,
          packageVersion: release.packageVersion,
          releaseRef: release.releaseRef,
          releaseId: release.releaseId,
          contentDigest: release.contentDigest,
          lockDigest: release.lockDigest,
          compilerBuild: release.provenance.compilerBuild
        });
      } catch (cause) {
        return mapped(reply, cause);
      }
    }
  );
}
