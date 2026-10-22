import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import multipart from '@fastify/multipart';
import { Type, type Static } from 'typebox';
import {
  compileSourcePackage,
  encodeTarGz,
  SourceArchiveError,
  SourcePackageError,
  serializeAgentPackageReleaseV1,
  sourceArchiveFilesRecord,
  unpackSourceArchive,
} from '@sage/agent-package-release';
import {
  ReleaseRegistryError,
  type AgentApp,
  type AgentAppDetail,
  type AgentReleaseStore,
  type AppDraft,
  type ReleasePayload,
  type StoredRelease,
} from '@sage/agent-release-registry';
import type { AuthenticatedPrincipal } from '@sage/app-contracts';
import {
  extractAssetContents,
  extractAssetPreviews,
  extractManifestSummary,
  loadSourcePackageFromFiles,
  releaseSummary,
} from './app-release-payload.js';

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
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

export const CreateAppRequestSchema = Type.Object({
  appId: Type.String({ minLength: 1, maxLength: 128, pattern: APP_ID_PATTERN.source }),
  name: Type.String({ minLength: 1, maxLength: 128 }),
  description: Type.Optional(Type.String({ maxLength: 2_048 }))
}, { additionalProperties: false });
export type CreateAppRequest = Static<typeof CreateAppRequestSchema>;

export const UpdateAppRequestSchema = Type.Object({
  name: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
  description: Type.Optional(Type.String({ maxLength: 2_048 }))
}, { additionalProperties: false, minProperties: 1 });
export type UpdateAppRequest = Static<typeof UpdateAppRequestSchema>;

export const PutAppDraftRequestSchema = Type.Object({
  files: Type.Record(
    Type.String({ minLength: 1, maxLength: 512 }),
    Type.String({ maxLength: 512 * 1024 })
  )
}, { additionalProperties: false });
export type PutAppDraftRequest = Static<typeof PutAppDraftRequestSchema>;

export const PublishAppReleaseRequestSchema = Type.Object({
  baseRevision: Type.Integer({ minimum: 0 })
}, { additionalProperties: false });
export type PublishAppReleaseRequest = Static<typeof PublishAppReleaseRequestSchema>;

function sendError(
  reply: FastifyReply,
  status: number,
  code: string,
  message: string,
  retryable = false,
  details?: Readonly<Record<string, unknown>>
): FastifyReply {
  return reply.code(status).send({ error: { code, message, retryable, ...(details ?? {}) } });
}

export type AppsAuthOptions = Pick<RegisterAppsRoutesOptions, 'tenantId' | 'serviceTokenRequired' | 'authenticator'>;

export async function principalFor(request: FastifyRequest, options: AppsAuthOptions): Promise<AuthenticatedPrincipal | undefined> {
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

function revisionConflict(reply: FastifyReply, currentRevision: number): FastifyReply {
  return sendError(reply, 409, 'APP_DRAFT_CONFLICT', 'App draft revision changed', false, { currentRevision });
}

/** 缺省 If-Match 视为当前 revision；格式必须是 `"r<N>"`（允许无引号与 W/ 前缀）。 */
function expectedRevisionFrom(request: FastifyRequest, currentRevision: number): number {
  const header = request.headers['if-match'];
  if (header === undefined || header.trim() === '') return currentRevision;
  const match = /^(?:W\/)?"?r(\d+)"?$/.exec(header.trim());
  if (match === null) throw new ReleaseRegistryError('APP_INVALID', `If-Match must look like "r<N>", got '${header}'`);
  const revision = Number(match[1]);
  if (!Number.isSafeInteger(revision)) throw new ReleaseRegistryError('APP_INVALID', 'If-Match revision is out of range');
  return revision;
}

function setRevisionEtag(reply: FastifyReply, revision: number): void {
  reply.header('ETag', `"r${revision}"`);
}

function draftWithFiles(app: AgentApp, releases: readonly StoredRelease[]) {
  const latest = releases[0];
  return {
    appId: app.appId,
    ...(app.name === undefined ? {} : { name: app.name }),
    ...(app.description === undefined ? {} : { description: app.description }),
    status: app.status,
    draftRevision: app.draft.revision,
    draftDigest: app.draft.digest,
    releaseCount: releases.length,
    ...(latest === undefined ? {} : { latestVersion: latest.packageVersion }),
    hasUnpublishedChanges: Object.keys(app.draft.files).length > 0 && latest?.sourceFilesDigest !== app.draft.digest,
    createdAt: app.createdAt,
    updatedAt: app.updatedAt
  };
}

function appDetailPayload(detail: AgentAppDetail) {
  const latest = detail.releases[0];
  const lock = latest?.lockPayload;
  const manifest = extractManifestSummary(lock);
  const assets = extractAssetPreviews(lock);
  return {
    ...draftWithFiles(detail.app, detail.releases),
    ...(manifest === undefined ? {} : { manifest }),
    ...(assets === undefined ? {} : { assets }),
    releases: detail.releases.map(releaseSummary)
  };
}

function draftPayload(appId: string, draft: AppDraft) {
  return {
    schemaVersion: 'AppDraft.v1',
    appId,
    revision: draft.revision,
    digest: draft.digest,
    files: draft.files,
    updatedAt: draft.updatedAt
  };
}

function releaseDetailPayload(record: StoredRelease) {
  const assets = extractAssetPreviews(record.lockPayload);
  return {
    schemaVersion: 'AppReleaseDetail.v1',
    appId: record.packageId,
    ...releaseSummary(record),
    provenance: record.release.provenance,
    ...(assets === undefined ? {} : { assets })
  };
}

function archive(files: Readonly<Record<string, string>>): Buffer {
  return encodeTarGz(Object.entries(files).map(([name, content]) => ({ name, bytes: Buffer.from(content, 'utf8') })));
}

/** 旧 Release 无 sourceFiles 时降级为 lock 资产 + manifest.json。 */
function sourceSnapshot(record: StoredRelease): { readonly files: Record<string, string>; readonly snapshot: 'source' | 'unavailable' } {
  if (record.sourceFiles !== undefined && Object.keys(record.sourceFiles).length > 0) {
    return { files: { ...record.sourceFiles }, snapshot: 'source' };
  }
  const files = extractAssetContents(record.lockPayload);
  const manifest = record.lockPayload.manifest;
  if (manifest !== undefined) files['manifest.json'] = `${JSON.stringify(manifest, null, 2)}\n`;
  return { files, snapshot: 'unavailable' };
}

function mapped(reply: FastifyReply, cause: unknown): FastifyReply {
  if (cause instanceof SourceArchiveError) return sendError(reply, 400, cause.code, cause.message);
  if (cause instanceof SourcePackageError) return sendError(reply, 400, cause.code, cause.detail);
  if (cause instanceof ReleaseRegistryError) {
    const status = cause.code === 'APP_NOT_FOUND' || cause.code === 'APP_DELETED' || cause.code === 'RELEASE_NOT_FOUND' ? 404
      : cause.code === 'APP_INVALID' || cause.code === 'APP_DRAFT_INVALID' || cause.code === 'RELEASE_SUBMIT_INVALID' ? 400
      : 409;
    return sendError(reply, status, cause.code, cause.message);
  }
  if (cause instanceof Error) return sendError(reply, 400, 'APP_OPERATION_REJECTED', cause.message);
  return sendError(reply, 503, 'APP_UNAVAILABLE', 'App API is temporarily unavailable', true);
}

async function readMultipartArchive(request: FastifyRequest): Promise<Uint8Array> {
  if (!request.isMultipart()) throw new SourceArchiveError('SOURCE_ARCHIVE_UNSUPPORTED', 'draft import requires multipart/form-data');
  const file = await request.file();
  if (file === undefined) throw new SourceArchiveError('SOURCE_ARCHIVE_UNSUPPORTED', 'multipart must include a single archive file');
  return file.toBuffer();
}

export function registerAppsRoutes(app: FastifyInstance, options: RegisterAppsRoutesOptions): void {
  const engineIds = options.engineIds ?? ['engine-local'];
  const kernelContractMajor = options.kernelContractMajor ?? 1;
  void app.register(multipart, { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } });

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
        setRevisionEtag(reply, created.draft.revision);
        return reply.code(201).send({
          schemaVersion: 'App.v1',
          appId: created.appId,
          name: created.name,
          description: created.description,
          status: created.status,
          draftRevision: created.draft.revision,
          draftDigest: created.draft.digest,
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
      apps: apps.map((entry) => draftWithFiles(entry, options.store.getApp(options.tenantId, entry.appId)?.releases ?? []))
    };
  });

  app.get<{ Params: { appId: string } }>('/v1/apps/:appId', async (request, reply) => {
    const principal = await principalFor(request, options);
    if (!principal) return unauthorized(reply);
    const detail = options.store.getApp(options.tenantId, request.params.appId);
    if (detail === undefined) return sendError(reply, 404, 'APP_NOT_FOUND', 'App not found');
    return appDetailPayload(detail);
  });

  app.patch<{ Params: { appId: string }; Body: UpdateAppRequest }>(
    '/v1/apps/:appId',
    { schema: { body: UpdateAppRequestSchema } },
    async (request, reply) => {
      const principal = await principalFor(request, options);
      if (!principal) return unauthorized(reply);
      try {
        const detail = options.store.getApp(options.tenantId, request.params.appId);
        if (detail === undefined) return sendError(reply, 404, 'APP_NOT_FOUND', 'App not found');
        const expectedRevision = expectedRevisionFrom(request, detail.app.draft.revision);
        const result = options.store.updateAppMetadata({
          tenantId: options.tenantId,
          appId: request.params.appId,
          expectedRevision,
          ...(request.body.name === undefined ? {} : { name: request.body.name }),
          ...(request.body.description === undefined ? {} : { description: request.body.description })
        });
        if (result.status === 'conflict') return revisionConflict(reply, result.currentRevision);
        setRevisionEtag(reply, result.app.draft.revision);
        return draftWithFiles(result.app, options.store.listAppReleases(options.tenantId, request.params.appId));
      } catch (cause) {
        return mapped(reply, cause);
      }
    }
  );

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

  app.get<{ Params: { appId: string } }>('/v1/apps/:appId/draft', async (request, reply) => {
    const principal = await principalFor(request, options);
    if (!principal) return unauthorized(reply);
    const detail = options.store.getApp(options.tenantId, request.params.appId);
    if (detail === undefined) return sendError(reply, 404, 'APP_NOT_FOUND', 'App not found');
    setRevisionEtag(reply, detail.app.draft.revision);
    return draftPayload(detail.app.appId, detail.app.draft);
  });

  app.put<{ Params: { appId: string }; Body: PutAppDraftRequest }>(
    '/v1/apps/:appId/draft',
    { schema: { body: PutAppDraftRequestSchema }, bodyLimit: MAX_UPLOAD_BYTES },
    async (request, reply) => {
      const principal = await principalFor(request, options);
      if (!principal) return unauthorized(reply);
      try {
        const detail = options.store.getApp(options.tenantId, request.params.appId);
        if (detail === undefined) return sendError(reply, 404, 'APP_NOT_FOUND', 'App not found');
        const expectedRevision = expectedRevisionFrom(request, detail.app.draft.revision);
        const result = options.store.putAppDraft({
          tenantId: options.tenantId,
          appId: request.params.appId,
          expectedRevision,
          files: request.body.files
        });
        if (result.status === 'conflict') return revisionConflict(reply, result.currentRevision);
        setRevisionEtag(reply, result.draft.revision);
        return draftPayload(request.params.appId, result.draft);
      } catch (cause) {
        return mapped(reply, cause);
      }
    }
  );

  app.post<{ Params: { appId: string } }>(
    '/v1/apps/:appId/draft/import',
    async (request, reply) => {
      const principal = await principalFor(request, options);
      if (!principal) return unauthorized(reply);
      try {
        const detail = options.store.getApp(options.tenantId, request.params.appId);
        if (detail === undefined) return sendError(reply, 404, 'APP_NOT_FOUND', 'App not found');
        const expectedRevision = expectedRevisionFrom(request, detail.app.draft.revision);
        const files = sourceArchiveFilesRecord(unpackSourceArchive(await readMultipartArchive(request)));
        const result = options.store.putAppDraft({
          tenantId: options.tenantId,
          appId: request.params.appId,
          expectedRevision,
          files
        });
        if (result.status === 'conflict') return revisionConflict(reply, result.currentRevision);
        setRevisionEtag(reply, result.draft.revision);
        return draftPayload(request.params.appId, result.draft);
      } catch (cause) {
        return mapped(reply, cause);
      }
    }
  );

  app.get<{ Params: { appId: string } }>('/v1/apps/:appId/draft/export', async (request, reply) => {
    const principal = await principalFor(request, options);
    if (!principal) return unauthorized(reply);
    const detail = options.store.getApp(options.tenantId, request.params.appId);
    if (detail === undefined) return sendError(reply, 404, 'APP_NOT_FOUND', 'App not found');
    const draft = detail.app.draft;
    setRevisionEtag(reply, draft.revision);
    return reply
      .header('content-type', 'application/gzip')
      .header('content-disposition', `attachment; filename="${request.params.appId}-r${draft.revision}.tar.gz"`)
      .send(archive(draft.files));
  });

  app.post<{ Params: { appId: string }; Body: PublishAppReleaseRequest }>(
    '/v1/apps/:appId/releases',
    { schema: { body: PublishAppReleaseRequestSchema } },
    async (request, reply) => {
      const principal = await principalFor(request, options);
      if (!principal) return unauthorized(reply);
      try {
        const detail = options.store.getApp(options.tenantId, request.params.appId);
        if (detail === undefined) return sendError(reply, 404, 'APP_NOT_FOUND', 'App not found');
        const app = detail.app;
        if (Object.keys(app.draft.files).length === 0) {
          return sendError(reply, 400, 'APP_DRAFT_EMPTY', 'App draft is empty; upload files before publishing');
        }
        if (request.body.baseRevision !== app.draft.revision) return revisionConflict(reply, app.draft.revision);
        const loaded = await loadSourcePackageFromFiles({ ...app.draft.files });
        if (loaded.manifest.id !== request.params.appId) {
          return sendError(reply, 400, 'APP_DRAFT_INVALID', `manifest.id '${loaded.manifest.id}' does not match appId '${request.params.appId}'`);
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
        const result = options.store.publishAppRelease({
          tenantId: options.tenantId,
          ownerNamespace: options.ownerNamespace,
          appId: request.params.appId,
          expectedRevision: request.body.baseRevision,
          packageVersion: release.packageVersion,
          idempotencyKey: release.releaseId,
          release: releasePayload,
          lockPayload: compiled.assetLock as unknown as Record<string, unknown>,
          sourceFiles: app.draft.files,
          sourceFilesDigest: app.draft.digest
        });
        return reply.code(result.status === 'stored' ? 201 : 200).send({
          schemaVersion: 'AppReleaseResult.v1',
          status: result.status,
          appId: request.params.appId,
          packageVersion: result.record.packageVersion,
          releaseRef: result.record.release.releaseRef,
          releaseId: result.record.release.releaseId,
          contentDigest: result.record.release.contentDigest,
          lockDigest: result.record.release.lockDigest,
          compilerBuild: result.record.release.provenance.compilerBuild,
          sourceFilesDigest: result.record.sourceFilesDigest ?? app.draft.digest,
          createdAt: result.record.createdAt
        });
      } catch (cause) {
        return mapped(reply, cause);
      }
    }
  );

  app.get<{ Params: { appId: string } }>('/v1/apps/:appId/releases', async (request, reply) => {
    const principal = await principalFor(request, options);
    if (!principal) return unauthorized(reply);
    const detail = options.store.getApp(options.tenantId, request.params.appId);
    if (detail === undefined) return sendError(reply, 404, 'APP_NOT_FOUND', 'App not found');
    return {
      schemaVersion: 'AppReleaseList.v1',
      appId: detail.app.appId,
      releases: detail.releases.map(releaseSummary)
    };
  });

  app.get<{ Params: { appId: string; releaseId: string } }>('/v1/apps/:appId/releases/:releaseId', async (request, reply) => {
    const principal = await principalFor(request, options);
    if (!principal) return unauthorized(reply);
    const detail = options.store.getApp(options.tenantId, request.params.appId);
    if (detail === undefined) return sendError(reply, 404, 'APP_NOT_FOUND', 'App not found');
    const record = detail.releases.find((entry) => entry.release.releaseId === request.params.releaseId);
    if (record === undefined) return sendError(reply, 404, 'RELEASE_NOT_FOUND', 'Release not found');
    return releaseDetailPayload(record);
  });

  app.get<{ Params: { appId: string; releaseId: string }; Querystring: { format?: string } }>(
    '/v1/apps/:appId/releases/:releaseId/export',
    async (request, reply) => {
      const principal = await principalFor(request, options);
      if (!principal) return unauthorized(reply);
      const format = request.query.format ?? 'source';
      if (format !== 'source' && format !== 'bundle') {
        return sendError(reply, 400, 'APP_INVALID', "format must be 'source' or 'bundle'");
      }
      const detail = options.store.getApp(options.tenantId, request.params.appId);
      if (detail === undefined) return sendError(reply, 404, 'APP_NOT_FOUND', 'App not found');
      const record = detail.releases.find((entry) => entry.release.releaseId === request.params.releaseId);
      if (record === undefined) return sendError(reply, 404, 'RELEASE_NOT_FOUND', 'Release not found');
      const resolved = sourceSnapshot(record);
      const files = { ...resolved.files };
      if (format === 'bundle') files['release.json'] = `${JSON.stringify(record.release, null, 2)}\n`;
      reply
        .header('content-type', 'application/gzip')
        .header('content-disposition', `attachment; filename="${request.params.appId}-${record.packageVersion}-${format}.tar.gz"`)
        .header('X-Source-Snapshot', resolved.snapshot);
      if (record.sourceFilesDigest !== undefined) reply.header('X-Source-Files-Digest', record.sourceFilesDigest);
      return reply.send(archive(files));
    }
  );
}
