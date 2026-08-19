import {
  ActivityCancellationType, CancellationScope, condition, continueAsNew, defineQuery, defineSignal,
  proxyActivities, setHandler, sleep
} from '@temporalio/workflow';
import type {
  CoordinatorAdapterRef, CoordinatorCommand, CoordinatorControl, CoordinatorError, CoordinatorErrorCode,
  CoordinatorLifecycleState, CoordinatorLogicalCursor, CoordinatorObservation, CoordinatorOwnerRef,
  CoordinatorReceiptSummary, CoordinatorRuntimeRef, CoordinatorStartCommand, CoordinatorTargetRef
} from '@sage/platform-ports';

export const DURABLE_COORDINATOR_WORKFLOW_TYPE = 'DurableCoordinatorWorkflow.v1' as const;
export const DURABLE_COORDINATOR_TASK_QUEUE = 'sage-durable-coordinator-v2' as const;
export const DURABLE_COORDINATOR_COMMAND_SIGNAL = 'sage.coordinator.command.v1' as const;
export const DURABLE_COORDINATOR_RECEIPT_SIGNAL = 'sage.coordinator.receipt.v1' as const;
export const DURABLE_COORDINATOR_STATE_QUERY = 'sage.coordinator.state.v1' as const;

export interface DurableCoordinatorCarryState {
  readonly schemaVersion: '1';
  readonly observation: CoordinatorObservation;
  readonly pendingCommands: readonly CoordinatorCommand[];
  readonly pendingReceipts: readonly DurableCoordinatorReceiptDelivery[];
  readonly recordedCommandKeys: readonly string[];
}

export interface DurableCoordinatorWorkflowInput {
  readonly schemaVersion: '1';
  readonly tenantId: string;
  readonly start: CoordinatorStartCommand;
  readonly waitTimeoutMs?: number;
  readonly carry?: DurableCoordinatorCarryState;
}

export interface DurableCoordinatorReceiptDelivery {
  readonly dispatchEpoch: number;
  readonly invocationId: string;
  readonly receipt: CoordinatorReceiptSummary;
}

export interface DurableCoordinatorDispatchInput {
  readonly schemaVersion: '1';
  readonly tenantId: string;
  readonly envelope: CoordinatorStartCommand['envelope'];
  readonly dispatchEpoch: number;
  readonly invocationId: string;
  readonly priorReceiptRefs?: readonly string[];
  readonly ownerRef: CoordinatorOwnerRef;
  readonly targetRef: CoordinatorTargetRef;
  readonly adapterRef: CoordinatorAdapterRef;
  readonly runtimeRef: CoordinatorRuntimeRef;
}

interface DurableCoordinatorActivities {
  executeCoordinatorDispatch(input: DurableCoordinatorDispatchInput): Promise<CoordinatorReceiptSummary>;
}

const { executeCoordinatorDispatch } = proxyActivities<DurableCoordinatorActivities>({
  startToCloseTimeout: '35 seconds',
  scheduleToCloseTimeout: '2 minutes',
  heartbeatTimeout: '1 second',
  cancellationType: ActivityCancellationType.WAIT_CANCELLATION_COMPLETED,
  retry: { initialInterval: '100 milliseconds', backoffCoefficient: 2, maximumInterval: '2 seconds', maximumAttempts: 5 }
});

/** Temporal SDK identity is adapter metadata only and is never part of canonical observation/commands. */
export interface TemporalCoordinatorEdgeIdentity {
  readonly workflowId: string;
  readonly runId?: string;
  readonly historyEventId?: string;
  readonly buildId?: string;
  readonly taskQueue?: string;
}

interface TemporalCoordinatorErrorShape {
  readonly name?: string;
  readonly code?: string;
  readonly message?: string;
  readonly retryable?: boolean;
}

const temporalErrorCode = (error: unknown): string => {
  if (!error || typeof error !== 'object') return 'UNKNOWN_TEMPORAL_ERROR';
  const candidate = error as TemporalCoordinatorErrorShape;
  return candidate.code ?? candidate.name ?? 'UNKNOWN_TEMPORAL_ERROR';
};

const canonicalErrorCode = (error: unknown): CoordinatorErrorCode => {
  const code = temporalErrorCode(error).toUpperCase();
  if (code.includes('NOT_FOUND')) return 'COORDINATOR_NOT_FOUND';
  if (code.includes('ACTIVITY_NOT_FOUND') || code.includes('ACTIVITYNOTFOUND') || code.includes('TARGET')) return 'TARGET_UNAVAILABLE';
  if (code.includes('UNAUTH') || code.includes('FORBIDDEN') || code.includes('PERMISSION')) return 'COMMAND_NOT_AUTHORIZED';
  if (code.includes('PAYLOAD') || code.includes('SIZE') || code.includes('TOO_LARGE')) return 'PAYLOAD_BOUND_EXCEEDED';
  if (code.includes('REVISION') || code.includes('CONFLICT')) return 'REVISION_CONFLICT';
  if (code.includes('CANCEL')) return 'INVALID_TRANSITION';
  return 'COORDINATOR_UNAVAILABLE';
};

/**
 * Converts SDK/provider-shaped failure values to the stable canonical taxonomy.
 * Workflow/run/history/build/task-queue metadata is deliberately ignored.
 */
export function normalizeTemporalCoordinatorError(error: unknown): CoordinatorError {
  const code = canonicalErrorCode(error);
  return {
    code,
    safeMessage: code,
    retryable: code === 'COORDINATOR_UNAVAILABLE' || code === 'TARGET_UNAVAILABLE'
  };
}

const MAX_PENDING_COMMANDS = 128;
const MAX_PENDING_RECEIPTS = 128;
const MAX_RECORDED_COMMAND_KEYS = 128;
const MAX_COMMANDS_BEFORE_CONTINUE_AS_NEW = 96;
const terminalStates: readonly CoordinatorLifecycleState[] = ['COMPLETED', 'FAILED', 'CANCELLED', 'TIMED_OUT', 'EFFECT_UNKNOWN'];
const isTerminal = (state: CoordinatorLifecycleState): boolean => terminalStates.includes(state);

function initialObservation(input: DurableCoordinatorWorkflowInput): CoordinatorObservation {
  const { envelope, ownerRef, targetRef, adapterRef, runtimeRef } = input.start;
  const cursor: CoordinatorLogicalCursor = {
    schemaVersion: '1', cursorRef: `cursor://${envelope.taskId}/${envelope.attemptId}/0`, sequence: 0,
    // The immutable Spec digest is the initial bounded state digest until a reducer command advances it.
    stateDigest: envelope.specDigest
  };
  return {
    schemaVersion: '1', tenantId: input.tenantId, taskId: envelope.taskId, runId: envelope.runId,
    attemptId: envelope.attemptId, specDigest: envelope.specDigest, path: 'DURABLE_COORDINATOR_V2',
    state: 'READY', revision: 1, dispatchEpoch: 0, controlSequence: 0, logicalCursor: cursor,
    ownerRef, targetRef, adapterRef, runtimeRef, activeInvocationId: envelope.invocationId,
    receiptRefs: [], artifactRefs: []
  };
}

function uniqueBounded(values: readonly string[], additions: readonly string[]): string[] {
  const result = [...values];
  for (const value of additions) if (!result.includes(value)) result.push(value);
  return result.slice(-128);
}

function applyControl(observation: CoordinatorObservation, command: CoordinatorCommand): CoordinatorObservation {
  if (command.expectedRevision !== observation.revision || command.type === 'START') return observation;
  if ((command.type === 'PAUSE' || command.type === 'RESUME' || command.type === 'CANCEL' || command.type === 'RETRY')
    && command.controlSequence !== undefined && command.controlSequence <= observation.controlSequence) return observation;
  if (command.type === 'DISPATCH' && (observation.state === 'READY' || observation.state === 'WAITING')) {
    return { ...observation, state: 'DISPATCHED', revision: observation.revision + 1,
      dispatchEpoch: observation.dispatchEpoch + 1, activeInvocationId: command.invocationId };
  }
  if (command.type === 'WAIT' && (observation.state === 'DISPATCHED' || observation.state === 'WAITING')) {
    return { ...observation, state: 'WAITING', revision: observation.revision + 1 };
  }
  if (command.type === 'SIGNAL' && !isTerminal(observation.state)) {
    return { ...observation, revision: observation.revision + 1 };
  }
  if (command.type === 'PAUSE' && (observation.state === 'DISPATCHED' || observation.state === 'WAITING')) {
    return {
      ...observation,
      ...(observation.state === 'WAITING' ? { state: 'PAUSED', effectiveControl: 'PAUSE' } : {}),
      requestedControl: 'PAUSE', controlSequence: command.controlSequence ?? observation.controlSequence + 1,
      revision: observation.revision + 1
    };
  }
  if (command.type === 'RESUME' && observation.state === 'PAUSED') {
    return { ...observation, state: 'WAITING', requestedControl: 'RESUME', effectiveControl: 'RESUME',
      controlSequence: command.controlSequence ?? observation.controlSequence + 1, revision: observation.revision + 1 };
  }
  if (command.type === 'CANCEL' && !isTerminal(observation.state)) {
    return { ...observation, state: 'CANCELLED', requestedControl: 'CANCEL', effectiveControl: 'CANCEL',
      controlSequence: command.controlSequence ?? observation.controlSequence + 1, revision: observation.revision + 1 };
  }
  if (command.type === 'RETRY' && observation.state !== 'EFFECT_UNKNOWN' && (observation.state === 'WAITING' || observation.state === 'PAUSED')) {
    const invocationId = command.invocationId ?? observation.activeInvocationId;
    return { ...observation, state: 'DISPATCHED', revision: observation.revision + 1,
      dispatchEpoch: command.retryKind === 'DELIVERY' ? observation.dispatchEpoch : observation.dispatchEpoch + 1,
      ...(invocationId === undefined ? {} : { activeInvocationId: invocationId }), requestedControl: 'RETRY', effectiveControl: 'RETRY',
      controlSequence: command.controlSequence ?? observation.controlSequence + 1 };
  }
  if (command.type === 'TIMEOUT' && !isTerminal(observation.state)) {
    return { ...observation, state: 'TIMED_OUT', revision: observation.revision + 1 };
  }
  if (command.type === 'CONTINUE' && !isTerminal(observation.state)
    && command.cursor.sequence > observation.logicalCursor.sequence
    && command.stateDigest === command.cursor.stateDigest) {
    return { ...observation, logicalCursor: command.cursor, revision: observation.revision + 1 };
  }
  return observation;
}

function advanceLogicalCursor(observation: CoordinatorObservation): CoordinatorObservation {
  const previous = observation.logicalCursor;
  const sequence = previous.sequence + 1;
  const logicalCursor: CoordinatorLogicalCursor = {
    schemaVersion: '1', cursorRef: `cursor://${observation.taskId}/${observation.attemptId}/${sequence}`,
    previousCursorRef: previous.cursorRef, sequence, stateDigest: previous.stateDigest
  };
  return { ...observation, logicalCursor, revision: observation.revision + 1 };
}

function createCarryState(
  observation: CoordinatorObservation,
  pendingCommands: readonly CoordinatorCommand[],
  pendingReceipts: readonly DurableCoordinatorReceiptDelivery[],
  recordedCommandKeys: readonly string[]
): DurableCoordinatorCarryState {
  return {
    schemaVersion: '1', observation,
    pendingCommands: pendingCommands.slice(-MAX_PENDING_COMMANDS),
    pendingReceipts: pendingReceipts.slice(-MAX_PENDING_RECEIPTS),
    recordedCommandKeys: recordedCommandKeys.slice(-MAX_RECORDED_COMMAND_KEYS)
  };
}

function applyReceipt(observation: CoordinatorObservation, delivery: DurableCoordinatorReceiptDelivery): CoordinatorObservation {
  if (delivery.dispatchEpoch !== observation.dispatchEpoch || delivery.invocationId !== observation.activeInvocationId || isTerminal(observation.state)) return observation;
  const stateByOutcome: Record<CoordinatorReceiptSummary['outcome'], CoordinatorLifecycleState> = {
    CONTINUE: 'WAITING', COMPLETED: 'COMPLETED', FAILED: 'FAILED', WAITING_FOR_USER: 'WAITING',
    WAITING_FOR_APPROVAL: 'WAITING', PAUSED: 'PAUSED', CANCELLED: 'CANCELLED', EFFECT_UNKNOWN: 'EFFECT_UNKNOWN'
  };
  const nextState = stateByOutcome[delivery.receipt.outcome];
  return {
    ...observation,
    state: delivery.receipt.outcome !== 'EFFECT_UNKNOWN' && delivery.receipt.outcome !== 'CANCELLED'
      && observation.requestedControl === 'PAUSE' ? 'PAUSED' : nextState,
    revision: observation.revision + 1,
    receiptRefs: uniqueBounded(observation.receiptRefs, [delivery.receipt.receiptRef, ...delivery.receipt.receiptRefs]),
    artifactRefs: uniqueBounded(observation.artifactRefs, delivery.receipt.artifactRefs), lastReceipt: delivery.receipt,
    ...(delivery.receipt.outcome !== 'EFFECT_UNKNOWN' && delivery.receipt.outcome !== 'CANCELLED'
      && observation.requestedControl === 'PAUSE' ? { effectiveControl: 'PAUSE' as const } : {}),
    ...(delivery.receipt.outcome === 'EFFECT_UNKNOWN' ? { blockedCode: 'EFFECT_UNKNOWN' } : {})
  };}

function timeoutCommand(observation: CoordinatorObservation): CoordinatorCommand {
  return {
    schemaVersion: '1', type: 'TIMEOUT', commandKey: `timer:${observation.dispatchEpoch}:${observation.revision}`,
    expectedRevision: observation.revision
  };
}

async function waitForCoordinatorEventOrTimeout(
  observation: CoordinatorObservation,
  pendingCommands: CoordinatorCommand[],
  pendingReceipts: readonly DurableCoordinatorReceiptDelivery[],
  timeoutMs: number | undefined
): Promise<void> {
  if (pendingCommands.length > 0 || pendingReceipts.length > 0) return;
  if (timeoutMs === undefined) {
    await condition(() => pendingCommands.length > 0 || pendingReceipts.length > 0);
    return;
  }

  const timerScope = new CancellationScope();
  const timer = timerScope.run(async () => {
    await sleep(timeoutMs);
    return 'timeout' as const;
  }).catch(() => 'cancelled' as const);
  const event = condition(() => pendingCommands.length > 0 || pendingReceipts.length > 0)
    .then(() => 'event' as const);
  const winner = await Promise.race([timer, event]);
  if (winner === 'timeout' && pendingCommands.length === 0 && pendingReceipts.length === 0) {
    pendingCommands.push(timeoutCommand(observation));
  }
  timerScope.cancel();
}

/**
 * V2 workflow boundary. It stores only the admitted envelope identity, opaque refs/digests,
 * bounded lifecycle state and receipt summaries. Host dispatch is a ref-only Durable Activity;
 * WAIT uses condition plus an optional deterministic Timer, while controls and observation use
 * versioned Signal and bounded Query handlers. The legacy AgentTaskWorkflow is not imported or modified.
 */
export async function DurableCoordinatorWorkflow(input: DurableCoordinatorWorkflowInput): Promise<CoordinatorObservation> {
  let observation = input.carry?.observation ?? initialObservation(input);
  const pendingCommands: CoordinatorCommand[] = [...(input.carry?.pendingCommands ?? [])];
  const pendingReceipts: DurableCoordinatorReceiptDelivery[] = [...(input.carry?.pendingReceipts ?? [])];
  const recordedCommandKeys: string[] = [...(input.carry?.recordedCommandKeys ?? [input.start.commandKey])];
  let commandsSinceContinue = 0;
  let activeDispatchScope: CancellationScope | undefined;
  let dispatchCancellationRequested = false;

  const commandSignal = defineSignal<[CoordinatorCommand]>(DURABLE_COORDINATOR_COMMAND_SIGNAL);
  const receiptSignal = defineSignal<[DurableCoordinatorReceiptDelivery]>(DURABLE_COORDINATOR_RECEIPT_SIGNAL);
  const stateQuery = defineQuery<CoordinatorObservation>(DURABLE_COORDINATOR_STATE_QUERY);
  setHandler(stateQuery, () => observation);
  setHandler(commandSignal, (command) => {
    if (pendingCommands.length < MAX_PENDING_COMMANDS) pendingCommands.push(command);
    if (command.type === 'CANCEL' && activeDispatchScope !== undefined) {
      dispatchCancellationRequested = true;
      activeDispatchScope.cancel();
    }
  });
  setHandler(receiptSignal, (delivery) => {
    if (pendingReceipts.length < MAX_PENDING_RECEIPTS) pendingReceipts.push(delivery);
  });

  while (!isTerminal(observation.state)) {
    await waitForCoordinatorEventOrTimeout(
      observation, pendingCommands, pendingReceipts,
      observation.state === 'WAITING' ? input.waitTimeoutMs : undefined
    );
    const command = pendingCommands.shift();
    const receipt = pendingReceipts.shift();
    if (command !== undefined) {
      if (!recordedCommandKeys.includes(command.commandKey)) {
        if (recordedCommandKeys.length >= MAX_RECORDED_COMMAND_KEYS) recordedCommandKeys.shift();
        recordedCommandKeys.push(command.commandKey);
        observation = applyControl(observation, command);

        const dispatching = command.type === 'DISPATCH' || command.type === 'RETRY';
        const invocationId = observation.activeInvocationId;
        if (dispatching && observation.state === 'DISPATCHED' && invocationId !== undefined) {
          const scope = new CancellationScope();
          activeDispatchScope = scope;
          try {
            const dispatchEnvelope = invocationId === input.start.envelope.invocationId
              ? input.start.envelope
              : { ...input.start.envelope, invocationId };
            const priorReceiptRefs = command.type === 'RETRY' && command.retryKind === 'SEMANTIC'
              ? command.receiptRefs
              : undefined;
            const receiptSummary = await scope.run(() => executeCoordinatorDispatch({
              schemaVersion: '1', tenantId: input.tenantId, envelope: dispatchEnvelope, dispatchEpoch: observation.dispatchEpoch,
              invocationId, ...(priorReceiptRefs === undefined ? {} : { priorReceiptRefs }), ownerRef: observation.ownerRef, targetRef: observation.targetRef,
              adapterRef: observation.adapterRef, runtimeRef: observation.runtimeRef
            }));
            observation = applyReceipt(observation, { dispatchEpoch: observation.dispatchEpoch, invocationId, receipt: receiptSummary });
          } catch (cause) {
            if (!dispatchCancellationRequested) throw cause;
            dispatchCancellationRequested = false;
          } finally {
            if (activeDispatchScope === scope) activeDispatchScope = undefined;
          }
        }
      }
    } else if (receipt !== undefined) {
      observation = applyReceipt(observation, receipt);
    }

    if (command !== undefined || receipt !== undefined) {
      commandsSinceContinue += 1;
      if (commandsSinceContinue >= MAX_COMMANDS_BEFORE_CONTINUE_AS_NEW && !isTerminal(observation.state)) {
        const carriedObservation = advanceLogicalCursor(observation);
        return continueAsNew<typeof DurableCoordinatorWorkflow>({
          ...input,
          carry: createCarryState(carriedObservation, pendingCommands, pendingReceipts, recordedCommandKeys)
        });
      }
    }
  }
  return observation;
}

export const durableCoordinatorDeterministicTestHooks = {
  initialObservation,
  applyControl,
  applyReceipt,
  timeoutCommand,
  advanceLogicalCursor,
  createCarryState
} as const;

export type DurableCoordinatorControl = CoordinatorControl;
