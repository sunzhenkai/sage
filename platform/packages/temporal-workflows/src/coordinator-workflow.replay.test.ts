import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  assertCoordinatorCommand,
  createCoordinatorReducerState,
  reduceCoordinatorCommand,
  type CoordinatorCommand,
  type CoordinatorReceiptSummary,
  type CoordinatorStartCommand
} from '../../platform-ports/src/index.js';
import {
  durableCoordinatorDeterministicTestHooks,
  type DurableCoordinatorReceiptDelivery,
  type DurableCoordinatorWorkflowInput
} from './coordinator-workflow.js';

const digest = `sha256:${'a'.repeat(64)}`;

const start: CoordinatorStartCommand = {
  schemaVersion: '1', type: 'START', commandKey: 'start-1', expectedRevision: 0,
  envelope: {
    schemaVersion: '1', specRef: 'spec://tenant/task', specDigest: digest,
    taskId: 'task', runId: 'run', attemptId: 'attempt', invocationId: 'invoke-1'
  },
  ownerRef: 'owner://tenant/task', targetRef: 'target://coordinator/v2',
  adapterRef: 'adapter://coordinator/v2', runtimeRef: 'runtime://contract/1'
};

const input: DurableCoordinatorWorkflowInput = { schemaVersion: '1', tenantId: 'tenant', start };

const receipt: CoordinatorReceiptSummary = {
  schemaVersion: '1', receiptRef: 'receipt://tenant/invoke-1', receiptDigest: digest,
  outcome: 'COMPLETED', receiptRefs: [], artifactRefs: []
};

function replayDeterministicTrace() {
  const hooks = durableCoordinatorDeterministicTestHooks;
  let observation = hooks.initialObservation(input);
  observation = hooks.applyControl(observation, {
    schemaVersion: '1', type: 'DISPATCH', commandKey: 'dispatch-1', expectedRevision: observation.revision,
    invocationId: 'invoke-1'
  });
  observation = hooks.applyControl(observation, {
    schemaVersion: '1', type: 'WAIT', commandKey: 'wait-1', expectedRevision: observation.revision
  });
  observation = hooks.applyControl(observation, {
    schemaVersion: '1', type: 'SIGNAL', commandKey: 'signal-1', expectedRevision: observation.revision,
    signalRef: 'signal://tenant/approval', signalDigest: digest
  });
  const beforeContinue = observation;
  const advanced = hooks.advanceLogicalCursor(beforeContinue);
  observation = hooks.applyControl(beforeContinue, {
    schemaVersion: '1', type: 'CONTINUE', commandKey: 'continue-1', expectedRevision: beforeContinue.revision,
    stateDigest: digest, cursor: advanced.logicalCursor
  });
  const timeout = hooks.timeoutCommand(observation);
  const timedOut = hooks.applyControl(observation, timeout);
  return { observation, timeout, timedOut };
}

describe('DurableCoordinatorWorkflow deterministic replay boundary', () => {
  it('replays Timer, Signal, timeout and logical continue transitions identically', () => {
    const first = replayDeterministicTrace();
    const second = replayDeterministicTrace();

    expect(second).toEqual(first);
    expect(first.observation.state).toBe('WAITING');
    expect(first.observation.logicalCursor).toMatchObject({ sequence: 1, previousCursorRef: 'cursor://task/attempt/0' });
    expect(first.timeout).toMatchObject({
      type: 'TIMEOUT', commandKey: 'timer:1:5', expectedRevision: first.observation.revision
    });
    expect(first.timedOut).toMatchObject({ state: 'TIMED_OUT', revision: first.observation.revision + 1 });
  });

  it('keeps receipt fencing, bounded carry and payload limits deterministic', () => {
    const hooks = durableCoordinatorDeterministicTestHooks;
    const observation = hooks.applyControl(hooks.initialObservation(input), {
      schemaVersion: '1', type: 'DISPATCH', commandKey: 'dispatch-1', expectedRevision: 1, invocationId: 'invoke-1'
    });
    const delivery: DurableCoordinatorReceiptDelivery = { dispatchEpoch: 1, invocationId: 'invoke-1', receipt };
    const completed = hooks.applyReceipt(observation, delivery);
    expect(completed).toMatchObject({ state: 'COMPLETED', lastReceipt: receipt });
    expect(hooks.applyReceipt(completed, {
      ...delivery, receipt: { ...receipt, receiptRef: 'receipt://tenant/late', outcome: 'EFFECT_UNKNOWN' }
    })).toEqual(completed);

    const pendingCommands: CoordinatorCommand[] = Array.from({ length: 140 }, (_, index) => ({
      schemaVersion: '1', type: 'WAIT', commandKey: `wait-${index}`, expectedRevision: 1
    }));
    const carry = hooks.createCarryState(observation, pendingCommands, [delivery], ['start-1']);
    expect(carry.pendingCommands).toHaveLength(128);
    expect(carry.pendingReceipts).toHaveLength(1);
    expect(carry.recordedCommandKeys).toEqual(['start-1']);

    const largeCommand: CoordinatorCommand = {
      schemaVersion: '1', type: 'RETRY', commandKey: 'retry-large', expectedRevision: 1,
      retryKind: 'DELIVERY', receiptRefs: Array.from(
        { length: 128 }, (_, index) => `receipt://large/${index}/${'r'.repeat(2_015 - String(index).length)}`
      )
    };
    expect(() => assertCoordinatorCommand(largeCommand)).toThrow('PAYLOAD_BOUND_EXCEEDED');
  });

  it('rejects an intentional same-key command drift as a deterministic replay conflict', () => {
    const observation = durableCoordinatorDeterministicTestHooks.initialObservation(input);
    const state = createCoordinatorReducerState(observation);
    const original: CoordinatorCommand = {
      schemaVersion: '1', type: 'SIGNAL', commandKey: 'drift-key', expectedRevision: observation.revision,
      signalRef: 'signal://tenant/original', signalDigest: digest
    };
    const drifted: CoordinatorCommand = {
      ...original, signalRef: 'signal://tenant/drifted', signalDigest: `sha256:${'b'.repeat(64)}`
    };
    const first = reduceCoordinatorCommand(state, original);
    expect(first.result.status).toBe('applied');
    const replay = reduceCoordinatorCommand(first.state, drifted);
    expect(replay.result).toMatchObject({ status: 'conflict', code: 'COMMAND_KEY_CONFLICT' });
    expect(replay.state).toEqual(first.state);
  });

  it('keeps the workflow source deterministic and free of wall-clock/random decisions', () => {
    const source = readFileSync(fileURLToPath(new URL('./coordinator-workflow.ts', import.meta.url)), 'utf8');
    expect(source).not.toMatch(/Math\.random|Date\.now|new Date\s*\(/);
    expect(source).toContain('sleep(timeoutMs)');
    expect(source).toContain('continueAsNew<typeof DurableCoordinatorWorkflow>');
  });
});
