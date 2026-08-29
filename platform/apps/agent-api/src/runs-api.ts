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
  type PackageRunTaskDeclaration,
} from '@sage/agent-run-admission';
import type { AgentTaskSpecStorePort } from '@sage/platform-ports';
import type { ReleasePayload } from '@sage/agent-release-registry';
import type { AuthenticatedPrincipal } from '@sage/app-contracts';
import { resolvePackageRunConnection } from '@sage/task-domain';
import type { ProviderConnectionStore, RunAgentSettingsStore, TaskPackageInputStore, TaskPackageInputRecord } from '@sage/task-domain';
import type { ControlledEgressConnectorPort } from '@sage/tool-runtime';
import { fetchPackageSnapshots, PackageSnapshotError } from './package-snapshots.js';
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
  readonly settingsStore?: Pick<RunAgentSettingsStore, 'getRunAgentSettings'>;
  /** 注册表访问：准入依赖检查（manifest 路由匹配优先、设置默认兜底）。 */
  readonly providerConnections?: Pick<ProviderConnectionStore, 'getProviderConnection' | 'listProviderConnections'>;
  readonly idempotencyStore?: AdmissionIdempotencyStoreV1;
  readonly auditOutbox?: AdmissionAuditOutboxPortV1;
  /** 包运行输入快照的受控出口连接器：声明了 dataSources 的运行必需，缺省即 fail-closed。 */
  readonly snapshotConnector?: ControlledEgressConnectorPort;
  readonly now?: () => Date;
}

export const CreatePackageRunRequestSchema = Type.Object({
  task: Type.Optional(Type.String({ minLength: 1, maxLength: 64, pattern: '^[a-z][a-z0-9-]{0,63}$' })),
  params: Type.Optional(Type.Record(Type.String({ minLength: 1, maxLength: 64 }), Type.Union([Type.String({ maxLength: 2_048 }), Type.Number()]), { maxProperties: 16 })),
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
        // 自由文本 input 已移除：出现即 410，指引改用声明参数或 Chat promotion。
        if (request.body !== null && typeof request.body === 'object' && !Array.isArray(request.body) && 'input' in (request.body as Record<string, unknown>)) {
          return sendError(reply, 410, 'INPUT_REMOVED', 'Free-form input was removed: submit declared params (see manifest inputs) or start from Chat promotion.', false);
        }
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

        // 运行前依赖检查（fail-closed，双来源）：manifest modelRoute（model/fallbacks 依序）匹配注册表可用条目优先，
        // 未匹配回退运行 agent 设置默认；两来源皆不可用即拒绝，不物化输入、不创建任务。
        {
          const settings = options.settingsStore === undefined ? undefined : await options.settingsStore.getRunAgentSettings(options.tenantId);
          const registry = options.providerConnections === undefined
            ? []
            : await options.providerConnections.listProviderConnections(options.tenantId).catch(() => [] as const);
          const resolvedConnection = resolvePackageRunConnection(manifest.modelRoute, registry, settings?.providerConnectionId);
          if (resolvedConnection === undefined) {
            return sendError(reply, 409, 'PROVIDER_DEPENDENCY_MISSING',
              `Package runs require a workspace provider: no enabled registry entry with a stored credential matches the manifest model route (${manifest.modelRoute.model}${(manifest.modelRoute.fallbacks ?? []).length > 0 ? ` or fallbacks ${(manifest.modelRoute.fallbacks ?? []).join(', ')}` : ''}), and the run agent settings default is ${settings?.providerConnectionId === undefined ? 'unset' : `pinned to provider connection ${settings.providerConnectionId} which is missing, disabled, or has no stored credential`}. Add an enabled workspace provider with a stored credential and select it in run agent settings.`, false);
          }
        }
        const assets = (resolved.lockPayload.assets ?? []).filter((asset) => typeof asset.content === 'string');
        const entry = assets.find((asset) => asset.relativePath === manifest.entry);
        const references = assets.filter((asset) => asset.kind === 'reference');
        if (entry === undefined) return sendError(reply, 409, 'PACKAGE_RUN_ENTRY_MISSING', 'Release has no entry prompt content');

        // Task 解析：v1/未声明 tasks 的 manifest 视为隐式单任务；多任务未指定或指定不存在即拒绝。
        const declaredTasks = manifest.tasks ?? [];
        const requestedTask = request.body.task;
        let selectedTask: PackageRunTaskDeclaration | undefined = undefined;
        if (declaredTasks.length > 0) {
          if (declaredTasks.length > 1 && requestedTask === undefined) {
            return sendError(reply, 400, 'PACKAGE_PARAMS_INVALID', `Multiple tasks declared; specify one of: ${declaredTasks.map((task) => task.name).join(', ')}`);
          }
          selectedTask = requestedTask === undefined ? declaredTasks[0] : declaredTasks.find((task) => task.name === requestedTask);
          if (requestedTask !== undefined && selectedTask === undefined) {
            return sendError(reply, 400, 'PACKAGE_PARAMS_INVALID', `Unknown task '${requestedTask}'; available: ${declaredTasks.map((task) => task.name).join(', ')}`);
          }
        } else if (requestedTask !== undefined) {
          return sendError(reply, 400, 'PACKAGE_PARAMS_INVALID', `Release declares no tasks; unexpected task '${requestedTask}'`);
        }

        // 参数解析：按 manifest inputs 声明校验（未声明/类型不符/缺必填拒绝），缺省取默认值，再按任务绑定物化。
        const declaredInputs = manifest.inputs ?? [];
        const providedParams = request.body.params ?? {};
        const invalidParam = (detail: string): FastifyReply => sendError(reply, 400, 'PACKAGE_PARAMS_INVALID', detail);
        for (const key of Object.keys(providedParams)) {
          if (!declaredInputs.some((input) => input.name === key)) return invalidParam(`Unknown param '${key}'; declared inputs: ${declaredInputs.length === 0 ? '(none)' : declaredInputs.map((input) => input.name).join(', ')}`);
        }
        const resolvedInputValues = new Map<string, string | number>();
        for (const declaration of declaredInputs) {
          const raw = providedParams[declaration.name];
          if (raw === undefined) {
            if (declaration.default !== undefined) resolvedInputValues.set(declaration.name, declaration.default);
            else if (declaration.required) return invalidParam(`Param '${declaration.name}' is required and has no default`);
            continue;
          }
          if (declaration.type === 'number' && typeof raw !== 'number') return invalidParam(`Param '${declaration.name}' must be a number`);
          if (declaration.type === 'string' && typeof raw !== 'string') return invalidParam(`Param '${declaration.name}' must be a string`);
          if (declaration.type === 'enum' && !(declaration.enum ?? []).includes(raw)) return invalidParam(`Param '${declaration.name}' must be one of: ${(declaration.enum ?? []).map((value) => String(value)).join(', ')}`);
          resolvedInputValues.set(declaration.name, raw);
        }
        const resolvedParams = (selectedTask?.params ?? [])
          .map((binding) => binding.from.kind === 'input'
            ? { name: binding.name, value: resolvedInputValues.get(binding.from.input) }
            : { name: binding.name, value: binding.from.value })
          .filter((param): param is { readonly name: string; readonly value: string | number } => param.value !== undefined);

        // 数据源快照：经受控出口获取；onFailure: fail 的源失败即整体拒绝（fail-closed）。
        const snapshots = (await fetchPackageSnapshots(manifest.dataSources ?? [], options.snapshotConnector)).snapshots;

        const declaresV2 = declaredTasks.length > 0 || declaredInputs.length > 0 || (manifest.dataSources?.length ?? 0) > 0;
        const includeSnapshots = declaresV2 || snapshots.length > 0 ? snapshots : undefined;
        const assembled = assemblePackageInput({
          entryPrompt: entry.content,
          references: references.map((reference) => ({ relativePath: reference.relativePath, content: reference.content })),
          userInput: '',
          ...(includeSnapshots === undefined ? {} : { snapshots: includeSnapshots }),
          ...(declaresV2 ? { params: resolvedParams } : {})
        });
        const inputDigest = packageRunInputDigest('', release.contentDigest, assembled.assetDigests, declaresV2 ? {
          ...(selectedTask === undefined ? {} : { task: selectedTask.name }),
          params: resolvedParams,
          snapshots
        } : undefined);
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
        // 输出契约固化：任务声明的 schema 资产原文与产物名清单随包输入物化，供 worker 物化点校验。
        const declaredSchemaRef = selectedTask?.output.schema;
        const declaredSchemaAsset = declaredSchemaRef === undefined
          ? undefined
          : assets.find((asset) => asset.relativePath === declaredSchemaRef);
        const declaredFiles = selectedTask?.output.files ?? [];
        const manifestRoute = manifest.modelRoute;
        const runContract = selectedTask === undefined && declaredSchemaAsset === undefined && declaredFiles.length === 0 && manifestRoute === undefined
          ? undefined
          : {
              ...(selectedTask === undefined ? {} : { task: selectedTask.name }),
              ...(declaredSchemaAsset === undefined ? {} : { schema: declaredSchemaAsset.content }),
              ...(declaredFiles.length === 0 ? {} : { files: [...declaredFiles] }),
              ...(manifestRoute === undefined ? {} : { modelRoute: manifestRoute })
            };
        const record: TaskPackageInputRecord = {
          tenantId: options.tenantId,
          taskId,
          releaseId: release.releaseId,
          releaseDigest: release.contentDigest,
          assembledInput: assembled.text,
          assetDigests: assembled.assetDigests,
          ...(runContract === undefined ? {} : { runContract }),
          createdAt: now().toISOString(),
        };

        // 幂等命中时不重复创建/启动 workflow，也不重写包输入；响应必须回填首次准入的
        // taskId/runId/attemptId（存于已提交的 spec），否则调用方拿到的是不存在的幻影 id。
        if (admitted.status === 'admitted') {
          await options.taskStore.writePackageInput(record);
          const slice = packageRunSliceLimits(manifest.budgets);
          await options.controller.create({ taskId, inputRef, ...(slice === undefined ? {} : { slice }) }, principal);
        }
        const effectiveTaskId = admitted.status === 'admitted' ? taskId : admitted.spec.taskId;
        const effectiveRunId = admitted.status === 'admitted' ? runId : admitted.spec.runId;
        const effectiveAttemptId = admitted.status === 'admitted' ? attemptId : admitted.spec.attemptId;
        const effectiveInputRef = admitted.status === 'admitted' ? inputRef
          : `task-input://package/${encodeURIComponent(options.tenantId)}/${encodeURIComponent(effectiveTaskId)}` as const;

        return reply.code(admitted.status === 'admitted' ? 202 : 200).send({
          schemaVersion: 'PackageRunResult.v1',
          status: admitted.status,
          taskId: effectiveTaskId,
          runId: effectiveRunId,
          attemptId: effectiveAttemptId,
          releaseRef: release.releaseRef,
          releaseId: release.releaseId,
          specRef: admitted.spec.specRef,
          specDigest: admitted.spec.specDigest,
          inputRef: effectiveInputRef,
        });
      } catch (cause) {
        return mapped(reply, cause);
      }
    }
  );
}

function mapped(reply: FastifyReply, cause: unknown): FastifyReply {
  const code = cause instanceof Error ? cause.message.split(':')[0] : undefined;
  if (cause instanceof PackageSnapshotError || code === 'PACKAGE_SNAPSHOT_SOURCE_UNAVAILABLE') {
    return sendError(reply, 502, 'PACKAGE_SNAPSHOT_SOURCE_UNAVAILABLE', cause instanceof Error ? cause.message : 'Snapshot source unavailable', true);
  }
  if (code === 'RELEASE_NOT_FOUND') return sendError(reply, 404, 'RELEASE_NOT_FOUND', 'Release not found');
  if (code === 'PACKAGE_RUN_ADMISSION_IDEMPOTENCY_CONFLICT') return sendError(reply, 409, code, 'Package run idempotency conflict');
  if (code === 'ADMISSION_SPEC_COMMIT_FAILED') return sendError(reply, 409, code, 'Spec commit failed');
  if (typeof cause === 'object' && cause !== null && 'statusCode' in cause && typeof cause.statusCode === 'number') {
    return sendError(reply, cause.statusCode as number, 'PACKAGE_RUN_REJECTED', cause instanceof Error ? cause.message : 'Package run rejected');
  }
  return sendError(reply, 500, 'PACKAGE_RUN_UNAVAILABLE', cause instanceof Error ? cause.message : 'Package run unavailable', true);
}

const runFields = new Set(['task', 'params', 'taskId']);
function rejectedRunFields(body: unknown): string[] {
  const rejected: string[] = [];
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return ['body'];
  for (const key of Object.keys(body as Record<string, unknown>)) {
    if (!runFields.has(key)) rejected.push(key);
  }
  return rejected;
}

/** 包运行 slice 预算来自 manifest budgets；缺省回退 controller 默认，超时上限对齐活动 startToClose（5 分钟）。 */
const PACKAGE_SLICE_TIMEOUT_CAP_MS = 300_000;
function packageRunSliceLimits(budgets?: PackageRunManifestSummary['budgets']) {
  if (budgets === undefined) return undefined;
  return {
    maxTurns: 1,
    maxToolCalls: Math.min(budgets.maxToolCalls ?? 4, 16),
    // 预算钳制须覆盖平台输入快照上限（512 KiB ≈ 128k token）+ 输出，不得静默削弱声明预算。
    maxTokens: Math.min(budgets.maxTokens ?? 8_000, 200_000),
    timeoutMs: Math.min(budgets.maxDurationMs ?? 10_000, PACKAGE_SLICE_TIMEOUT_CAP_MS)
  };
}
