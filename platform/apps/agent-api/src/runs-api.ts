import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { Type, type Static } from 'typebox';
import {
  assemblePackageInput,
  admitPackageRun,
  packageRunInputDigest,
  type AdmissionAuditOutboxPortV1,
  type AdmissionAuditRecordV1,
  type AdmissionIdempotencyRecordV1,
  type AdmissionIdempotencyStoreV1,
  type PackageRunManifestSummary,
} from '@sage/agent-run-admission';
import type { AgentTaskSpecStorePort } from '@sage/platform-ports';
import type { ReleasePayload } from '@sage/agent-release-registry';
import type { AuthenticatedPrincipal } from '@sage/app-contracts';
import type { TaskPackageInputStore, TaskPackageInputRecord } from '@sage/task-domain';
import type { TaskControllerPort } from './task-api.js';

export interface RunsPrincipalAuthenticator {
  authenticateRequest?(request: FastifyRequest): Promise<AuthenticatedPrincipal | undefined> | AuthenticatedPrincipal | undefined;
}

export interface ResolvedReleaseLockPayload {
  readonly manifest?: PackageRunManifestSummary;
  readonly assets?: ReadonlyArray<{ readonly relativePath: string; readonly kind: string; readonly content: string }>;
}

export interface PackageReleaseResolver {
  resolveRelease(tenantId: string, releaseId: string): Promise<{
    readonly release: ReleasePayload;
    readonly lockPayload: ResolvedReleaseLockPayload;
  } | undefined>;
}

export interface RegisterPackageRunsRoutesOptions {
  readonly tenantId: string;
  readonly controller: TaskControllerPort;
  readonly releaseResolver: PackageReleaseResolver;
  readonly taskStore: TaskPackageInputStore;
  readonly specStore: AgentTaskSpecStorePort;
  readonly authenticator: RunsPrincipalAuthenticator;
  readonly deploymentMode?: 'local' | 'pilot' | 'production';
  readonly idempotencyStore?: AdmissionIdempotencyStoreV1;
  readonly auditOutbox?: AdmissionAuditOutboxPortV1;
  readonly now?: () => Date;
}

export const CreatePackageRunRequestSchema = Type.Object({
  input: Type.String({ minLength: 1, maxLength: 100_000 }),
  taskId: Type.Optional(Type.String({ minLength: 1, maxLength: 128, pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]*$' }))
}, { additionalProperties: false });
export type CreatePackageRunRequest = Static<typeof CreatePackageRunRequestSchema>;

export const PackageRunResponseSchema = Type.Object({
  schemaVersion: Type.Literal('PackageRunResult.v1'),
  status: Type.Union([Type.Literal('admitted'), Type.Literal('existing')]),
  taskId: Type.String({ minLength: 1 }),
  runId: Type.String({ minLength: 1 }),
  attemptId: Type.String({ minLength: 1 }),
  releaseRef: Type.String({ minLength: 1 }),
  releaseId: Type.String({ minLength: 1 }),
  specRef: Type.String({ minLength: 1 }),
  specDigest: Type.String({ minLength: 1 }),
  inputRef: Type.String({ minLength: 1 })
}, { additionalProperties: false });
export type PackageRunResponse = Static<typeof PackageRunResponseSchema>;

function sendError(reply: FastifyReply, status: number, code: string, message: string, retryable = false): FastifyReply {
  return reply.code(status).send({ error: { code, message, retryable } });
}

async function principalFor(request: FastifyRequest, options: RegisterPackageRunsRoutesOptions): Promise<AuthenticatedPrincipal | undefined> {
  if (options.authenticator.authenticateRequest) return options.authenticator.authenticateRequest(request);
  const auth = request.headers['x-authentication-id'];
  if (typeof auth === 'string' && auth.length > 0) {
    return { authenticationId: auth, principalId: auth, tenantId: options.tenantId, roles: ['task-operator'] };
  }
  return undefined;
}

/** 内存幂等记录：以 tenant+key 为索引。 */
class InMemoryAdmissionIdempotencyStore implements AdmissionIdempotencyStoreV1 {
  readonly #records = new Map<string, AdmissionIdempotencyRecordV1>();
  async get(input: { readonly tenantId: string; readonly idempotencyKey: string }): Promise<AdmissionIdempotencyRecordV1 | undefined> {
    return this.#records.get(`${input.tenantId}\u0000${input.idempotencyKey}`);
  }
  async putIfAbsent(input: { readonly record: AdmissionIdempotencyRecordV1 }): Promise<{ readonly status: 'created' | 'existing'; readonly record: AdmissionIdempotencyRecordV1 }> {
    const key = `${input.record.tenantId}\u0000${input.record.idempotencyKey}`;
    const existing = this.#records.get(key);
    if (existing !== undefined) return { status: 'existing', record: existing };
    this.#records.set(key, input.record);
    return { status: 'created', record: input.record };
  }
  async putTerminal(input: { readonly record: Extract<AdmissionIdempotencyRecordV1, { readonly status: 'admitted' | 'rejected' }> }): Promise<{ readonly status: 'stored' | 'existing'; readonly record: AdmissionIdempotencyRecordV1 }> {
    const key = `${input.record.tenantId}\u0000${input.record.idempotencyKey}`;
    this.#records.set(key, input.record);
    return { status: 'stored', record: input.record };
  }
}

/** 内存审计 outbox：admitPackageRun 只要求 append 成功。 */
class InMemoryAuditOutbox implements AdmissionAuditOutboxPortV1 {
  readonly records: AdmissionAuditRecordV1[] = [];
  async append(input: { readonly tenantId: string; readonly record: AdmissionAuditRecordV1 }): Promise<'stored' | 'existing'> {
    void input;
    this.records.push(input.record);
    return 'stored';
  }
}

export function registerPackageRunsRoutes(app: FastifyInstance, options: RegisterPackageRunsRoutesOptions): void {
  const now = options.now ?? (() => new Date());
  const idempotencyStore = options.idempotencyStore ?? new InMemoryAdmissionIdempotencyStore();
  const auditOutbox = options.auditOutbox ?? new InMemoryAuditOutbox();

  app.post<{ Params: { releaseId: string }; Body: CreatePackageRunRequest }>(
    '/v1/releases/:releaseId/runs',
    {
      schema: { body: CreatePackageRunRequestSchema },
      preValidation: async (request, reply) => {
        const rejected = rejectedRunFields(request.body);
        if (rejected.length > 0) return sendError(reply, 400, 'PACKAGE_RUN_UNTRUSTED_FIELD', `Untrusted fields rejected: ${rejected.join(',')}`);
      }
    },
    async (request, reply) => {
      if (options.deploymentMode !== undefined && options.deploymentMode !== 'local') {
        return sendError(reply, 501, 'PACKAGE_RUN_ADMISSION_NOT_AVAILABLE', 'Package run admission is not available in this deployment mode', false);
      }
      const principal = await principalFor(request, options);
      if (!principal) return sendError(reply, 401, 'PACKAGE_RUN_AUTHENTICATION_REQUIRED', 'Package run API requires authentication');
      try {
        const resolved = await options.releaseResolver.resolveRelease(options.tenantId, request.params.releaseId);
        if (resolved === undefined) return sendError(reply, 404, 'RELEASE_NOT_FOUND', 'Release not found');
        const release = resolved.release;
        const manifest = resolved.lockPayload.manifest;
        if (manifest === undefined) return sendError(reply, 409, 'PACKAGE_RUN_MANIFEST_MISSING', 'Release has no manifest summary');
        const assets = (resolved.lockPayload.assets ?? []).filter((asset) => typeof asset.content === 'string');
        const entry = assets.find((asset) => asset.relativePath === manifest.entry);
        const references = assets.filter((asset) => asset.kind === 'reference');
        if (entry === undefined) return sendError(reply, 409, 'PACKAGE_RUN_ENTRY_MISSING', 'Release has no entry prompt content');

        const assembled = assemblePackageInput({
          entryPrompt: entry.content,
          references: references.map((reference) => ({ relativePath: reference.relativePath, content: reference.content })),
          userInput: request.body.input,
        });
        const inputDigest = packageRunInputDigest(request.body.input, release.contentDigest, assembled.assetDigests);
        const taskId = request.body.taskId ?? `pkg-${randomUUID()}`;
        const runId = `run-${taskId}`;
        const attemptId = `attempt-${taskId}-1`;

        const admitted = await admitPackageRun({
          tenantId: options.tenantId,
          principalRef: principal.principalId,
          taskId,
          runId,
          attemptId,
          release: {
            releaseRef: release.releaseRef,
            releaseId: release.releaseId,
            releaseDigest: release.contentDigest,
            packageId: release.packageId,
            packageVersion: release.packageVersion,
            ownerRef: release.ownerRef,
            engineIds: release.compatibility.engineIds,
            kernelContractMajor: release.compatibility.kernelContractMajor,
          },
          manifest,
          inputDigest,
          admittedAt: now().toISOString(),
          specStore: options.specStore,
          auditOutbox,
          idempotencyStore,
        });

        const inputRef = `task-input://package/${encodeURIComponent(options.tenantId)}/${encodeURIComponent(taskId)}` as const;
        const record: TaskPackageInputRecord = {
          tenantId: options.tenantId,
          taskId,
          releaseId: release.releaseId,
          releaseDigest: release.contentDigest,
          assembledInput: assembled.text,
          assetDigests: assembled.assetDigests,
          createdAt: now().toISOString(),
        };
        await options.taskStore.writePackageInput(record);

        // 幂等命中时不重复创建/启动 workflow；既有运行已由首次请求启动。
        if (admitted.status === 'admitted') {
          await options.controller.create({ taskId, inputRef }, principal);
        }

        return reply.code(admitted.status === 'admitted' ? 202 : 200).send({
          schemaVersion: 'PackageRunResult.v1',
          status: admitted.status,
          taskId,
          runId,
          attemptId,
          releaseRef: release.releaseRef,
          releaseId: release.releaseId,
          specRef: admitted.spec.specRef,
          specDigest: admitted.spec.specDigest,
          inputRef,
        });
      } catch (cause) {
        return mapped(reply, cause);
      }
    }
  );
}

function mapped(reply: FastifyReply, cause: unknown): FastifyReply {
  const code = cause instanceof Error ? cause.message.split(':')[0] : undefined;
  if (code === 'RELEASE_NOT_FOUND') return sendError(reply, 404, 'RELEASE_NOT_FOUND', 'Release not found');
  if (code === 'PACKAGE_RUN_ADMISSION_IDEMPOTENCY_CONFLICT') return sendError(reply, 409, code, 'Package run idempotency conflict');
  if (code === 'ADMISSION_SPEC_COMMIT_FAILED') return sendError(reply, 409, code, 'Spec commit failed');
  if (typeof cause === 'object' && cause !== null && 'statusCode' in cause && typeof cause.statusCode === 'number') {
    return sendError(reply, cause.statusCode as number, 'PACKAGE_RUN_REJECTED', cause instanceof Error ? cause.message : 'Package run rejected');
  }
  return sendError(reply, 500, 'PACKAGE_RUN_UNAVAILABLE', cause instanceof Error ? cause.message : 'Package run unavailable', true);
}

const runFields = new Set(['input', 'taskId']);
function rejectedRunFields(body: unknown): string[] {
  const rejected: string[] = [];
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return ['body'];
  for (const key of Object.keys(body as Record<string, unknown>)) {
    if (!runFields.has(key)) rejected.push(key);
  }
  return rejected;
}
