import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { Type, type Static } from 'typebox';
import {
  compileSourcePackage,
  loadSourcePackage,
  SourcePackageError,
  serializeAgentPackageReleaseV1,
  type LoadedSourcePackage,
} from '@sage/agent-package-release';
import {
  ReleaseRegistryError,
  type AgentReleaseStore,
  type AuthenticatedReleaseActor,
  type ReleasePayload,
  type StoredRelease,
} from '@sage/agent-release-registry';
import type { AuthenticatedPrincipal } from '@sage/app-contracts';

export interface PackagesPrincipalAuthenticator {
  authenticateRequest?(request: FastifyRequest): Promise<AuthenticatedPrincipal | undefined> | AuthenticatedPrincipal | undefined;
}

export interface RegisterPackagesRoutesOptions {
  readonly tenantId: string;
  readonly store: AgentReleaseStore;
  readonly ownerNamespace: string;
  /** pilot 强认证（5.1）：true 时 stub 信任头停止提权，仅 service token 主体被认可。 */
  readonly serviceTokenRequired?: boolean;
  readonly authenticator: PackagesPrincipalAuthenticator;
  readonly engineIds?: readonly string[];
  readonly kernelContractMajor?: number;
  readonly deploymentMode?: 'local' | 'pilot' | 'production';
  readonly now?: () => Date;
}

export const RegisterPackageReleaseRequestSchema = Type.Object({
  files: Type.Record(
    Type.String({ minLength: 1, maxLength: 512 }),
    Type.String({ minLength: 1, maxLength: 512 * 1024 })
  )
}, { additionalProperties: false });
export type RegisterPackageReleaseRequest = Static<typeof RegisterPackageReleaseRequestSchema>;

export const PackageReleaseResponseSchema = Type.Object({
  schemaVersion: Type.Literal('PackageReleaseResult.v1'),
  status: Type.Union([Type.Literal('stored'), Type.Literal('existing')]),
  packageId: Type.String({ minLength: 1 }),
  packageVersion: Type.String({ minLength: 1 }),
  releaseRef: Type.String({ minLength: 1 }),
  releaseId: Type.String({ minLength: 1 }),
  contentDigest: Type.String({ minLength: 1 }),
  lockDigest: Type.String({ minLength: 1 }),
  compilerBuild: Type.String({ minLength: 1 })
}, { additionalProperties: false });
export type PackageReleaseResponse = Static<typeof PackageReleaseResponseSchema>;

export const PackageSummarySchema = Type.Object({
  packageId: Type.String({ minLength: 1 }),
  latestVersion: Type.String({ minLength: 1 }),
  releaseCount: Type.Integer({ minimum: 1 }),
  latestContentDigest: Type.String({ minLength: 1 }),
  updatedAt: Type.String({ minLength: 1 })
}, { additionalProperties: false });
export type PackageSummary = Static<typeof PackageSummarySchema>;

export const PackageDetailSchema = Type.Object({
  packageId: Type.String({ minLength: 1 }),
  manifest: Type.Optional(Type.Object({
    id: Type.String({ minLength: 1 }),
    version: Type.String({ minLength: 1 }),
    description: Type.String({ minLength: 1 }),
    entry: Type.String({ minLength: 1 }),
    modelRoute: Type.Object({ provider: Type.String({ minLength: 1 }), model: Type.String({ minLength: 1 }) }, { additionalProperties: false }),
    skillRefs: Type.Array(Type.String({ minLength: 1 })),
    capabilityRefs: Type.Array(Type.String({ minLength: 1 })),
    inputs: Type.Optional(Type.Array(Type.Object({
      name: Type.String({ minLength: 1 }), type: Type.String({ minLength: 1 }), required: Type.Boolean(),
      enum: Type.Optional(Type.Array(Type.Union([Type.String(), Type.Number()]))),
      default: Type.Optional(Type.Union([Type.String(), Type.Number()]))
    }, { additionalProperties: false }))),
    dataSources: Type.Optional(Type.Array(Type.Object({
      name: Type.String({ minLength: 1 }), url: Type.String({ minLength: 1 })
    }, { additionalProperties: false }))),
    tasks: Type.Optional(Type.Array(Type.Object({
      name: Type.String({ minLength: 1 }), entry: Type.String({ minLength: 1 })
    }, { additionalProperties: false })))
  }, { additionalProperties: false })),
  assets: Type.Optional(Type.Array(Type.Object({
    relativePath: Type.String({ minLength: 1 }),
    kind: Type.String({ minLength: 1 }),
    digest: Type.String({ minLength: 1 }),
    bytes: Type.Integer({ minimum: 0 }),
    preview: Type.Optional(Type.String({ minLength: 1, maxLength: 4_096 }))
  }, { additionalProperties: false }))),
  releases: Type.Array(Type.Object({
    packageVersion: Type.String({ minLength: 1 }),
    releaseRef: Type.String({ minLength: 1 }),
    releaseId: Type.String({ minLength: 1 }),
    contentDigest: Type.String({ minLength: 1 }),
    lockDigest: Type.String({ minLength: 1 }),
    compilerBuild: Type.String({ minLength: 1 }),
    createdAt: Type.String({ minLength: 1 })
  }, { additionalProperties: false }), { minItems: 1 })
}, { additionalProperties: false });
export type PackageDetail = Static<typeof PackageDetailSchema>;

function sendError(reply: FastifyReply, status: number, code: string, message: string, retryable = false): FastifyReply {
  return reply.code(status).send({ error: { code, message, retryable } });
}

async function principalFor(request: FastifyRequest, options: RegisterPackagesRoutesOptions): Promise<AuthenticatedPrincipal | undefined> {
  if (options.authenticator.authenticateRequest) return options.authenticator.authenticateRequest(request);
  if (options.serviceTokenRequired === true) return undefined;
  const auth = request.headers['x-authentication-id'];
  if (typeof auth === 'string' && auth.length > 0) {
    return { authenticationId: auth, principalId: auth, tenantId: options.tenantId, roles: ['package-registrar'] };
  }
  return undefined;
}

function unauthorized(reply: FastifyReply): FastifyReply {
  return sendError(reply, 401, 'PACKAGE_AUTHENTICATION_REQUIRED', 'Package API requires authentication', false);
}

function actorFrom(principal: AuthenticatedPrincipal | undefined): AuthenticatedReleaseActor | undefined {
  if (!principal) return undefined;
  return {
    authenticated: true,
    principalRef: principal.principalId,
    roles: [...principal.roles],
    ownerNamespaces: principal.roles.includes('package-registrar') ? ['*'] : []
  };
}

/** 将内存中的文件结构物化为临时源包目录并加载（走同一套安全边界校验）。 */
export async function loadSourcePackageFromFiles(files: Record<string, string>): Promise<LoadedSourcePackage> {
  const { mkdtemp, mkdir, writeFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = await mkdtemp(join(tmpdir(), 'sage-package-'));
  try {
    for (const [relative, content] of Object.entries(files)) {
      const full = join(dir, relative);
      await mkdir(join(dir, relative.split('/').slice(0, -1).join('/')), { recursive: true });
      await writeFile(full, content);
    }
    return await loadSourcePackage(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function releaseSummary(record: StoredRelease): PackageDetail['releases'][number] {
  return {
    packageVersion: record.packageVersion,
    releaseRef: record.release.releaseRef,
    releaseId: record.release.releaseId,
    contentDigest: record.release.contentDigest,
    lockDigest: record.release.lockDigest,
    compilerBuild: record.release.provenance.compilerBuild,
    createdAt: record.createdAt
  };
}

function mapped(reply: FastifyReply, cause: unknown): FastifyReply {
  if (cause instanceof SourcePackageError) return sendError(reply, 400, cause.code, cause.detail);
  if (cause instanceof ReleaseRegistryError) {
    const status = cause.code === 'RELEASE_NOT_FOUND' ? 404 : 409;
    return sendError(reply, status, cause.code, cause.message);
  }
  if (cause instanceof Error) return sendError(reply, 400, 'PACKAGE_REGISTRATION_REJECTED', cause.message);
  return sendError(reply, 503, 'PACKAGE_UNAVAILABLE', 'Package API is temporarily unavailable', true);
}

export function registerPackagesRoutes(app: FastifyInstance, options: RegisterPackagesRoutesOptions): void {
  const engineIds = options.engineIds ?? ['engine-local'];
  const kernelContractMajor = options.kernelContractMajor ?? 1;

  app.get('/v1/packages', async (request, reply) => {
    const principal = await principalFor(request, options);
    if (!principal) return unauthorized(reply);
    const summaries = options.store.listPackages(options.tenantId, { limit: 64 });
    return { schemaVersion: 'PackageList.v1', packages: summaries.map((summary) => ({
      packageId: summary.packageId,
      latestVersion: summary.latestVersion,
      releaseCount: summary.releaseCount,
      latestContentDigest: summary.latestContentDigest,
      updatedAt: summary.updatedAt
    })) };
  });

  app.get<{ Params: { packageId: string } }>('/v1/packages/:packageId', async (request, reply) => {
    const principal = await principalFor(request, options);
    if (!principal) return unauthorized(reply);
    const detail = options.store.getPackageDetail(options.tenantId, request.params.packageId);
    if (!detail) return sendError(reply, 404, 'PACKAGE_NOT_FOUND', 'Package not found');
    const latest = detail.releases[0];
    const stored = latest === undefined ? undefined : options.store.getStoredRelease(options.tenantId, latest.release.releaseRef);
    const lock = stored?.lockPayload as Readonly<Record<string, unknown>> | undefined;
    const manifest = extractManifestSummary(lock);
    const assets = extractAssetPreviews(lock);
    return {
      packageId: detail.packageId,
      ...(manifest === undefined ? {} : { manifest }),
      ...(assets === undefined ? {} : { assets }),
      releases: detail.releases.map(releaseSummary)
    };
  });

  app.post<{ Params: { packageId: string }; Body: RegisterPackageReleaseRequest }>(
    '/v1/packages/:packageId/releases',
    {
      schema: { body: RegisterPackageReleaseRequestSchema },
      preValidation: async (request, reply) => {
        const rejected = rejectedRegisterFields(request.body);
        if (rejected.length > 0) return sendError(reply, 400, 'PACKAGE_REGISTRATION_UNTRUSTED_FIELD', `Untrusted fields rejected: ${rejected.join(',')}`);
      }
    },
    async (request, reply) => {
      const principal = await principalFor(request, options);
      if (!principal) return unauthorized(reply);
      const actor = actorFrom(principal);
      if (!actor) return sendError(reply, 403, 'PACKAGE_OPERATION_FORBIDDEN', 'Principal lacks package-registrar role');
      try {
        const loaded = await loadSourcePackageFromFiles(request.body.files);
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

const registerFields = new Set(['files']);
function rejectedRegisterFields(body: unknown): string[] {
  const rejected: string[] = [];
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return ['body'];
  for (const key of Object.keys(body as Record<string, unknown>)) {
    if (!registerFields.has(key)) rejected.push(key);
  }
  const files = (body as Record<string, unknown>).files;
  if (files !== null && typeof files === 'object' && !Array.isArray(files)) {
    for (const key of Object.keys(files as Record<string, unknown>)) {
      if (!/^[A-Za-z0-9._/-]+$/.test(key)) rejected.push(`files.${key}`);
    }
  }
  return rejected;
}

interface LockManifestShape {
  readonly id?: unknown;
  readonly version?: unknown;
  readonly description?: unknown;
  readonly entry?: unknown;
  readonly inputs?: unknown;
  readonly dataSources?: unknown;
  readonly tasks?: unknown;
  readonly modelRoute?: { readonly provider?: unknown; readonly model?: unknown };
  readonly skillRefs?: readonly unknown[];
  readonly capabilityRefs?: readonly unknown[];
}
interface LockAssetShape {
  readonly relativePath?: unknown;
  readonly kind?: unknown;
  readonly sha256?: unknown;
  readonly bytes?: unknown;
  readonly content?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function str(value: unknown): string | undefined { return typeof value === 'string' ? value : undefined; }

export function extractManifestSummary(lock: Readonly<Record<string, unknown>> | undefined): PackageDetail['manifest'] | undefined {
  const manifest = lock?.manifest;
  if (!isRecord(manifest)) return undefined;
  const typed = manifest as LockManifestShape;
  const modelRoute = typed.modelRoute;
  if (str(typed.id) === undefined || str(typed.entry) === undefined || !isRecord(modelRoute)
    || str(modelRoute.provider) === undefined || str(modelRoute.model) === undefined) {
    return undefined;
  }
  const declaredInputs = Array.isArray(typed.inputs)
    ? typed.inputs.filter(isRecord).map((input) => ({
        name: str(input.name) ?? '',
        type: str(input.type) ?? 'string',
        required: input.required === true,
        ...(Array.isArray(input.enum) ? { enum: input.enum.filter((value) => typeof value === 'string' || typeof value === 'number') } : {}),
        ...(typeof input.default === 'string' || typeof input.default === 'number' ? { default: input.default } : {})
      })).filter((input) => input.name !== '')
    : undefined;
  const declaredDataSources = Array.isArray(typed.dataSources)
    ? typed.dataSources.filter(isRecord).map((source) => ({
        name: str(source.name) ?? '',
        url: str(source.url) ?? ''
      })).filter((source) => source.name !== '')
    : undefined;
  const declaredTasks = Array.isArray(typed.tasks)
    ? typed.tasks.filter(isRecord).map((task) => ({
        name: str(task.name) ?? '',
        entry: str(task.entry) ?? ''
      })).filter((task) => task.name !== '')
    : undefined;
  return {
    id: str(typed.id) as string,
    version: str(typed.version) ?? '',
    description: str(typed.description) ?? '',
    entry: str(typed.entry) as string,
    modelRoute: { provider: str(modelRoute.provider) as string, model: str(modelRoute.model) as string },
    skillRefs: Array.isArray(typed.skillRefs) ? typed.skillRefs.filter(str).map(str) as string[] : [],
    capabilityRefs: Array.isArray(typed.capabilityRefs) ? typed.capabilityRefs.filter(str).map(str) as string[] : [],
    ...(declaredInputs === undefined ? {} : { inputs: declaredInputs }),
    ...(declaredDataSources === undefined ? {} : { dataSources: declaredDataSources }),
    ...(declaredTasks === undefined ? {} : { tasks: declaredTasks })
  };
}

export function extractAssetPreviews(lock: Readonly<Record<string, unknown>> | undefined): PackageDetail['assets'] | undefined {
  const raw = lock?.assets;
  if (!Array.isArray(raw)) return undefined;
  const assets: NonNullable<PackageDetail['assets']> = [];
  for (const entry of raw) {
    if (!isRecord(entry)) continue;
    const typed = entry as LockAssetShape;
    const relativePath = str(typed.relativePath);
    const kind = str(typed.kind);
    if (relativePath === undefined || kind === undefined) continue;
    const digest = str(typed.sha256) === undefined ? undefined : `sha256:${str(typed.sha256)}`;
    const preview = typeof typed.content === 'string' ? typed.content.slice(0, 4_096) : undefined;
    assets.push({
      relativePath,
      kind,
      digest: digest ?? '',
      bytes: typeof typed.bytes === 'number' && Number.isInteger(typed.bytes) ? typed.bytes : 0,
      ...(preview === undefined ? {} : { preview }),
    });
  }
  return assets.length === 0 ? undefined : assets;
}
