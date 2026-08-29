import { activityInfo, cancellationSignal, CancelledFailure, ApplicationFailure, heartbeat } from '@temporalio/activity';
import type { P6TelemetryRecorder } from '@sage/observability';
import {
  assertCanonicalPayloadBounds,
  sha256Digest,
  type AgentRunSpec,
  type AgentExecutionEnvelope,
  type BoundedRunReceipt
} from '@sage/agent-contracts';
import {
  assertCoordinatorEnvelope,
  assertNoSensitiveData,
  assertCoordinatorReceiptSummary,
  type CoordinatorReceiptSummary,
  type CoordinatorOwnerRef,
  type CoordinatorTargetRef,
  type CoordinatorAdapterRef,
  type CoordinatorRuntimeRef
} from '@sage/platform-ports';
import type { EngineAdapter, KernelEngineResult, KernelInvocationResult, KernelBounds } from '@sage/agent-lib';
import type { BoundedKernelClient, LocalAgentClient } from '@sage/agent-client';
import type { LiveProviderRoute } from '@sage/local-runtime';
import {
  type AgentSliceResult, type ExecuteAgentSliceInput, type TaskArtifactRef,
  type TaskCommitStore, type TaskInputRef, type TaskProjection, type ProviderConnectionStore, type RunAgentSettingsStore, type TaskRunOutputStore,
  type TaskPackageInputRecord
} from '@sage/task-domain';
import type { SecretBackend } from '@sage/secret-vault';
import { resolvePackageRunConnection } from '@sage/task-domain';
import { runTaskAgentPath, type TaskCanonicalCompatibilityOptions } from './task-compatibility.js';
import { enforceOutputContract, OutputContractViolation } from './output-contract.js';

export interface TaskSliceInputResolver {
  resolve(inputRef: TaskInputRef, tenantId: string): Promise<string>;
}
export interface AgentTaskActivityOptions {
  /** live provider 客户端工厂：所有 slice（package 与 chat）在执行边界按解析路由构造；第三参为包运行声明的输出 token 预算（chat 不传，保持逐轮缺省）。 */
  readonly liveClientFactory: (route: LiveProviderRoute, mode: 'package' | 'chat', maxOutputTokens?: number) => LocalAgentClient;
  /** 运行 agent 设置读取：缺省视 unset（无默认 provider，fail-closed）。 */
  readonly settingsStore?: Pick<RunAgentSettingsStore, 'getRunAgentSettings'>;
  /** 注册表访问：slice 执行边界解析条目与密封凭据。 */
  readonly providerConnections?: ProviderConnectionStore;
  /** 凭据解密后端；必需，缺失即 fail-closed。 */
  readonly secretBackend?: SecretBackend;
  readonly store: TaskCommitStore;
  readonly outputStore?: TaskRunOutputStore;
  readonly inputResolver: TaskSliceInputResolver;
  /** 包输入读取：物化点取任务输出契约（声明 schema 的 Task 才进入强制管线）。 */
  readonly packageInputReader?: { getPackageInput(tenantId: string, taskId: string): Promise<TaskPackageInputRecord | undefined> };
  readonly leaseMs?: number;
  readonly now?: () => Date;
  readonly afterCommit?: (result: AgentSliceResult) => Promise<void> | void;
  readonly telemetry?:P6TelemetryRecorder;
  readonly canonicalCompatibility?: TaskCanonicalCompatibilityOptions;
}
export interface AgentTaskActivities { executeAgentSlice(input: ExecuteAgentSliceInput): Promise<AgentSliceResult> }

/**
 * 执行边界解析：注册表条目 + 密封凭据 → live 路由。设置 unset、条目缺失/停用/无凭据/后端不可用
 * 一律 fail-closed（不可重试）；系统不存在任何本地确定性兜底执行路径。解密后的 key 只留在本函数
 * 返回的路由对象中，不进入任何事件、payload 或日志。
 */
export async function resolveConnectionLiveClient(
  providerConnections: ProviderConnectionStore | undefined,
  secretBackend: SecretBackend | undefined,
  liveClientFactory: ((route: LiveProviderRoute, mode: 'package' | 'chat', maxOutputTokens?: number) => LocalAgentClient) | undefined,
  tenantId: string,
  connectionId: string | undefined,
  mode: 'package' | 'chat',
  maxOutputTokens?: number
): Promise<LocalAgentClient> {
  const failure = (): string =>
    connectionId === undefined
      ? 'PROVIDER_DEPENDENCY_MISSING: run agent settings have no default provider connection. Add a workspace provider and select it in run agent settings.'
      : `PROVIDER_DEPENDENCY_MISSING: run agent default provider is pinned to provider connection ${connectionId} which is missing, disabled, or has no stored credential. Fix or re-select the connection in run agent settings.`;
  if (connectionId === undefined || providerConnections === undefined || secretBackend === undefined || liveClientFactory === undefined) {
    throw ApplicationFailure.nonRetryable(failure(), 'PROVIDER_DEPENDENCY_MISSING');
  }
  const connection = await providerConnections.getProviderConnection(tenantId, connectionId);
  if (connection === undefined || !connection.enabled) {
    throw ApplicationFailure.nonRetryable(failure(), 'PROVIDER_DEPENDENCY_MISSING');
  }
  const sealed = await providerConnections.getProviderCredential(tenantId, connectionId);
  if (sealed === undefined) {
    throw ApplicationFailure.nonRetryable(failure(), 'PROVIDER_DEPENDENCY_MISSING');
  }
  let apiKey: string;
  try {
    apiKey = secretBackend.open({ ciphertext: sealed.ciphertext, keyVersion: sealed.keyVersion });
  } catch {
    throw ApplicationFailure.nonRetryable(failure(), 'PROVIDER_DEPENDENCY_MISSING');
  }
  return liveClientFactory({
    adapterKind: connection.adapterKind,
    baseUrl: connection.baseUrl,
    modelId: connection.modelId,
    apiKey
  }, mode, maxOutputTokens);
}

export function createAgentTaskActivities(options: AgentTaskActivityOptions): AgentTaskActivities {
  const now = options.now ?? (() => new Date());
  const leaseMs = options.leaseMs ?? 35_000;
  return {
    async executeAgentSlice(input): Promise<AgentSliceResult> {
      const info = activityInfo();
      if(input.sessionId&&input.runId&&input.messageId)try{options.telemetry?.record('sage_task_worker_attempt_total',1,{tenant_id:input.tenantId,message_id:input.messageId,session_id:input.sessionId,run_id:input.runId,task_id:input.taskId,workflow_id:input.workflowId,target_id:input.targetId,attempt:input.attempt},{activity_attempt:info.attempt,slice_number:input.sliceNumber});}catch{/* Telemetry cannot change Activity semantics. */}
      // 执行前依赖检查（fail-closed，双来源）：包 slice 按 manifest modelRoute（model/fallbacks 依序）匹配注册表可用条目优先，
      // 未匹配回退运行 agent 设置默认；两来源皆不可用即不可重试失败，不 claim slice、不写 run 输出。chat slice 仅按设置。每 slice 现读，改设置即时生效。
      const isPackageInput = input.inputRef.startsWith('task-input://package/');
      const packageTaskId = isPackageInput
        ? decodeURIComponent(/^task-input:\/\/package\/([^/]+)\/([^/]+)$/.exec(input.inputRef)?.[2] ?? '')
        : '';
      const settings = options.settingsStore !== undefined
        ? await options.settingsStore.getRunAgentSettings(input.tenantId)
        : undefined;
      const packageRecord = packageTaskId === '' || options.packageInputReader === undefined
        ? undefined
        : await options.packageInputReader.getPackageInput(input.tenantId, packageTaskId);
      const manifestRoute = packageRecord?.runContract?.modelRoute;
      const registry = options.providerConnections === undefined
        ? []
        : await options.providerConnections.listProviderConnections(input.tenantId).catch(() => [] as const);
      const resolvedConnection = resolvePackageRunConnection(manifestRoute, registry, settings?.providerConnectionId);
      if (resolvedConnection === undefined) {
        throw ApplicationFailure.nonRetryable(
          manifestRoute === undefined
            ? `PROVIDER_DEPENDENCY_MISSING: run agent settings have no default provider connection. Add a workspace provider and select it in run agent settings.`
            : `PROVIDER_DEPENDENCY_MISSING: no enabled registry entry with a stored credential matches the manifest model route (${manifestRoute.model}${(manifestRoute.fallbacks ?? []).length > 0 ? ` or fallbacks ${(manifestRoute.fallbacks ?? []).join(', ')}` : ''}) and the run agent settings default is ${settings?.providerConnectionId === undefined ? 'unset' : 'unavailable'}.`,
          'PROVIDER_DEPENDENCY_MISSING'
        );
      }
      const sliceClient = await resolveConnectionLiveClient(
        options.providerConnections, options.secretBackend, options.liveClientFactory,
        input.tenantId, resolvedConnection.connectionId, isPackageInput ? 'package' : 'chat',
        // 声明预算直通 provider 请求上限：4096 缺省会把大输出（如 digest JSON）静默截断成契约违约。
        ...(isPackageInput ? [input.limits.maxTokens] as const : [] as const)
      );
      const idempotencyKey = `${input.workflowId}:attempt:${input.attempt}:slice:${input.sliceNumber}`;
      const ownerToken = `${info.activityId}:delivery:${info.attempt}`;
      const claim = await options.store.claimSlice(input, idempotencyKey, ownerToken, new Date(now().getTime() + leaseMs).toISOString());
      if (claim.status === 'committed') return { ...claim.result, duplicate: true };
      if (claim.status === 'effect_unknown') return { ...claim.result, duplicate: true };
      if (claim.status === 'cancelled') throw new CancelledFailure('TASK_SLICE_CANCELLED');
      if (claim.status === 'in_progress') throw new Error('TASK_SLICE_ALREADY_IN_PROGRESS');

      heartbeat({ phase: 'claimed', sliceNumber: input.sliceNumber });
      const signal = cancellationSignal();
      let execution: ReturnType<LocalAgentClient['run']> | undefined;
      let committed = false;
      const cancelExecution = (): void => execution?.cancel();
      signal.addEventListener('abort', cancelExecution, { once: true });
      const heartbeatTimer = setInterval(() => {
        try { heartbeat({ phase: 'running', sliceNumber: input.sliceNumber }); }
        catch { execution?.cancel(); }
      }, 50);
      try {
        if (signal.aborted) throw new CancelledFailure('TASK_SLICE_CANCELLED');
        const resolvedInput = await options.inputResolver.resolve(input.inputRef as TaskInputRef, input.tenantId);
        if (signal.aborted) throw new CancelledFailure('TASK_SLICE_CANCELLED');
        const startedAt = now().getTime();
        const runId = `task-${input.taskId.slice(0, 96)}-a${input.attempt}-s${input.sliceNumber}`;
        const spec: AgentRunSpec = {
          schemaVersion: '1', runId, input: resolvedInput, skillRefs: [], requiredCapabilities: ['events'],
          limits: {
            maxTurns: input.limits.maxTurns, maxToolCalls: input.limits.maxToolCalls, maxTokens: input.limits.maxTokens,
            deadlineAt: new Date(startedAt + input.limits.timeoutMs).toISOString()
          },
          ...(input.checkpointRef === undefined ? {} : { resumeFrom: input.checkpointRef })
        };
        // 路由已在执行边界解析为 live client；不存在本地确定性兜底路径。
        execution = await runTaskAgentPath({
          tenantId: input.tenantId,
          taskId: input.taskId,
          workflowId: input.workflowId,
          attempt: input.attempt,
          sliceNumber: input.sliceNumber,
          runId,
          idempotencyKey,
          legacySpec: spec,
          legacyClient: sliceClient,
          signal,
          deadlineAt: startedAt + input.limits.timeoutMs,
          ...(options.canonicalCompatibility === undefined
            ? {}
            : { canonical: options.canonicalCompatibility }),
        });
        if (signal.aborted) execution.cancel();
        const consumeEvents = (async (): Promise<void> => {
          for await (const event of execution!.events) heartbeat({ phase: event.type, sequence: event.sequence, sliceNumber: input.sliceNumber });
        })();
        const [outcome] = await Promise.all([execution.result, consumeEvents]);
        if (signal.aborted || outcome.status === 'cancelled') throw new CancelledFailure('TASK_SLICE_CANCELLED');
        if (outcome.status !== 'succeeded' && outcome.status !== 'paused') {
          const failure = (outcome as { readonly error?: { readonly message?: string } }).error;
          process.stderr.write(`agent slice outcome ${outcome.status} for ${input.taskId}: ${failure?.message ?? 'no error detail'}\n`);
          throw new Error(`AGENT_SLICE_${outcome.status.toUpperCase()}`);
        }

        // 输出契约强制（声明 schema 的 Task）：剥离→解包→校验；违约在 commit 前以稳定错误失败（可重试）。
        const outputContract = packageRecord?.runContract;
        let materializedOutput = outcome.output;
        if (outputContract?.schema !== undefined && outcome.output !== undefined && outcome.output.length > 0) {
          try {
            materializedOutput = enforceOutputContract(outcome.output, outputContract);
          } catch (cause) {
            if (cause instanceof OutputContractViolation) throw new ApplicationFailure(cause.message, 'PACKAGE_OUTPUT_CONTRACT_VIOLATION');
            throw cause;
          }
        }

        const artifactRef = (outcome.output === undefined || outcome.output.length === 0 ? undefined
          : `artifact://tasks/${encodeURIComponent(input.taskId)}/attempt-${input.attempt}/slice-${input.sliceNumber}`) as TaskArtifactRef | undefined;
        const result: AgentSliceResult = {
          schemaVersion: '1', taskId: input.taskId, sliceNumber: input.sliceNumber, outcome: 'committed',
          done: outcome.status === 'succeeded', duplicate: false,
          ...(outcome.checkpointRef === undefined ? {} : { checkpointRef: outcome.checkpointRef as `checkpoint://${string}` }),
          ...(artifactRef === undefined ? {} : { artifactRef })
        };
        if (signal.aborted) throw new CancelledFailure('TASK_SLICE_CANCELLED');
        const projection = projectionOf(input, result, result.done ? 'succeeded' : 'running', input.sliceNumber, now().toISOString());
        await options.store.commitSlice(idempotencyKey, ownerToken, result, projection);
        committed = true;
        if (artifactRef !== undefined && outcome.output !== undefined && outcome.output.length > 0 && options.outputStore !== undefined) {
          // 输出物化是 best-effort：slice 已提交是权威终态，写失败不改变任务结果。
          try {
            await options.outputStore.writeRunOutput({
              tenantId: input.tenantId, taskId: input.taskId, artifactRef,
              output: materializedOutput ?? outcome.output, mediaType: 'text/plain', createdAt: now().toISOString(),
              ...(outputContract?.files === undefined || outputContract.files.length === 0 ? {} : { files: [...outputContract.files] })
            });
          } catch (cause) {
            process.stderr.write(`task run output materialization failed for ${input.taskId}: ${cause instanceof Error ? cause.message : String(cause)}\n`);
          }
        }
        heartbeat({ phase: 'committed', sliceNumber: input.sliceNumber });
        await options.afterCommit?.(result);
        return result;
      } catch (cause) {
        if (!committed && (signal.aborted || cause instanceof CancelledFailure)) {
          execution?.cancel();
          await execution?.result.catch(() => undefined);
          await options.store.cancelSlice(idempotencyKey, ownerToken, cancelledProjectionOf(input, now().toISOString()));
          throw cause instanceof CancelledFailure ? cause : new CancelledFailure('TASK_SLICE_CANCELLED');
        }
        if (cause instanceof Error && cause.message === 'TASK_EFFECT_CLAIM_LOST') throw cause;
        if (committed) throw cause;
        // 观测：effect_unknown 的原始异常必须可见，否则裁决无据可查。
        process.stderr.write(`agent slice effect-unknown cause for ${input.taskId}: ${cause instanceof Error ? cause.stack : String(cause)}\n`);
        const result: AgentSliceResult = {
          schemaVersion: '1', taskId: input.taskId, sliceNumber: input.sliceNumber, outcome: 'effect_unknown', done: false,
          duplicate: false, detail: 'Agent Slice ended without a known committed outcome'
        };
        if(input.sessionId&&input.runId&&input.messageId)try{options.telemetry?.record('sage_task_effect_unknown_total',1,{tenant_id:input.tenantId,message_id:input.messageId,session_id:input.sessionId,run_id:input.runId,task_id:input.taskId,workflow_id:input.workflowId,target_id:input.targetId,attempt:input.attempt},{slice_number:input.sliceNumber});}catch{/* Telemetry cannot change Activity semantics. */}
        await options.store.markEffectUnknown(idempotencyKey, ownerToken, result,
          projectionOf(input, result, 'effect_unknown', input.sliceNumber - 1, now().toISOString()));
        return result;
      } finally {
        clearInterval(heartbeatTimer);
        signal.removeEventListener('abort', cancelExecution);
      }
    }
  };
}

function projectionOf(
  input: ExecuteAgentSliceInput,
  result: AgentSliceResult,
  status: TaskProjection['status'],
  revision: number,
  timestamp: string
): TaskProjection {
  return {
    schemaVersion: '1', taskType: input.taskType, tenantId: input.tenantId, taskId: input.taskId, workflowId: input.workflowId,
    targetId: input.targetId, attempt: input.attempt, status, revision, projectionSource: 'writer', historyEventId: '0',
    ...(result.checkpointRef === undefined ? {} : { checkpointRef: result.checkpointRef }),
    ...(result.artifactRef === undefined ? {} : { artifactRef: result.artifactRef }),
    projectionUpdatedAt: timestamp, historyObservedAt: timestamp
  };
}

function cancelledProjectionOf(input: ExecuteAgentSliceInput, timestamp: string): TaskProjection {
  return {
    schemaVersion: '1', taskType: input.taskType, tenantId: input.tenantId, taskId: input.taskId, workflowId: input.workflowId,
    targetId: input.targetId, attempt: input.attempt, status: 'cancelled', revision: input.sliceNumber - 1, projectionSource: 'writer', historyEventId: '0',
    ...(input.checkpointRef === undefined ? {} : { checkpointRef: input.checkpointRef }),
    projectionUpdatedAt: timestamp, historyObservedAt: timestamp
  };
}


/**
 * The Temporal Adapter supplies this bounded, ref-only dispatch envelope to the
 * Durable Host. The Host owns Spec/Checkpoint loading and Kernel invocation;
 * the Coordinator never receives their bodies.
 */
export interface DurableCoordinatorHostDispatchInput {
  readonly schemaVersion: '1';
  readonly tenantId: string;
  readonly envelope: AgentExecutionEnvelope;
  readonly dispatchEpoch: number;
  readonly invocationId: string;
  readonly priorReceiptRefs?: readonly string[];
  readonly ownerRef: CoordinatorOwnerRef;
  readonly targetRef: CoordinatorTargetRef;
  readonly adapterRef: CoordinatorAdapterRef;
  readonly runtimeRef: CoordinatorRuntimeRef;
}

export interface DurableCoordinatorHostActivityOptions {
  readonly client: Pick<BoundedKernelClient, 'runBounded'>;
  readonly engine: EngineAdapter<KernelEngineResult>;
  readonly receiptVerifier?: {
    verify(input: { readonly tenantId: string; readonly receiptRefs: readonly string[] }): Promise<boolean>;
  };
  /** Must be below the Temporal Activity start-to-close timeout. */
  readonly invocationTimeoutMs?: number;
  readonly bounds?: Partial<KernelBounds>;
  readonly now?: () => number;
}

export interface DurableCoordinatorHostActivities {
  executeCoordinatorDispatch(input: DurableCoordinatorHostDispatchInput): Promise<CoordinatorReceiptSummary>;
}

const coordinatorHostActivitySignal = (): AbortSignal => {
  try { return cancellationSignal(); }
  catch { return new AbortController().signal; }
};

const coordinatorHostHeartbeat = (details: Record<string, unknown>): void => {
  try { heartbeat(details); }
  catch { /* Direct unit tests and a lost heartbeat must not alter receipt authority. */ }
};

function assertDurableCoordinatorHostInput(input: unknown): asserts input is DurableCoordinatorHostDispatchInput {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('COORDINATOR_DISPATCH_INVALID');
  const candidate = input as Record<string, unknown>;
  if (candidate.schemaVersion !== '1' || typeof candidate.tenantId !== 'string' || candidate.tenantId.length === 0 || candidate.tenantId.length > 128
    || typeof candidate.dispatchEpoch !== 'number' || !Number.isInteger(candidate.dispatchEpoch) || candidate.dispatchEpoch < 1
    || typeof candidate.invocationId !== 'string' || candidate.invocationId.length === 0 || candidate.invocationId.length > 128
    || typeof candidate.ownerRef !== 'string' || !/^owner:\/\/[^\s]+$/u.test(candidate.ownerRef)
    || typeof candidate.targetRef !== 'string' || !/^target:\/\/[^\s]+$/u.test(candidate.targetRef)
    || typeof candidate.adapterRef !== 'string' || !/^adapter:\/\/[^\s]+$/u.test(candidate.adapterRef)
    || typeof candidate.runtimeRef !== 'string' || !/^runtime:\/\/[^\s]+$/u.test(candidate.runtimeRef)) {
    throw new TypeError('COORDINATOR_DISPATCH_INVALID');
  }
  const priorReceiptRefs = candidate.priorReceiptRefs;
  if (priorReceiptRefs !== undefined && (!Array.isArray(priorReceiptRefs)
    || priorReceiptRefs.length > 128
    || priorReceiptRefs.some((ref) => typeof ref !== 'string' || !/^receipt:\/\/[^\s]+$/u.test(ref))
    || new Set(priorReceiptRefs).size !== priorReceiptRefs.length)) throw new TypeError('SEMANTIC_RETRY_RECEIPTS_INVALID');
  assertCoordinatorEnvelope(candidate.envelope);
  assertCanonicalPayloadBounds(input, priorReceiptRefs ?? []);
  const envelope = candidate.envelope;
  if (envelope.invocationId !== candidate.invocationId) throw new TypeError('COORDINATOR_INVOCATION_MISMATCH');
  assertNoSensitiveData(input);
}

const summaryFromReceipt = (receipt: BoundedRunReceipt): CoordinatorReceiptSummary => {
  const summary: CoordinatorReceiptSummary = {
    schemaVersion: '1', receiptRef: receipt.receiptRef, receiptDigest: sha256Digest(receipt), outcome: receipt.outcome,
    receiptRefs: [...receipt.receiptRefs], artifactRefs: [...receipt.artifactRefs],
    ...(receipt.checkpointRef === undefined ? {} : { checkpointRef: receipt.checkpointRef }),
    ...(receipt.error === undefined ? {} : { errorCode: receipt.error.code, errorCategory: receipt.error.category })
  };
  assertCoordinatorReceiptSummary(summary);
  return Object.freeze(summary);
};

const summaryFromHostFailure = (input: DurableCoordinatorHostDispatchInput, code: string, outcome: 'FAILED' | 'CANCELLED' = 'FAILED'): CoordinatorReceiptSummary => {
  const receiptRef = `receipt://kernel-rejection/${sha256Digest({ invocationId: input.invocationId, dispatchEpoch: input.dispatchEpoch, code }).slice('sha256:'.length)}`;
  const summaryWithoutDigest = {
    schemaVersion: '1' as const, receiptRef, outcome, receiptRefs: [], artifactRefs: [],
    errorCode: code, errorCategory: 'KERNEL'
  };
  const summary: CoordinatorReceiptSummary = { ...summaryWithoutDigest, receiptDigest: sha256Digest(summaryWithoutDigest) };
  assertCoordinatorReceiptSummary(summary);
  return Object.freeze(summary);
};

const summaryFromRejection = (input: DurableCoordinatorHostDispatchInput, result: Extract<KernelInvocationResult, { status: 'rejected' }>): CoordinatorReceiptSummary =>
  summaryFromHostFailure(input, result.code, result.code === 'KERNEL_CANCELLED' ? 'CANCELLED' : 'FAILED');

/**
 * V2 dispatch binding to the Phase 1 Durable Host. The only result crossing the
 * Activity boundary is a validated, body-free CoordinatorReceiptSummary.
 */
export function createDurableCoordinatorHostActivities(options: DurableCoordinatorHostActivityOptions): DurableCoordinatorHostActivities {
  const invocationTimeoutMs = options.invocationTimeoutMs ?? 30_000;
  if (!Number.isInteger(invocationTimeoutMs) || invocationTimeoutMs < 1) throw new TypeError('INVALID_HOST_TIMEOUT');
  const now = options.now ?? Date.now;
  const inFlight = new Map<string, Promise<CoordinatorReceiptSummary>>();
  return {
    async executeCoordinatorDispatch(input): Promise<CoordinatorReceiptSummary> {
      assertDurableCoordinatorHostInput(input);
      const deliveryKey = [input.tenantId, input.envelope.attemptId, input.envelope.specDigest, input.invocationId, input.dispatchEpoch, sha256Digest(input.priorReceiptRefs ?? [])].join('\\u0000');
      const existing = inFlight.get(deliveryKey);
      if (existing !== undefined) return existing;

      const execution = (async (): Promise<CoordinatorReceiptSummary> => {
        const priorReceiptRefs = input.priorReceiptRefs ?? [];
        if (priorReceiptRefs.length > 0) {
          if (options.receiptVerifier === undefined) return summaryFromHostFailure(input, 'SEMANTIC_RETRY_RECEIPTS_UNVERIFIED');
          if (!await options.receiptVerifier.verify({ tenantId: input.tenantId, receiptRefs: priorReceiptRefs })) {
            return summaryFromHostFailure(input, 'SEMANTIC_RETRY_RECEIPTS_INVALID');
          }
        }
        const signal = coordinatorHostActivitySignal();
        const ownerToken = `${input.ownerRef}:dispatch:${input.dispatchEpoch}`;
        coordinatorHostHeartbeat({ phase: 'host-dispatch-accepted', dispatchEpoch: input.dispatchEpoch });
        const result = await options.client.runBounded({
          tenantId: input.tenantId,
          ownerToken,
          envelope: input.envelope,
          engine: options.engine,
          deadlineAt: now() + invocationTimeoutMs,
          signal,
          ...(input.priorReceiptRefs === undefined ? {} : { priorReceiptRefs: input.priorReceiptRefs }),
          ...(options.bounds === undefined ? {} : { bounds: options.bounds })
        });
        const summary = result.status === 'rejected'
          ? summaryFromRejection(input, result)
          : summaryFromReceipt(result.receipt);
        coordinatorHostHeartbeat({ phase: 'host-dispatch-committed', dispatchEpoch: input.dispatchEpoch, outcome: summary.outcome });
        return summary;
      })();
      inFlight.set(deliveryKey, execution);
      try {
        return await execution;
      } finally {
        if (inFlight.get(deliveryKey) === execution) inFlight.delete(deliveryKey);
      }
    }
  };
}
