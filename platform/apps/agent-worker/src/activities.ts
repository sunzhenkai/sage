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
import {
  type AgentSliceResult, type ExecuteAgentSliceInput, type TaskArtifactRef,
  type TaskCommitStore, type TaskInputRef, type TaskProjection, type RunAgentSettingsStore, type TaskRunOutputStore
} from '@sage/task-domain';
import { runTaskAgentPath, type TaskCanonicalCompatibilityOptions } from './task-compatibility.js';

export interface TaskSliceInputResolver {
  resolve(inputRef: TaskInputRef, tenantId: string): Promise<string>;
}
export interface AgentTaskActivityOptions {
  readonly agentClient: LocalAgentClient;
  /** live provider 客户端：仅 package 路径的 slice 使用；未提供时全部走 agentClient（echo）。 */
  readonly packageAgentClient?: LocalAgentClient;
  /** 运行 agent 设置读取：缺省视 defaultProvider=auto（env 驱动现状）。 */
  readonly settingsStore?: Pick<RunAgentSettingsStore, 'getRunAgentSettings'>;
  readonly store: TaskCommitStore;
  readonly outputStore?: TaskRunOutputStore;
  readonly inputResolver: TaskSliceInputResolver;
  readonly leaseMs?: number;
  readonly now?: () => Date;
  readonly afterCommit?: (result: AgentSliceResult) => Promise<void> | void;
  readonly telemetry?:P6TelemetryRecorder;
  readonly canonicalCompatibility?: TaskCanonicalCompatibilityOptions;
}
export interface AgentTaskActivities { executeAgentSlice(input: ExecuteAgentSliceInput): Promise<AgentSliceResult> }

/**
 * 运行 agent 设置 → 执行 harness 的纯决策：
 * - 非 package 输入（chat 路径）恒走本地 client，设置不参与；
 * - echo：显式本地确定性 harness，即使 live 可用也不发起模型调用；
 * - minimax：必须 live；live 不可用返回 'unavailable'（调用方以稳定错误 fail-closed，绝不回退 echo）；
 * - auto（缺省）：live 可用走 live，否则回退本地（既有 env 驱动行为）。
 */
export function decidePackageRunClientChoice(
  isPackageInput: boolean,
  defaultProvider: 'auto' | 'minimax' | 'echo',
  liveClientAvailable: boolean
): 'live' | 'echo' | 'unavailable' {
  if (!isPackageInput) return 'echo';
  if (defaultProvider === 'echo') return 'echo';
  if (liveClientAvailable) return 'live';
  return defaultProvider === 'minimax' ? 'unavailable' : 'echo';
}

export function createAgentTaskActivities(options: AgentTaskActivityOptions): AgentTaskActivities {
  const now = options.now ?? (() => new Date());
  const leaseMs = options.leaseMs ?? 35_000;
  return {
    async executeAgentSlice(input): Promise<AgentSliceResult> {
      const info = activityInfo();
      if(input.sessionId&&input.runId&&input.messageId)try{options.telemetry?.record('sage_task_worker_attempt_total',1,{tenant_id:input.tenantId,message_id:input.messageId,session_id:input.sessionId,run_id:input.runId,task_id:input.taskId,workflow_id:input.workflowId,target_id:input.targetId,attempt:input.attempt},{activity_attempt:info.attempt,slice_number:input.sliceNumber});}catch{/* Telemetry cannot change Activity semantics. */}
      // 执行前依赖检查（fail-closed）：固定 minimax 而无受信 live route 时以不可重试错误显式失败，
      // 不 claim slice、不执行 echo、不写 run 输出。设置每 slice 现读，改设置即时生效。
      const isPackageInput = input.inputRef.startsWith('task-input://package/');
      const settings = isPackageInput && options.settingsStore !== undefined
        ? await options.settingsStore.getRunAgentSettings(input.tenantId)
        : undefined;
      const defaultProvider = settings?.defaultProvider ?? 'auto';
      const clientChoice = decidePackageRunClientChoice(isPackageInput, defaultProvider, options.packageAgentClient !== undefined);
      if (clientChoice === 'unavailable') {
        throw ApplicationFailure.nonRetryable(
          'PROVIDER_DEPENDENCY_MISSING: run agent default provider is pinned to minimax but MINIMAX_API_KEY is not set in the worker environment. Set MINIMAX_API_KEY and restart agent-worker, or switch the default provider back to auto/echo.',
          'PROVIDER_DEPENDENCY_MISSING'
        );
      }
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
        // echo 显式优先：即使配置了受信 key 也走本地确定性 harness；auto 保持 env 驱动现状。
        execution = await runTaskAgentPath({
          tenantId: input.tenantId,
          taskId: input.taskId,
          workflowId: input.workflowId,
          attempt: input.attempt,
          sliceNumber: input.sliceNumber,
          runId,
          idempotencyKey,
          legacySpec: spec,
          legacyClient: clientChoice === 'live' && isPackageInput
            ? options.packageAgentClient!
            : options.agentClient,
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
        if (outcome.status !== 'succeeded' && outcome.status !== 'paused') throw new Error(`AGENT_SLICE_${outcome.status.toUpperCase()}`);

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
              output: outcome.output, mediaType: 'text/plain', createdAt: now().toISOString()
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
