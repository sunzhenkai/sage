import { describe, expect, it } from 'vitest';
import { resolveTrustedModelFromSnapshot, TrustedModelResolutionError } from './index.js';
import type { TrustedModelCatalogBuild, TrustedModelCatalogSnapshot, TrustedModelResolutionRequest } from './index.js';
import { Value } from 'typebox/value';
import {
  CredentialResolutionRequestSchema,
  ReferenceEnvelopeSchema,
  RuntimeCorrelationSchema,
  ToolCorrelationSchema,
  assertCredentialResolutionRequest,
  assertNoSensitiveData,
  assertReferenceEnvelope,
  assertRuntimeCorrelation,
  assertToolCorrelation
} from './index.js';
import {
  CoordinatorCommandSchema,
  CoordinatorObservationSchema,
  CoordinatorStartCommandSchema,
  assertCoordinatorCommand,
  admitNewAttempt,
  assertCoordinatorEnvelope,
  assertCoordinatorReceiptSummary,
  assertCoordinatorStartCommand,
  applyCoordinatorReceipt,
  createCoordinatorReducerState,
  reduceCoordinatorCommand
} from './index.js';
import type { CoordinatorCommand, CoordinatorObservation, CoordinatorReceiptSummary, DurableCoordinatorPort } from './index.js';
import type {
  AgentEventStorePort,
  AgentTaskSpecStorePort,
  BoundedRunReceiptStorePort,
  CheckpointStorePort
} from './index.js';
import type { AgentEventV2, AgentTaskSpec, BoundedRunReceipt, CheckpointCandidate, SealedCheckpointRef } from '@sage/agent-contracts';

describe('platform runtime schemas', () => {
  it('accepts only explicit correlation identifiers', () => {
    const run = { run_id: 'run-1', task_id: 'task-1', attempt: 1 };
    const tool = { ...run, tool_call_id: 'call-1' };
    expect(Value.Check(RuntimeCorrelationSchema, run)).toBe(true);
    expect(Value.Check(ToolCorrelationSchema, tool)).toBe(true);
    expect(() => assertRuntimeCorrelation({ ...run, token: 'x' })).toThrow('INVALID_RUNTIME_CORRELATION');
    expect(() => assertToolCorrelation({ run_id: 'run-1', attempt: 1 })).toThrow('INVALID_TOOL_CORRELATION');
  });

  it('validates reference-only envelopes and credential resolution requests', () => {
    const envelope = {
      artifact_ref: 'artifact://tenant/object', connection_ref: 'connection://crm', secret_ref: 'secret://crm/key',
      checkpoint_ref: 'checkpoint://run/1', session_ref: 'session://tenant/session-1', run_ref: 'run://tenant/run-1',
      context_ref: 'context://tenant/context-1', data: { locale: 'en' }
    };
    const request = { secretRef: 'secret://crm/key', connectionRef: 'connection://crm', tenantId: 'tenant-a', environment: 'staging', purpose: 'tool://read/v1', scope: 'contacts:read' };
    expect(Value.Check(ReferenceEnvelopeSchema, envelope)).toBe(true);
    expect(Value.Check(CredentialResolutionRequestSchema, request)).toBe(true);
    expect(() => assertReferenceEnvelope(envelope)).not.toThrow();
    expect(() => assertCredentialResolutionRequest(request)).not.toThrow();
    expect(() => assertCredentialResolutionRequest({ ...request, scope: undefined })).toThrow('INVALID_CREDENTIAL_REQUEST');
  });

  it('recursively rejects malformed snake-case and camel-case reference values', () => {
    for (const malformed of [
      { data: { secret_ref: 'plain-text-credential' } },
      { data: { nested: [{ artifact_ref: 'https://example.invalid/object' }] } },
      { data: { checkpoint_ref: 'checkpoint-1' } },
      { data: { session_ref: 'session-1' } },
      { data: { runRef: 'run-1' } },
      { data: { contextRef: 'context-1' } }
    ]) expect(() => assertReferenceEnvelope(malformed)).toThrow('INVALID_REFERENCE_VALUE');

    expect(() => assertNoSensitiveData({ nested: { runRef: 'run://tenant/run-1', context_ref: 'context://tenant/context-1' } })).not.toThrow();
    expect(() => assertNoSensitiveData({ nested: { secretRef: 'plain-text-credential' } })).toThrow('INVALID_REFERENCE_VALUE');
  });

  it('recursively rejects sensitive keys, patterns, bytes, and known secrets', () => {
    expect(() => assertNoSensitiveData({ nested: [{ password: 'plain' }] })).toThrow('SENSITIVE_DATA_LEAK_DETECTED');
    expect(() => assertNoSensitiveData({ value: 'Bearer abcdefghijklmnop' })).toThrow('SENSITIVE_DATA_LEAK_DETECTED');
    expect(() => assertNoSensitiveData({ value: new Uint8Array([1]) })).toThrow('SENSITIVE_DATA_LEAK_DETECTED');
    expect(() => assertNoSensitiveData({ value: 'opaque-value' }, ['opaque-value'])).toThrow('SENSITIVE_DATA_LEAK_DETECTED');
    expect(() => assertNoSensitiveData({ secret_ref: 'secret://safe/token-abcdefghijkl' })).not.toThrow();
  });
});


describe('canonical authority store ports', () => {
  it('exposes only canonical contracts with explicit tenant and writer-fence boundaries', async () => {
    const digest = `sha256:${'a'.repeat(64)}`;
    const spec: AgentTaskSpec = { schemaVersion: '1', specRef: 'spec://tenant/a', specDigest: digest, taskId: 'task', runId: 'run', attemptId: 'attempt', releaseRef: 'release://tenant/a', releaseDigest: digest, principalRef: 'principal://tenant/user', tenantId: 'tenant', goalRef: 'artifact://tenant/goal', engineId: 'reference', skillRefs: [], modelRouteRef: 'model-route://fixed', contextPlanRef: 'context-plan://fixed', capabilityGrantRef: 'grant://fixed', executionPolicyRef: 'policy://fixed', boundsRef: 'bounds://fixed', governanceRef: 'governance://fixed', admittedAt: '2026-08-15T00:00:00.000Z' };
    const receipt: BoundedRunReceipt = { schemaVersion: '1', receiptRef: 'receipt://tenant/one', invocationId: 'invoke', specDigest: digest, outcome: 'COMPLETED', eventRange: { first: 1, last: 1 }, receiptRefs: [], artifactRefs: [] };
    const event: AgentEventV2 = { schemaVersion: '2', eventId: 'event-1', taskId: 'task', runId: 'run', attemptId: 'attempt', invocationId: 'invoke', specDigest: digest, sequence: 1, type: 'run.completed', payload: { source: 'reference' } };
    const candidate: CheckpointCandidate = { schemaVersion: '1', candidateDigest: digest, taskId: 'task', runId: 'run', attemptId: 'attempt', specDigest: digest, sequence: 1, state: { schemaVersion: '1', observationRefs: [], receiptRefs: [] }, engineCodec: 'reference@1', runtimeContractMajor: 1, receiptRefs: [] };
    const sealed: SealedCheckpointRef = { checkpointRef: 'checkpoint://tenant/one', candidateDigest: digest, specDigest: digest, sequence: 1, engineCodec: 'reference@1', runtimeContractMajor: 1 };
    const health = async () => ({ healthy: true, checkedAt: '2026-08-15T00:00:00.000Z' });
    const specStore: AgentTaskSpecStorePort = { putSpec: async () => ({ status: 'stored', value: spec }), getSpec: async () => spec, health };
    const receiptStore: BoundedRunReceiptStorePort = { putReceipt: async () => ({ status: 'stored', value: receipt }), getReceipt: async () => receipt, health };
    const fence = { tenantId: 'tenant', taskId: 'task', runId: 'run', attemptId: 'attempt', ownerToken: 'writer', epoch: 1 };
    const eventStore: AgentEventStorePort = { acquireWriterFence: async () => ({ status: 'acquired', fence }), appendEvent: async () => ({ status: 'appended', event }), listEvents: async () => [event], health };
    const checkpointStore: CheckpointStorePort = { stageCandidate: async () => ({ status: 'staged', candidate }), sealCandidate: async () => ({ status: 'sealed', checkpoint: sealed }), getSealedCheckpoint: async () => sealed, health };

    expect(await specStore.putSpec({ tenantId: 'tenant', spec })).toMatchObject({ status: 'stored' });
    expect(await receiptStore.putReceipt({ tenantId: 'tenant', receipt, receiptDigest: digest })).toMatchObject({ status: 'stored' });
    const acquired = await eventStore.acquireWriterFence({ ...fence, ownerToken: 'writer' });
    if (acquired.status !== 'acquired') throw new Error('test fence was not acquired');
    expect(await eventStore.appendEvent({ fence: acquired.fence, event })).toMatchObject({ status: 'appended' });
    expect(await checkpointStore.stageCandidate({ tenantId: 'tenant', fence: acquired.fence, candidate })).toMatchObject({ status: 'staged' });
    expect(await checkpointStore.sealCandidate({ tenantId: 'tenant', fence: acquired.fence, candidateDigest: digest })).toMatchObject({ status: 'sealed' });
    expect(await checkpointStore.getSealedCheckpoint({ tenantId: 'tenant', checkpointRef: sealed.checkpointRef, taskId: 'task', runId: 'run', attemptId: 'attempt', specDigest: digest, engineCodec: 'reference@1', runtimeContractMajor: 1 })).toEqual(sealed);
  });

  it('exposes an SDK-neutral coordinator port with reference-only commands and observations', async () => {
    const digest = `sha256:${'a'.repeat(64)}`;
    const envelope = { schemaVersion: '1' as const, specRef: 'spec://tenant/task', specDigest: digest, taskId: 'task', runId: 'run', attemptId: 'attempt', invocationId: 'invoke' };
    const start = { schemaVersion: '1' as const, type: 'START' as const, commandKey: 'start-1', expectedRevision: 0, envelope, ownerRef: 'owner://tenant/task', targetRef: 'target://coordinator/v2', adapterRef: 'adapter://coordinator/v2', runtimeRef: 'runtime://contract/1' };
    expect(Value.Check(CoordinatorStartCommandSchema, start)).toBe(true);
    expect(Value.Check(CoordinatorStartCommandSchema, { ...start, workflowId: 'forbidden-implementation-detail' })).toBe(false);
    expect(Value.Check(CoordinatorCommandSchema, { schemaVersion: '1', type: 'SIGNAL', commandKey: 'signal-1', expectedRevision: 0, signalRef: 'signal://pause', signalDigest: digest })).toBe(true);
    expect(Value.Check(CoordinatorCommandSchema, { ...start, type: 'DISPATCH', invocationId: 'invoke', body: 'forbidden' })).toBe(false);
    expect(() => assertCoordinatorEnvelope({ ...envelope, workflowId: 'forbidden-implementation-detail' })).toThrow('ENVELOPE_INVALID');
    expect(() => assertCoordinatorStartCommand({ ...start, secret: 'forbidden-secret' })).toThrow('COMMAND_SCHEMA_INVALID');
    expect(() => assertCoordinatorStartCommand(start)).not.toThrow();
    expect(() => assertCoordinatorCommand({ schemaVersion: '1', type: 'PAUSE', commandKey: 'pause-1', expectedRevision: 0 })).not.toThrow();

    const largeCommand = {
      schemaVersion: '1' as const, type: 'RETRY' as const, commandKey: 'retry-large', expectedRevision: 0,
      retryKind: 'DELIVERY' as const,
      receiptRefs: Array.from({ length: 128 }, (_, index) => `receipt://large/${index}/${'r'.repeat(2_015 - String(index).length)}`)
    };
    expect(() => assertCoordinatorCommand(largeCommand)).toThrow('PAYLOAD_BOUND_EXCEEDED');

    const receiptSummary = {
      schemaVersion: '1' as const, receiptRef: 'receipt://tenant/invoke', receiptDigest: digest, outcome: 'COMPLETED' as const,
      receiptRefs: Array.from({ length: 128 }, (_, index) => `receipt://tenant/${index}`), artifactRefs: [] as string[]
    };
    expect(() => assertCoordinatorReceiptSummary(receiptSummary)).not.toThrow();
    expect(() => assertCoordinatorReceiptSummary({ ...receiptSummary, artifactRefs: ['artifact://tenant/result'] })).toThrow('REFERENCE_BOUND_EXCEEDED');
    expect(() => assertCoordinatorReceiptSummary({ ...receiptSummary, output: 'inline-body-forbidden' })).toThrow('RECEIPT_SUMMARY_SCHEMA_INVALID');

    const observation: CoordinatorObservation = {
      schemaVersion: '1', tenantId: 'tenant', taskId: 'task', runId: 'run', attemptId: 'attempt', specDigest: digest,
      path: 'DURABLE_COORDINATOR_V2', state: 'READY', revision: 0, dispatchEpoch: 0, controlSequence: 0,
      logicalCursor: { schemaVersion: '1', cursorRef: 'cursor://tenant/task/0', sequence: 0, stateDigest: digest },
      ownerRef: 'owner://tenant/task', targetRef: 'target://coordinator/v2', adapterRef: 'adapter://coordinator/v2', runtimeRef: 'runtime://contract/1',
      receiptRefs: [], artifactRefs: []
    };
    expect(Value.Check(CoordinatorObservationSchema, observation)).toBe(true);
    expect(Value.Check(CoordinatorObservationSchema, { ...observation, history: [{ event: 'forbidden' }] })).toBe(false);

    const health = async () => ({ healthy: true, checkedAt: '2026-08-15T00:00:00.000Z' });
    const port: DurableCoordinatorPort = {
      start: async () => ({ status: 'applied', observation }),
      command: async () => ({ status: 'duplicate', observation }),
      observe: async () => observation,
      health
    };
    expect(await port.start(start)).toMatchObject({ status: 'applied', observation: { path: 'DURABLE_COORDINATOR_V2' } });
    expect(await port.command({ schemaVersion: '1', type: 'PAUSE', commandKey: 'pause-1', expectedRevision: 0 })).toMatchObject({ status: 'duplicate' });
    expect(await port.observe({ tenantId: 'tenant', taskId: 'task', runId: 'run', attemptId: 'attempt', specDigest: digest })).toEqual(observation);
  });

  it('reduces lifecycle commands with requested/effective controls and terminal precedence', () => {
    const digest = `sha256:${'a'.repeat(64)}`;
    const observation: CoordinatorObservation = {
      schemaVersion: '1', tenantId: 'tenant', taskId: 'task', runId: 'run', attemptId: 'attempt', specDigest: digest,
      path: 'DURABLE_COORDINATOR_V2', state: 'READY', revision: 0, dispatchEpoch: 0, controlSequence: 0,
      logicalCursor: { schemaVersion: '1', cursorRef: 'cursor://tenant/task/0', sequence: 0, stateDigest: digest },
      ownerRef: 'owner://tenant/task', targetRef: 'target://coordinator/v2', adapterRef: 'adapter://coordinator/v2', runtimeRef: 'runtime://contract/1',
      receiptRefs: [], artifactRefs: []
    };
    const envelope = { schemaVersion: '1' as const, specRef: 'spec://tenant/task', specDigest: digest, taskId: 'task', runId: 'run', attemptId: 'attempt', invocationId: 'invoke-1' };
    let state = createCoordinatorReducerState(observation);
    const reduce = (command: CoordinatorCommand) => {
      const reduced = reduceCoordinatorCommand(state, command);
      state = reduced.state;
      return reduced.result;
    };

    expect(reduce({ schemaVersion: '1', type: 'START', commandKey: 'start', expectedRevision: 0, envelope, ownerRef: observation.ownerRef, targetRef: observation.targetRef, adapterRef: observation.adapterRef, runtimeRef: observation.runtimeRef })).toMatchObject({ status: 'applied' });
    expect(reduce({ schemaVersion: '1', type: 'DISPATCH', commandKey: 'dispatch', expectedRevision: 1, invocationId: 'invoke-1' })).toMatchObject({ status: 'applied' });
    expect(state.observation).toMatchObject({ state: 'DISPATCHED', dispatchEpoch: 1, activeInvocationId: 'invoke-1' });
    expect(reduce({ schemaVersion: '1', type: 'WAIT', commandKey: 'wait', expectedRevision: 2 })).toMatchObject({ status: 'applied' });
    expect(reduce({ schemaVersion: '1', type: 'PAUSE', commandKey: 'pause', expectedRevision: 3, controlSequence: 1 })).toMatchObject({ status: 'applied' });
    expect(state.observation).toMatchObject({ state: 'PAUSED', requestedControl: 'PAUSE', effectiveControl: 'PAUSE', controlSequence: 1 });
    expect(reduce({ schemaVersion: '1', type: 'RESUME', commandKey: 'resume', expectedRevision: 4, controlSequence: 2 })).toMatchObject({ status: 'applied' });
    expect(state.observation).toMatchObject({ state: 'WAITING', requestedControl: 'RESUME', effectiveControl: 'RESUME', controlSequence: 2 });
    expect(reduce({ schemaVersion: '1', type: 'SIGNAL', commandKey: 'signal', expectedRevision: 5, signalRef: 'signal://tenant/one', signalDigest: digest })).toMatchObject({ status: 'applied' });
    expect(reduce({ schemaVersion: '1', type: 'CANCEL', commandKey: 'cancel', expectedRevision: 6, controlSequence: 3 })).toMatchObject({ status: 'applied' });
    expect(state.observation.state).toBe('CANCELLED');
    expect(reduce({ schemaVersion: '1', type: 'TIMEOUT', commandKey: 'late-timeout', expectedRevision: 7 })).toMatchObject({ status: 'conflict', code: 'INVALID_TRANSITION' });
  });

  it('keeps delivery retry identity, fences semantic retry, and blocks new attempts', () => {
    const digest = `sha256:${'b'.repeat(64)}`;
    const observation: CoordinatorObservation = {
      schemaVersion: '1', tenantId: 'tenant', taskId: 'task', runId: 'run', attemptId: 'attempt', specDigest: digest,
      path: 'DURABLE_COORDINATOR_V2', state: 'WAITING', revision: 4, dispatchEpoch: 7, controlSequence: 0,
      logicalCursor: { schemaVersion: '1', cursorRef: 'cursor://tenant/task/4', sequence: 4, stateDigest: digest },
      ownerRef: 'owner://tenant/task', targetRef: 'target://coordinator/v2', adapterRef: 'adapter://coordinator/v2', runtimeRef: 'runtime://contract/1',
      activeInvocationId: 'invoke-1', receiptRefs: [], artifactRefs: []
    };
    let state = createCoordinatorReducerState(observation);
    const delivery = reduceCoordinatorCommand(state, { schemaVersion: '1', type: 'RETRY', commandKey: 'delivery', expectedRevision: 4, controlSequence: 1, retryKind: 'DELIVERY', invocationId: 'invoke-1', receiptRefs: [] });
    state = delivery.state;
    expect(delivery.result).toMatchObject({ status: 'applied' });
    expect(state.observation).toMatchObject({ state: 'DISPATCHED', dispatchEpoch: 7, activeInvocationId: 'invoke-1' });

    const waitingReceipt: CoordinatorReceiptSummary = {
      schemaVersion: '1', receiptRef: 'receipt://tenant/waiting', receiptDigest: digest, outcome: 'CONTINUE', receiptRefs: [], artifactRefs: []
    };
    state = applyCoordinatorReceipt(state, 7, 'invoke-1', waitingReceipt).state;
    const semantic = reduceCoordinatorCommand(state, { schemaVersion: '1', type: 'RETRY', commandKey: 'semantic', expectedRevision: 6, controlSequence: 2, retryKind: 'SEMANTIC', invocationId: 'invoke-2', receiptRefs: ['receipt://tenant/waiting'] });
    state = semantic.state;
    expect(semantic.result).toMatchObject({ status: 'applied' });
    expect(state.observation).toMatchObject({ state: 'DISPATCHED', dispatchEpoch: 8, activeInvocationId: 'invoke-2' });
    const staleAfterSemantic = applyCoordinatorReceipt(state, 7, 'invoke-1', {
      schemaVersion: '1', receiptRef: 'receipt://tenant/stale-after-semantic', receiptDigest: `sha256:${'f'.repeat(64)}`, outcome: 'COMPLETED', receiptRefs: [], artifactRefs: []
    });
    expect(staleAfterSemantic.status).toBe('stale');
    expect(staleAfterSemantic.state.observation).toEqual(state.observation);

    const newAttempt = reduceCoordinatorCommand(state, { schemaVersion: '1', type: 'RETRY', commandKey: 'new-attempt', expectedRevision: 7, controlSequence: 3, retryKind: 'NEW_ATTEMPT', receiptRefs: [] });
    expect(newAttempt.result).toMatchObject({ status: 'conflict', code: 'NEW_ATTEMPT_REQUIRES_ADMISSION' });
  });

  it('keeps pause requested until the dispatch receipt and lets a later cancel win', () => {
    const digest = `sha256:${'e'.repeat(64)}`;
    const observation: CoordinatorObservation = {
      schemaVersion: '1', tenantId: 'tenant', taskId: 'task', runId: 'run', attemptId: 'attempt', specDigest: digest,
      path: 'DURABLE_COORDINATOR_V2', state: 'DISPATCHED', revision: 2, dispatchEpoch: 1, controlSequence: 0,
      logicalCursor: { schemaVersion: '1', cursorRef: 'cursor://tenant/task/2', sequence: 2, stateDigest: digest },
      ownerRef: 'owner://tenant/task', targetRef: 'target://coordinator/v2', adapterRef: 'adapter://coordinator/v2', runtimeRef: 'runtime://contract/1',
      activeInvocationId: 'invoke-1', receiptRefs: [], artifactRefs: []
    };
    let state = createCoordinatorReducerState(observation);
    const paused = reduceCoordinatorCommand(state, { schemaVersion: '1', type: 'PAUSE', commandKey: 'pause-race', expectedRevision: 2, controlSequence: 1 });
    state = paused.state;
    expect(paused.result).toMatchObject({ status: 'applied' });
    expect(state.observation).toMatchObject({ state: 'DISPATCHED', requestedControl: 'PAUSE', controlSequence: 1 });
    expect(state.observation.effectiveControl).toBeUndefined();
    const cancelled = reduceCoordinatorCommand(state, { schemaVersion: '1', type: 'CANCEL', commandKey: 'cancel-race', expectedRevision: 3, controlSequence: 2 });
    expect(cancelled.result).toMatchObject({ status: 'applied' });
    expect(cancelled.state.observation).toMatchObject({ state: 'CANCELLED', requestedControl: 'CANCEL', effectiveControl: 'CANCEL', controlSequence: 2 });
    expect(applyCoordinatorReceipt(cancelled.state, 1, 'invoke-1', { schemaVersion: '1', receiptRef: 'receipt://tenant/late-race', receiptDigest: digest, outcome: 'COMPLETED', receiptRefs: [], artifactRefs: [] }).status).toBe('stale');
  });

  it('rejects stale control sequence and stale/unknown receipts without rollback', () => {
    const digest = `sha256:${'c'.repeat(64)}`;
    const observation: CoordinatorObservation = {
      schemaVersion: '1', tenantId: 'tenant', taskId: 'task', runId: 'run', attemptId: 'attempt', specDigest: digest,
      path: 'DURABLE_COORDINATOR_V2', state: 'DISPATCHED', revision: 2, dispatchEpoch: 3, controlSequence: 1,
      logicalCursor: { schemaVersion: '1', cursorRef: 'cursor://tenant/task/2', sequence: 2, stateDigest: digest },
      ownerRef: 'owner://tenant/task', targetRef: 'target://coordinator/v2', adapterRef: 'adapter://coordinator/v2', runtimeRef: 'runtime://contract/1',
      activeInvocationId: 'invoke-1', receiptRefs: [], artifactRefs: []
    };
    let state = createCoordinatorReducerState(observation);
    const staleControl = reduceCoordinatorCommand(state, { schemaVersion: '1', type: 'PAUSE', commandKey: 'stale-pause', expectedRevision: 2, controlSequence: 1 });
    expect(staleControl.result).toMatchObject({ status: 'conflict', code: 'CONTROL_SEQUENCE_CONFLICT' });

    const unknownReceipt: CoordinatorReceiptSummary = {
      schemaVersion: '1', receiptRef: 'receipt://tenant/unknown', receiptDigest: digest, outcome: 'EFFECT_UNKNOWN', receiptRefs: [], artifactRefs: []
    };
    state = applyCoordinatorReceipt(state, 3, 'invoke-1', unknownReceipt).state;
    expect(state.observation).toMatchObject({ state: 'EFFECT_UNKNOWN', blockedCode: 'EFFECT_UNKNOWN' });
    const blockedRetry = reduceCoordinatorCommand(state, { schemaVersion: '1', type: 'RETRY', commandKey: 'blocked-retry', expectedRevision: 3, controlSequence: 2, retryKind: 'DELIVERY', invocationId: 'invoke-1', receiptRefs: [] });
    expect(blockedRetry.result).toMatchObject({ status: 'conflict', code: 'EFFECT_UNKNOWN_BLOCKED' });
    for (const [index, retryKind] of (['DELIVERY', 'SEMANTIC', 'NEW_ATTEMPT'] as const).entries()) {
      const retry = reduceCoordinatorCommand(state, {
        schemaVersion: '1', type: 'RETRY', commandKey: `blocked-${retryKind.toLowerCase()}`, expectedRevision: 3,
        controlSequence: 3 + index, retryKind, ...(retryKind === 'DELIVERY' ? { invocationId: 'invoke-1' } : {}), receiptRefs: []
      });
      expect(retry.result).toMatchObject({ status: 'conflict', code: 'EFFECT_UNKNOWN_BLOCKED' });
      expect(retry.state.observation).toEqual(state.observation);
    }
    const continueWhileBlocked = reduceCoordinatorCommand(state, {
      schemaVersion: '1', type: 'CONTINUE', commandKey: 'blocked-continue', expectedRevision: 3,
      stateDigest: digest, cursor: { schemaVersion: '1', cursorRef: 'cursor://tenant/task/4', sequence: 4, stateDigest: digest }
    });
    expect(continueWhileBlocked.result).toMatchObject({ status: 'conflict', code: 'INVALID_TRANSITION' });
    expect(continueWhileBlocked.state.observation).toEqual(state.observation);

    const stale = applyCoordinatorReceipt(state, 2, 'invoke-1', { ...unknownReceipt, receiptRef: 'receipt://tenant/late', receiptDigest: `sha256:${'d'.repeat(64)}` });
    expect(stale.status).toBe('stale');
    expect(stale.state.observation.state).toBe('EFFECT_UNKNOWN');
  });

  it('keeps completion and timeout terminal against late cancel and receipt delivery', () => {
    const digest = `sha256:${'g'.repeat(64)}`;
    const observation: CoordinatorObservation = {
      schemaVersion: '1', tenantId: 'tenant', taskId: 'task', runId: 'run', attemptId: 'attempt', specDigest: digest,
      path: 'DURABLE_COORDINATOR_V2', state: 'WAITING', revision: 4, dispatchEpoch: 2, controlSequence: 0,
      logicalCursor: { schemaVersion: '1', cursorRef: 'cursor://tenant/task/4', sequence: 4, stateDigest: digest },
      ownerRef: 'owner://tenant/task', targetRef: 'target://coordinator/v2', adapterRef: 'adapter://coordinator/v2', runtimeRef: 'runtime://contract/1',
      activeInvocationId: 'invoke-2', receiptRefs: [], artifactRefs: []
    };
    const completed = applyCoordinatorReceipt(createCoordinatorReducerState(observation), 2, 'invoke-2', {
      schemaVersion: '1', receiptRef: 'receipt://tenant/completed', receiptDigest: digest, outcome: 'COMPLETED', receiptRefs: [], artifactRefs: []
    });
    expect(completed.state.observation.state).toBe('COMPLETED');
    const lateCancel = reduceCoordinatorCommand(completed.state, {
      schemaVersion: '1', type: 'CANCEL', commandKey: 'late-cancel-completed', expectedRevision: completed.state.observation.revision, controlSequence: 1
    });
    expect(lateCancel.result).toMatchObject({ status: 'conflict', code: 'INVALID_TRANSITION' });
    expect(lateCancel.state.observation.state).toBe('COMPLETED');

    const timedOut = reduceCoordinatorCommand(createCoordinatorReducerState(observation), {
      schemaVersion: '1', type: 'TIMEOUT', commandKey: 'timeout', expectedRevision: observation.revision
    });
    expect(timedOut.state.observation.state).toBe('TIMED_OUT');
    const lateReceipt = applyCoordinatorReceipt(timedOut.state, 2, 'invoke-2', {
      schemaVersion: '1', receiptRef: 'receipt://tenant/late-timeout', receiptDigest: digest, outcome: 'COMPLETED', receiptRefs: [], artifactRefs: []
    });
    expect(lateReceipt.status).toBe('stale');
    expect(lateReceipt.state.observation.state).toBe('TIMED_OUT');
  });
});

describe('new Attempt/New Spec admission gate', () => {
  const digest = (value: string): `sha256:${string}` => `sha256:${value.repeat(64 / value.length)}` as `sha256:${string}`;
  const spec = (overrides: Partial<AgentTaskSpec> = {}): AgentTaskSpec => ({
    schemaVersion: '1', specRef: 'spec://tenant/task/attempt-1', specDigest: digest('a'), taskId: 'task', runId: 'run', attemptId: 'attempt-1',
    releaseRef: 'release://tenant/release-1', releaseDigest: digest('b'), principalRef: 'principal://tenant/user', tenantId: 'tenant', goalRef: 'artifact://tenant/input-1', engineId: 'reference',
    skillRefs: [], modelRouteRef: 'model://route-1', contextPlanRef: 'context://plan-1', capabilityGrantRef: 'grant://tenant/1', executionPolicyRef: 'policy://1', boundsRef: 'bounds://1', governanceRef: 'governance://1', admittedAt: '2026-08-15T00:00:00.000Z',
    ...overrides
  });
  const base = { previousTargetRef: 'target://v2/one', nextTargetRef: 'target://v2/one', previousRuntimeCompatibilityRef: 'runtime-compatibility://v1', nextRuntimeCompatibilityRef: 'runtime-compatibility://v1', engineCodec: 'reference@1', runtimeContractMajor: 1 } as const;

  it('requires a fresh immutable Spec and reports every changed authority', () => {
    const result = admitNewAttempt({
      ...base,
      previousSpec: spec(),
      nextSpec: spec({ specRef: 'spec://tenant/task/attempt-2', specDigest: digest('c'), attemptId: 'attempt-2', releaseDigest: digest('d'), engineId: 'other', modelRouteRef: 'model://route-2', capabilityGrantRef: 'grant://tenant/2', goalRef: 'artifact://tenant/input-2', executionPolicyRef: 'policy://2', boundsRef: 'bounds://2', governanceRef: 'governance://2' }),
      nextTargetRef: 'target://v2/two', nextRuntimeCompatibilityRef: 'runtime-compatibility://v2',
      previousContextRevision: 'context-rev-1', nextContextRevision: 'context-rev-2', previousContextRevisionPolicy: 'pinned', nextContextRevisionPolicy: 'allow-newer', previousInputDigest: digest('e'), nextInputDigest: digest('f')
    });
    expect(result).toEqual({ status: 'admitted', changedAuthorities: ['RELEASE', 'ENGINE', 'MODEL', 'GRANT', 'TARGET', 'RUNTIME_COMPATIBILITY', 'CONTEXT_REVISION', 'CONTEXT_REVISION_POLICY', 'INPUT_SEMANTICS', 'EXECUTION_POLICY', 'BOUNDS', 'GOVERNANCE'] });
  });

  it('rejects same Spec reuse, identity drift, and incompatible checkpoints', () => {
    expect(admitNewAttempt({ ...base, previousSpec: spec(), nextSpec: spec({ attemptId: 'attempt-2', specRef: 'spec://tenant/task/attempt-2' }) })).toEqual({ status: 'rejected', code: 'NEW_ATTEMPT_SPEC_NOT_NEW' });
    expect(admitNewAttempt({ ...base, previousSpec: spec(), nextSpec: spec({ attemptId: 'attempt-2', specRef: 'spec://tenant/other', specDigest: digest('c'), taskId: 'other' }) })).toEqual({ status: 'rejected', code: 'NEW_ATTEMPT_IDENTITY_CONFLICT' });
    expect(admitNewAttempt({ ...base, previousSpec: spec(), nextSpec: spec({ attemptId: 'attempt-2', specRef: 'spec://tenant/task/attempt-2', specDigest: digest('c') }), checkpoint: { checkpointRef: 'checkpoint://tenant/old', candidateDigest: digest('d'), specDigest: digest('a'), sequence: 1, engineCodec: 'reference@1', runtimeContractMajor: 1 } })).toEqual({ status: 'rejected', code: 'NEW_ATTEMPT_CHECKPOINT_INCOMPATIBLE' });
  });

  it('requires a new Attempt when target snapshot or Release requirements digest changes', () => {
    const result = admitNewAttempt({
      ...base,
      previousSpec: spec({ targetSnapshotRef: 'snapshot://target/one', targetSnapshotDigest: digest('a'), requirementsDigest: digest('b') }),
      nextSpec: spec({ attemptId: 'attempt-2', specRef: 'spec://tenant/task/attempt-2', specDigest: digest('c'), targetSnapshotRef: 'snapshot://target/two', targetSnapshotDigest: digest('d'), requirementsDigest: digest('e') })
    });
    expect(result).toEqual({ status: 'admitted', changedAuthorities: ['TARGET', 'RELEASE'] });
  });
});


describe('immutable Model/Provider Catalog resolution', () => {
  const digest = (letter: string) => `sha256:${letter.repeat(64)}` as `sha256:${string}`;
  const build = (overrides: Partial<TrustedModelCatalogBuild> = {}): TrustedModelCatalogBuild => ({
    selector: 'model://acme/summary', aliases: ['summary', 'model://acme/summary@stable'],
    modelRef: 'model://acme/summary', modelBuildRef: 'model-build://acme/summary/2026-08-15', modelBuildDigest: digest('a'),
    providerRef: 'provider://acme', providerBuildRef: 'provider-build://acme/2026-08-15', providerBuildDigest: digest('b'),
    parameterDigest: digest('c'), dataHandlingPolicyDigest: digest('d'), tenantIds: ['tenant-a'],
    environments: ['development'], residencies: ['cn'], capabilities: ['text'], trustStatus: 'trusted', revocationStatus: 'active',
    ...overrides
  });
  const request: TrustedModelResolutionRequest = {
    catalogRevision: 'catalog://2026-08-15/a', primarySelector: 'summary', fallbackSelectors: ['model://acme/fallback'],
    tenantId: 'tenant-a', environment: 'development', residency: 'cn', requiredCapabilities: ['text']
  };
  const snapshot: TrustedModelCatalogSnapshot = {
    catalogRevision: request.catalogRevision, projection: 'ready', builds: [build(), build({
      selector: 'model://acme/fallback', aliases: ['fallback'], modelRef: 'model://acme/fallback',
      modelBuildRef: 'model-build://acme/fallback/2026-08-15', modelBuildDigest: digest('e'),
      parameterDigest: digest('f')
    })]
  };

  it('pins primary/fallback model and provider builds plus governance digests to one revision', () => {
    const resolved = resolveTrustedModelFromSnapshot(snapshot, request);
    expect(resolved.catalogRevision).toBe(request.catalogRevision);
    expect(resolved.primary.modelBuildRef).toBe('model-build://acme/summary/2026-08-15');
    expect(resolved.fallbacks.map((item) => item.modelBuildRef)).toEqual(['model-build://acme/fallback/2026-08-15']);
    expect(resolved.primary.providerBuildDigest).toBe(digest('b'));
    expect(resolved.parameterDigests).toEqual([digest('c'), digest('f')]);
    expect(resolved.dataHandlingPolicyDigests).toEqual([digest('d'), digest('d')]);
    expect(resolved.audit).toMatchObject({ catalogRevision: request.catalogRevision, selectedModelBuildRefs: [
      'model-build://acme/summary/2026-08-15', 'model-build://acme/fallback/2026-08-15'
    ] });
    expect(JSON.stringify(resolved)).not.toMatch(/endpoint|secret|credential|response|principal|tenant-a/);
  });

  it('fixes an alias to the exact build in the selected revision and rejects floating selectors', () => {
    const first = resolveTrustedModelFromSnapshot(snapshot, request);
    const changed: TrustedModelCatalogSnapshot = { ...snapshot, catalogRevision: 'catalog://2026-08-16/b', builds: [build({
      modelBuildRef: 'model-build://acme/summary/2026-08-16', modelBuildDigest: digest('9')
    })] };
    expect(first.primary.modelBuildRef).toBe('model-build://acme/summary/2026-08-15');
    const next = resolveTrustedModelFromSnapshot(changed, { ...request, catalogRevision: changed.catalogRevision, fallbackSelectors: [] });
    expect(next.primary.modelBuildRef).toBe('model-build://acme/summary/2026-08-16');
    for (const selector of ['latest', 'model://acme/summary/latest', 'model/*', '^1.0.0']) {
      expect(() => resolveTrustedModelFromSnapshot(snapshot, { ...request, primarySelector: selector, fallbackSelectors: [] })).toThrowError(new TrustedModelResolutionError('MODEL_SELECTOR_INVALID'));
    }
  });

  it('fails closed for ambiguity, revocation, untrusted build, missing snapshot and projection failure', () => {
    expect(() => resolveTrustedModelFromSnapshot({ ...snapshot, builds: [build(), build({ modelBuildRef: 'model-build://acme/summary/other' })] }, request)).toThrowError(new TrustedModelResolutionError('MODEL_ALIAS_AMBIGUOUS'));
    expect(() => resolveTrustedModelFromSnapshot({ ...snapshot, builds: [build({ revocationStatus: 'revoked' })] }, { ...request, fallbackSelectors: [] })).toThrowError(new TrustedModelResolutionError('MODEL_REVOKED'));
    expect(() => resolveTrustedModelFromSnapshot({ ...snapshot, builds: [build({ trustStatus: 'untrusted' })] }, { ...request, fallbackSelectors: [] })).toThrowError(new TrustedModelResolutionError('MODEL_UNTRUSTED'));
    expect(() => resolveTrustedModelFromSnapshot({ ...snapshot, projection: 'unavailable' }, request)).toThrowError(new TrustedModelResolutionError('CATALOG_PROJECTION_UNAVAILABLE'));
    expect(() => resolveTrustedModelFromSnapshot(snapshot, { ...request, catalogRevision: 'catalog://wrong' })).toThrowError(new TrustedModelResolutionError('CATALOG_REVISION_MISMATCH'));
  });

  it('rejects governance mismatches without exposing principal or connection details', () => {
    expect(() => resolveTrustedModelFromSnapshot(snapshot, { ...request, tenantId: 'tenant-b' })).toThrowError(new TrustedModelResolutionError('MODEL_UNAVAILABLE'));
    expect(() => resolveTrustedModelFromSnapshot(snapshot, { ...request, residency: 'us' })).toThrowError(new TrustedModelResolutionError('MODEL_UNAVAILABLE'));
    expect(() => resolveTrustedModelFromSnapshot(snapshot, { ...request, requiredCapabilities: ['image'] })).toThrowError(new TrustedModelResolutionError('MODEL_UNAVAILABLE'));
  });

  it('does not mutate an already-issued resolution when the active snapshot changes', () => {
    const issued = resolveTrustedModelFromSnapshot(snapshot, request);
    const activeLater: TrustedModelCatalogSnapshot = { ...snapshot, builds: [build({
      modelBuildRef: 'model-build://acme/summary/new', modelBuildDigest: digest('8')
    }), snapshot.builds[1]!] };
    expect(resolveTrustedModelFromSnapshot(activeLater, request).primary.modelBuildRef).toBe('model-build://acme/summary/new');
    expect(issued.primary.modelBuildRef).toBe('model-build://acme/summary/2026-08-15');
    expect(issued.audit.catalogRevision).toBe(snapshot.catalogRevision);
  });
});
