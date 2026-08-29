import { createHash } from 'node:crypto';
/**
 * Pure lifecycle authority for the V2 Coordinator.
 *
 * The reducer does not call an adapter, mutate a store, or resolve a target. Its
 * input/output is deliberately limited to canonical observations and commands;
 * adapter implementations are responsible only for persisting the returned state.
 */
export interface CoordinatorCommandRecord {
  readonly commandKey: string;
  readonly commandDigest: string;
  readonly observation: CoordinatorObservation;
}

export interface CoordinatorReducerState {
  readonly observation: CoordinatorObservation;
  /** Bounded command payloads are not retained here; only canonical digests and resulting observations are. */
  readonly commandRecords: readonly CoordinatorCommandRecord[];
}

export interface CoordinatorReducerResult {
  readonly state: CoordinatorReducerState;
  readonly result: CoordinatorCommandResult;
}

export type CoordinatorReceiptApplyResult =
  | { readonly status: 'applied' | 'duplicate' | 'stale'; readonly state: CoordinatorReducerState };

const terminalCoordinatorStates: readonly CoordinatorLifecycleState[] = [
  'COMPLETED', 'FAILED', 'CANCELLED', 'TIMED_OUT', 'EFFECT_UNKNOWN'
];
const isTerminalCoordinatorState = (state: CoordinatorLifecycleState): boolean => terminalCoordinatorStates.includes(state);
const isControlCommand = (command: CoordinatorCommand): boolean =>
  command.type === 'PAUSE' || command.type === 'RESUME' || command.type === 'CANCEL' || command.type === 'RETRY';

const coordinatorError = (code: CoordinatorErrorCode): CoordinatorError => ({
  code,
  safeMessage: code,
  retryable: code === 'COORDINATOR_UNAVAILABLE' || code === 'TARGET_UNAVAILABLE'
});

const conflictResult = (observation: CoordinatorObservation, code: CoordinatorErrorCode): CoordinatorCommandResult => ({
  status: 'conflict',
  code,
  observation,
  error: coordinatorError(code)
});

const observationFor = (
  observation: CoordinatorObservation,
  patch: Partial<CoordinatorObservation>
): CoordinatorObservation => ({
  ...observation,
  ...patch,
  revision: observation.revision + 1
});

const appendCommandRecord = (
  state: CoordinatorReducerState,
  command: CoordinatorCommand,
  observation: CoordinatorObservation
): CoordinatorReducerState => ({
  observation,
  commandRecords: [...state.commandRecords, {
    commandKey: command.commandKey,
    commandDigest: sha256Digest(command),
    observation
  }]
});

export const createCoordinatorReducerState = (observation: CoordinatorObservation): CoordinatorReducerState => ({
  observation,
  commandRecords: []
});

/** Apply a command deterministically. A duplicate key returns the original observation. */
export function reduceCoordinatorCommand(
  state: CoordinatorReducerState,
  command: CoordinatorCommand
): CoordinatorReducerResult {
  const current = state.observation;
  const commandDigest = sha256Digest(command);
  const previous = state.commandRecords.find((record) => record.commandKey === command.commandKey);
  if (previous !== undefined) {
    if (previous.commandDigest !== commandDigest) {
      return { state, result: conflictResult(current, 'COMMAND_KEY_CONFLICT') };
    }
    return { state, result: { status: 'duplicate', observation: previous.observation } };
  }

  if (command.expectedRevision !== current.revision) {
    return { state, result: conflictResult(current, 'REVISION_CONFLICT') };
  }
  if (isControlCommand(command)) {
    const sequence = command.controlSequence ?? current.controlSequence + 1;
    if (sequence <= current.controlSequence) {
      return { state, result: conflictResult(current, 'CONTROL_SEQUENCE_CONFLICT') };
    }
  }

  let next: CoordinatorObservation;
  switch (command.type) {
    case 'START': {
      const envelope = command.envelope;
      const identityMatches = envelope.taskId === current.taskId && envelope.runId === current.runId &&
        envelope.attemptId === current.attemptId && envelope.specDigest === current.specDigest &&
        command.ownerRef === current.ownerRef && command.targetRef === current.targetRef &&
        command.adapterRef === current.adapterRef && command.runtimeRef === current.runtimeRef;
      if (current.state !== 'READY' || current.revision !== 0 || !identityMatches) {
        return { state, result: conflictResult(current, 'ENVELOPE_INVALID') };
      }
      next = observationFor(current, { activeInvocationId: envelope.invocationId });
      break;
    }
    case 'DISPATCH':
      if (current.state !== 'READY' && current.state !== 'WAITING') {
        return { state, result: conflictResult(current, 'INVALID_TRANSITION') };
      }
      next = observationFor(current, {
        state: 'DISPATCHED',
        dispatchEpoch: current.dispatchEpoch + 1,
        activeInvocationId: command.invocationId
      });
      break;
    case 'WAIT':
      if (current.state !== 'DISPATCHED' && current.state !== 'WAITING') {
        return { state, result: conflictResult(current, 'INVALID_TRANSITION') };
      }
      next = observationFor(current, { state: 'WAITING' });
      break;
    case 'SIGNAL':
      if (isTerminalCoordinatorState(current.state)) {
        return { state, result: conflictResult(current, 'INVALID_TRANSITION') };
      }
      next = observationFor(current, {});
      break;
    case 'PAUSE':
      if (current.state !== 'DISPATCHED' && current.state !== 'WAITING') {
        return { state, result: conflictResult(current, 'INVALID_TRANSITION') };
      }
      next = observationFor(current, {
        ...(current.state === 'WAITING' ? { state: 'PAUSED', effectiveControl: 'PAUSE' } : {}),
        requestedControl: 'PAUSE',
        controlSequence: command.controlSequence ?? current.controlSequence + 1
      });
      break;
    case 'RESUME':
      if (current.state !== 'PAUSED') {
        return { state, result: conflictResult(current, 'INVALID_TRANSITION') };
      }
      next = observationFor(current, {
        state: 'WAITING', requestedControl: 'RESUME', effectiveControl: 'RESUME',
        controlSequence: command.controlSequence ?? current.controlSequence + 1
      });
      break;
    case 'CANCEL':
      // A terminal observation wins over any late control command.
      if (isTerminalCoordinatorState(current.state)) {
        return { state, result: conflictResult(current, 'INVALID_TRANSITION') };
      }
      next = observationFor(current, {
        state: 'CANCELLED', requestedControl: 'CANCEL', effectiveControl: 'CANCEL',
        controlSequence: command.controlSequence ?? current.controlSequence + 1
      });
      break;
    case 'RETRY': {
      if (current.state === 'EFFECT_UNKNOWN') {
        return { state, result: conflictResult(current, 'EFFECT_UNKNOWN_BLOCKED') };
      }
      if (command.retryKind === 'NEW_ATTEMPT') {
        return { state, result: conflictResult(current, 'NEW_ATTEMPT_REQUIRES_ADMISSION') };
      }
      if (current.state !== 'WAITING' && current.state !== 'PAUSED') {
        return { state, result: conflictResult(current, 'INVALID_TRANSITION') };
      }
      if (command.retryKind === 'DELIVERY' && command.invocationId !== current.activeInvocationId) {
        return { state, result: conflictResult(current, 'INVALID_TRANSITION') };
      }
      if (command.retryKind === 'SEMANTIC' && command.invocationId === current.activeInvocationId) {
        return { state, result: conflictResult(current, 'INVALID_TRANSITION') };
      }
      const retryPatch: Partial<CoordinatorObservation> = {
        state: 'DISPATCHED',
        dispatchEpoch: command.retryKind === 'DELIVERY' ? current.dispatchEpoch : current.dispatchEpoch + 1,
        requestedControl: 'RETRY', effectiveControl: 'RETRY',
        controlSequence: command.controlSequence ?? current.controlSequence + 1
      };
      const retryInvocationId = command.invocationId ?? current.activeInvocationId;
      if (retryInvocationId !== undefined) retryPatch.activeInvocationId = retryInvocationId;
      next = observationFor(current, retryPatch);
      break;
    }
    case 'TIMEOUT':
      if (isTerminalCoordinatorState(current.state)) {
        return { state, result: conflictResult(current, 'INVALID_TRANSITION') };
      }
      next = observationFor(current, { state: 'TIMED_OUT' });
      break;
    case 'CONTINUE':
      if (isTerminalCoordinatorState(current.state) || command.cursor.sequence <= current.logicalCursor.sequence) {
        return { state, result: conflictResult(current, 'INVALID_TRANSITION') };
      }
      next = observationFor(current, { logicalCursor: command.cursor });
      break;
  }

  const nextState = appendCommandRecord(state, command, next);
  return { state: nextState, result: { status: 'applied', observation: next } };
}

/** Apply an immutable receipt while fencing late or cross-invocation deliveries. */
export function applyCoordinatorReceipt(
  state: CoordinatorReducerState,
  dispatchEpoch: number,
  invocationId: string,
  receipt: CoordinatorReceiptSummary
): CoordinatorReceiptApplyResult {
  const current = state.observation;
  if (dispatchEpoch !== current.dispatchEpoch || current.activeInvocationId !== invocationId) {
    return { status: 'stale', state };
  }
  if (current.lastReceipt?.receiptDigest === receipt.receiptDigest) {
    return { status: 'duplicate', state };
  }
  // A committed terminal result cannot be overwritten by a late receipt/control.
  if (isTerminalCoordinatorState(current.state)) {
    return { status: 'stale', state };
  }
  const stateByOutcome: Record<CoordinatorReceiptSummary['outcome'], CoordinatorLifecycleState> = {
    CONTINUE: 'WAITING', COMPLETED: 'COMPLETED', FAILED: 'FAILED', WAITING_FOR_USER: 'WAITING',
    WAITING_FOR_APPROVAL: 'WAITING', PAUSED: 'PAUSED', CANCELLED: 'CANCELLED', EFFECT_UNKNOWN: 'EFFECT_UNKNOWN'
  };
  const receiptPatch: Partial<CoordinatorObservation> = {
    state: stateByOutcome[receipt.outcome],
    receiptRefs: [...new Set([...current.receiptRefs, receipt.receiptRef, ...receipt.receiptRefs])],
    artifactRefs: [...new Set([...current.artifactRefs, ...receipt.artifactRefs])],
    lastReceipt: receipt
  };
  if (receipt.outcome === 'EFFECT_UNKNOWN') receiptPatch.blockedCode = 'EFFECT_UNKNOWN';
  if (receipt.outcome !== 'EFFECT_UNKNOWN' && !isTerminalCoordinatorState(current.state)
    && current.requestedControl === 'PAUSE' && receipt.outcome !== 'CANCELLED') {
    receiptPatch.state = 'PAUSED';
    receiptPatch.effectiveControl = 'PAUSE';
  }
  const next = observationFor(current, receiptPatch);
  return { status: 'applied', state: { ...state, observation: next } };
}

import { agentStateDigest, isAgentEventV2, isBoundedRunReceipt, isCheckpointCandidate, isAgentTaskSpec, sha256Digest, AgentExecutionEnvelopeSchema, BoundedRunOutcomeSchema, assertCanonicalPayloadBounds } from '@sage/agent-contracts';
import { Type, type Static } from 'typebox';
import { Value } from 'typebox/value';
export { agentStateDigest, isAgentEventV2, isBoundedRunReceipt, isCheckpointCandidate };
import type {
  AgentEventV2,
  AgentExecutionEnvelope,
  AgentTaskSpec,
  BoundedRunReceipt,
  CheckpointCandidate,
  SealedCheckpointRef
} from '@sage/agent-contracts';

export const EnvironmentSchema = Type.Union([
  Type.Literal('local'), Type.Literal('development'), Type.Literal('staging'), Type.Literal('production')
], { $id: 'Environment.v1' });
export type Environment = Static<typeof EnvironmentSchema>;

export interface AdapterHealth {
  readonly healthy: boolean;
  readonly checkedAt: string;
  readonly detail?: string;
}

export interface RegistryRecord<T = unknown> {
  readonly kind: string;
  readonly id: string;
  readonly version: string;
  readonly enabled: boolean;
  readonly value: T;
  readonly publishedAt: string;
}

export interface RegistryAdapter {
  get<T>(kind: string, id: string, version?: string): Promise<RegistryRecord<T> | undefined>;
  list<T>(kind: string): Promise<readonly RegistryRecord<T>[]>;
  health(): Promise<AdapterHealth>;
}

export interface SecretResolutionContext {
  readonly tenantId: string;
  readonly environment: Environment;
  readonly purpose: string;
}

export interface SecretValue {
  readonly value: Uint8Array;
  readonly expiresAt?: string;
}

export interface SecretManagerAdapter {
  resolve(secretRef: string, context: SecretResolutionContext): Promise<SecretValue>;
  health(): Promise<AdapterHealth>;
}

export interface IdentityClaims {
  readonly subject: string;
  readonly tenantId: string;
  readonly scopes: readonly string[];
  readonly expiresAt: string;
}

export interface OidcAdapter {
  verify(bearerToken: string, requiredScopes?: readonly string[]): Promise<IdentityClaims>;
  health(): Promise<AdapterHealth>;
}

export interface ArtifactMetadata {
  readonly artifactRef: string;
  readonly mediaType: string;
  readonly size: number;
  readonly sha256: string;
  readonly createdAt: string;
}

export interface PutArtifactRequest {
  readonly tenantId: string;
  readonly mediaType: string;
  readonly bytes: Uint8Array;
}

export interface ArtifactAdapter {
  put(request: PutArtifactRequest): Promise<ArtifactMetadata>;
  get(artifactRef: string, tenantId: string): Promise<Uint8Array>;
  delete(artifactRef: string, tenantId: string): Promise<void>;
  health(): Promise<AdapterHealth>;
}

/** Reference-only values persisted by Agent state. Resolved credential bytes never cross this boundary. */
const referenceSchema = (scheme: string, id: string) => Type.String({
  pattern: `^${scheme}://[^\\s]+$`, maxLength: 2_048, $id: id
});
export const ArtifactRefSchema = referenceSchema('artifact', 'ArtifactRef.v1');
export const ConnectionRefSchema = referenceSchema('connection', 'ConnectionRef.v1');
export const SecretRefSchema = referenceSchema('secret', 'SecretRef.v1');
export const CheckpointRefSchema = referenceSchema('checkpoint', 'CheckpointRef.v1');
export const SessionRefSchema = referenceSchema('session', 'SessionRef.v1');
export const RunRefSchema = referenceSchema('run', 'RunRef.v1');
export const ContextRefSchema = referenceSchema('context', 'ContextRef.v1');
export type ArtifactRef = `artifact://${string}`;
export type ConnectionRef = `connection://${string}`;
export type SecretRef = `secret://${string}`;
export type CheckpointRef = `checkpoint://${string}`;
export type SessionRef = `session://${string}`;
export type RunRef = `run://${string}`;
export type ContextRef = `context://${string}`;

const correlationId = () => Type.String({ minLength: 1, maxLength: 128, pattern: '^[A-Za-z0-9][A-Za-z0-9._:/-]*$' });
export const RuntimeCorrelationSchema = Type.Object({
  run_id: correlationId(),
  tenant_id: Type.Optional(correlationId()),
  session_id: Type.Optional(correlationId()),
  task_id: Type.Optional(correlationId()),
  workflow_id: Type.Optional(correlationId()),
  target_id: Type.Optional(correlationId()),
  attempt: Type.Optional(Type.Integer({ minimum: 1, maximum: 1_000_000 })),
  spec_id: Type.Optional(correlationId()),
  invocation_id: Type.Optional(correlationId()),
  engine_id: Type.Optional(correlationId()),
  model_id: Type.Optional(correlationId()),
  tool_call_id: Type.Optional(correlationId()),
  semantic_action_id: Type.Optional(correlationId()),
  artifact_id: Type.Optional(correlationId()),
  checkpoint_id: Type.Optional(correlationId()),
  release_id: Type.Optional(correlationId()),
  adapter_id: Type.Optional(correlationId()),
  provider_id: Type.Optional(correlationId())
}, { additionalProperties: false, $id: 'RuntimeCorrelation.v1' });
export type RuntimeCorrelation = Static<typeof RuntimeCorrelationSchema>;

export const ToolCorrelationSchema = Type.Object({
  run_id: correlationId(),
  tenant_id: Type.Optional(correlationId()),
  session_id: Type.Optional(correlationId()),
  task_id: Type.Optional(correlationId()),
  workflow_id: Type.Optional(correlationId()),
  target_id: Type.Optional(correlationId()),
  attempt: Type.Integer({ minimum: 1, maximum: 1_000_000 }),
  spec_id: Type.Optional(correlationId()),
  invocation_id: Type.Optional(correlationId()),
  engine_id: Type.Optional(correlationId()),
  model_id: Type.Optional(correlationId()),
  tool_call_id: correlationId(),
  semantic_action_id: Type.Optional(correlationId()),
  artifact_id: Type.Optional(correlationId()),
  checkpoint_id: Type.Optional(correlationId()),
  release_id: Type.Optional(correlationId()),
  adapter_id: Type.Optional(correlationId()),
  provider_id: Type.Optional(correlationId())
}, { additionalProperties: false, $id: 'ToolCorrelation.v1' });
export type ToolCorrelation = Static<typeof ToolCorrelationSchema>;

export const ReferenceEnvelopeSchema = Type.Object({
  artifact_ref: Type.Optional(ArtifactRefSchema),
  connection_ref: Type.Optional(ConnectionRefSchema),
  secret_ref: Type.Optional(SecretRefSchema),
  checkpoint_ref: Type.Optional(CheckpointRefSchema),
  session_ref: Type.Optional(SessionRefSchema),
  run_ref: Type.Optional(RunRefSchema),
  context_ref: Type.Optional(ContextRefSchema),
  data: Type.Optional(Type.Record(Type.String(), Type.Unknown()))
}, { additionalProperties: false, $id: 'ReferenceEnvelope.v1' });
export type ReferenceEnvelope = Static<typeof ReferenceEnvelopeSchema>;

const referenceSchemas = {
  artifact_ref: ArtifactRefSchema,
  connection_ref: ConnectionRefSchema,
  secret_ref: SecretRefSchema,
  checkpoint_ref: CheckpointRefSchema,
  session_ref: SessionRefSchema,
  run_ref: RunRefSchema,
  context_ref: ContextRefSchema
} as const;
type ReferenceKey = keyof typeof referenceSchemas;

const canonicalReferenceKey = (key: string): string =>
  key.replaceAll('-', '_').replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`).toLowerCase();
export const isReferenceKey = (key: string): boolean => canonicalReferenceKey(key) in referenceSchemas;
export const isValidReference = (key: string, value: unknown): boolean => {
  const schema = referenceSchemas[canonicalReferenceKey(key) as ReferenceKey];
  return schema !== undefined && Value.Check(schema, value);
};
export function assertValidReferences(value: unknown): void {
  const seen = new WeakSet<object>();
  const inspect = (current: unknown): void => {
    if (Array.isArray(current)) {
      for (const item of current) inspect(item);
      return;
    }
    if (current && typeof current === 'object') {
      if (seen.has(current)) return;
      seen.add(current);
      for (const [key, nested] of Object.entries(current)) {
        if (isReferenceKey(key) && !isValidReference(key, nested)) throw new Error('INVALID_REFERENCE_VALUE');
        inspect(nested);
      }
    }
  };
  inspect(value);
}

const sensitiveKey = /(?:password|passwd|passphrase|secret|token|authorization|cookie|api[-_]?key|credential|restricted(?:_|-)?result)/i;
const sensitivePattern = /(?:bearer\s+[^\s"']+|(?:sk|token|secret)[-_][a-z0-9_-]{8,}|-----BEGIN [A-Z ]*PRIVATE KEY-----)/i;

export const isSensitiveKey = (key: string): boolean => sensitiveKey.test(key) && !isReferenceKey(key);
export const isSensitiveString = (value: string, knownSecrets: readonly string[] = []): boolean =>
  sensitivePattern.test(value) || knownSecrets.some((secret) => secret.length > 0 && value.includes(secret));

/** Rejects malformed references, raw sensitive data, configured secrets, and byte buffers at any depth. */
export function assertNoSensitiveData(value: unknown, knownSecrets: readonly string[] = []): void {
  const seen = new WeakSet<object>();
  const inspect = (current: unknown, key = ''): void => {
    if (isReferenceKey(key)) {
      if (!isValidReference(key, current)) throw new Error('INVALID_REFERENCE_VALUE');
      return;
    }
    if (isSensitiveKey(key)) throw new Error('SENSITIVE_DATA_LEAK_DETECTED');
    if (typeof current === 'string' && isSensitiveString(current, knownSecrets)) throw new Error('SENSITIVE_DATA_LEAK_DETECTED');
    if (current instanceof Uint8Array) throw new Error('SENSITIVE_DATA_LEAK_DETECTED');
    if (Array.isArray(current)) {
      for (const item of current) inspect(item, key);
      return;
    }
    if (current && typeof current === 'object') {
      if (seen.has(current)) return;
      seen.add(current);
      for (const [nestedKey, nestedValue] of Object.entries(current)) inspect(nestedValue, nestedKey);
    }
  };
  inspect(value);
}

export function assertRuntimeCorrelation(value: unknown): asserts value is RuntimeCorrelation {
  if (!Value.Check(RuntimeCorrelationSchema, value)) throw new Error('INVALID_RUNTIME_CORRELATION');
  assertNoSensitiveData(value);
}

export function assertToolCorrelation(value: unknown): asserts value is ToolCorrelation {
  if (!Value.Check(ToolCorrelationSchema, value)) throw new Error('INVALID_TOOL_CORRELATION');
  assertNoSensitiveData(value);
}

export function assertReferenceEnvelope(value: unknown): asserts value is ReferenceEnvelope {
  if (!Value.Check(ReferenceEnvelopeSchema, value)) throw new Error('INVALID_REFERENCE_ENVELOPE');
  assertNoSensitiveData((value as ReferenceEnvelope).data);
}

export interface AgentContextRecord {
  readonly contextId: string;
  readonly tenantId: string;
  readonly revision: number;
  readonly state: ReferenceEnvelope;
  readonly updatedAt: string;
}

export interface AgentSessionRecord {
  readonly sessionId: string;
  readonly contextId: string;
  readonly tenantId: string;
  readonly status: 'open' | 'closed';
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface AgentRunRecord {
  readonly runId: string;
  readonly sessionId: string;
  readonly tenantId: string;
  readonly status: 'running' | 'paused' | 'succeeded' | 'failed';
  readonly correlation: RuntimeCorrelation;
  readonly startedAt: string;
  readonly completedAt?: string;
}

export interface AgentCheckpointRecord {
  readonly checkpointRef: CheckpointRef;
  readonly runId: string;
  readonly tenantId: string;
  readonly sequence: number;
  readonly state: ReferenceEnvelope;
  readonly createdAt: string;
}

export interface AgentStateEventRecord {
  readonly runId: string;
  readonly sequence: number;
  readonly type: string;
  readonly payload: ReferenceEnvelope;
  readonly occurredAt: string;
}

export interface ContextPort {
  putContext(record: AgentContextRecord): Promise<void>;
  getContext(contextId: string, tenantId: string): Promise<AgentContextRecord | undefined>;
}

export interface SessionPort {
  putSession(record: AgentSessionRecord): Promise<void>;
  getSession(sessionId: string, tenantId: string): Promise<AgentSessionRecord | undefined>;
}

export interface RunPort {
  putRun(record: AgentRunRecord): Promise<void>;
  getRun(runId: string, tenantId: string): Promise<AgentRunRecord | undefined>;
}

export interface CheckpointPort {
  putCheckpoint(record: AgentCheckpointRecord): Promise<void>;
  getCheckpoint(checkpointRef: CheckpointRef, tenantId: string): Promise<AgentCheckpointRecord | undefined>;
}

export interface EventPort {
  appendEvent(record: AgentStateEventRecord, tenantId: string): Promise<void>;
  listEvents(runId: string, tenantId: string): Promise<readonly AgentStateEventRecord[]>;
}

export interface AgentStateAdapter extends ContextPort, SessionPort, RunPort, CheckpointPort, EventPort {
  migrate(): Promise<void>;
  health(): Promise<AdapterHealth>;
  close(): Promise<void>;
}

export const CredentialResolutionRequestSchema = Type.Object({
  secretRef: SecretRefSchema,
  connectionRef: Type.Optional(ConnectionRefSchema),
  tenantId: Type.String({ minLength: 1, maxLength: 128 }),
  environment: EnvironmentSchema,
  purpose: Type.String({ minLength: 1, maxLength: 256 }),
  scope: Type.String({ minLength: 1, maxLength: 256 })
}, { additionalProperties: false, $id: 'CredentialResolutionRequest.v1' });

export function assertCredentialResolutionRequest(value: unknown): asserts value is CredentialResolutionRequest {
  if (!Value.Check(CredentialResolutionRequestSchema, value)) throw new Error('INVALID_CREDENTIAL_REQUEST');
  assertNoSensitiveData({
    tenantId: (value as CredentialResolutionRequest).tenantId,
    environment: (value as CredentialResolutionRequest).environment,
    purpose: (value as CredentialResolutionRequest).purpose,
    scope: (value as CredentialResolutionRequest).scope
  });
}
export type CredentialResolutionRequest = Static<typeof CredentialResolutionRequestSchema>;

export interface CredentialLease {
  /**
   * Ownership transfers to the resolving caller. The caller MUST zero this exact mutable buffer in
   * finally after the downstream operation completes; providers must treat retained aliases as invalid.
   */
  readonly value: Uint8Array;
  readonly expiresAt: string;
  readonly scope: string;
}

export interface CredentialProvider {
  resolveCredential(request: CredentialResolutionRequest): Promise<CredentialLease>;
  health(): Promise<AdapterHealth>;
}

export type IdempotencyClaim =
  | { readonly status: 'claimed' }
  | { readonly status: 'in_progress' }
  | { readonly status: 'completed'; readonly result: unknown };

/** Durable implementations must atomically claim keys and only allow the current owner to complete/release them. */
export interface IdempotencyStore {
  claim(key: string, ownerToken: string, leaseExpiresAt: string): Promise<IdempotencyClaim>;
  get(key: string): Promise<IdempotencyClaim>;
  complete(key: string, ownerToken: string, result: unknown): Promise<void>;
  release(key: string, ownerToken: string): Promise<void>;
  health(): Promise<AdapterHealth>;
}

export interface FailureInjectable {
  failNext(operation: string, error?: Error): void;
}

/** Reasons that a semantic authority change requires a fresh immutable Spec. */
export type NewAttemptSpecChange =
  | 'EXPLICIT_NEW_ATTEMPT'
  | 'RELEASE'
  | 'ENGINE'
  | 'MODEL'
  | 'GRANT'
  | 'TARGET'
  | 'RUNTIME_COMPATIBILITY'
  | 'CONTEXT_REVISION'
  | 'CONTEXT_REVISION_POLICY'
  | 'INPUT_SEMANTICS'
  | 'EXECUTION_POLICY'
  | 'BOUNDS'
  | 'GOVERNANCE';

export interface NewAttemptAdmissionInput {
  readonly previousSpec: unknown;
  readonly nextSpec: unknown;
  readonly previousTargetRef: string;
  readonly nextTargetRef: string;
  readonly previousRuntimeCompatibilityRef: string;
  readonly nextRuntimeCompatibilityRef: string;
  readonly previousContextRevision?: string;
  readonly nextContextRevision?: string;
  readonly previousContextRevisionPolicy?: string;
  readonly nextContextRevisionPolicy?: string;
  readonly previousInputDigest?: string;
  readonly nextInputDigest?: string;
  readonly checkpoint?: SealedCheckpointRef;
  readonly engineCodec: string;
  readonly runtimeContractMajor: number;
}

export type NewAttemptAdmissionResult =
  | { readonly status: 'admitted'; readonly changedAuthorities: readonly NewAttemptSpecChange[] }
  | {
      readonly status: 'rejected';
      readonly code:
        | 'NEW_ATTEMPT_INPUT_INVALID'
        | 'NEW_ATTEMPT_IDENTITY_CONFLICT'
        | 'NEW_ATTEMPT_SPEC_NOT_NEW'
        | 'NEW_ATTEMPT_CHECKPOINT_INCOMPATIBLE';
    };

/**
 * Admission-only transition check. It never mutates or rewrites the previous Spec;
 * callers must persist the returned next Spec through the create-only Spec Store.
 */
export function admitNewAttempt(input: NewAttemptAdmissionInput): NewAttemptAdmissionResult {
  if (!isAgentTaskSpec(input.previousSpec) || !isAgentTaskSpec(input.nextSpec)
    || input.previousTargetRef.trim() === '' || input.nextTargetRef.trim() === ''
    || input.previousRuntimeCompatibilityRef.trim() === '' || input.nextRuntimeCompatibilityRef.trim() === '') {
    return { status: 'rejected', code: 'NEW_ATTEMPT_INPUT_INVALID' };
  }
  const previous = input.previousSpec;
  const next = input.nextSpec;
  if (previous.tenantId !== next.tenantId || previous.taskId !== next.taskId || previous.runId !== next.runId) {
    return { status: 'rejected', code: 'NEW_ATTEMPT_IDENTITY_CONFLICT' };
  }
  if (previous.attemptId === next.attemptId) return { status: 'rejected', code: 'NEW_ATTEMPT_IDENTITY_CONFLICT' };
  if (previous.specRef === next.specRef || previous.specDigest === next.specDigest) {
    return { status: 'rejected', code: 'NEW_ATTEMPT_SPEC_NOT_NEW' };
  }
  if (input.checkpoint !== undefined && (
    input.checkpoint.specDigest !== next.specDigest
    || input.checkpoint.engineCodec !== input.engineCodec
    || input.checkpoint.runtimeContractMajor !== input.runtimeContractMajor
  )) return { status: 'rejected', code: 'NEW_ATTEMPT_CHECKPOINT_INCOMPATIBLE' };

  const changed: NewAttemptSpecChange[] = [];
  if (previous.targetSnapshotRef !== next.targetSnapshotRef || previous.targetSnapshotDigest !== next.targetSnapshotDigest) {
    if (!changed.includes('TARGET')) changed.push('TARGET');
  }
  if (previous.requirementsDigest !== next.requirementsDigest && !changed.includes('RELEASE')) changed.push('RELEASE');
  if ((previous.releaseRef !== next.releaseRef || previous.releaseDigest !== next.releaseDigest) && !changed.includes('RELEASE')) changed.push('RELEASE');
  if (previous.engineId !== next.engineId) changed.push('ENGINE');
  if (previous.modelRouteRef !== next.modelRouteRef) changed.push('MODEL');
  if (previous.capabilityGrantRef !== next.capabilityGrantRef) changed.push('GRANT');
  if (input.previousTargetRef !== input.nextTargetRef) changed.push('TARGET');
  if (input.previousRuntimeCompatibilityRef !== input.nextRuntimeCompatibilityRef) changed.push('RUNTIME_COMPATIBILITY');
  if (input.previousContextRevision !== input.nextContextRevision) changed.push('CONTEXT_REVISION');
  if (input.previousContextRevisionPolicy !== input.nextContextRevisionPolicy) changed.push('CONTEXT_REVISION_POLICY');
  if (input.previousInputDigest !== input.nextInputDigest || previous.goalRef !== next.goalRef) changed.push('INPUT_SEMANTICS');
  if (previous.executionPolicyRef !== next.executionPolicyRef) changed.push('EXECUTION_POLICY');
  if (previous.boundsRef !== next.boundsRef) changed.push('BOUNDS');
  if (previous.governanceRef !== next.governanceRef) changed.push('GOVERNANCE');
  return { status: 'admitted', changedAuthorities: changed.length === 0 ? ['EXPLICIT_NEW_ATTEMPT'] : changed };
}


/** Stable, framework-neutral results used by immutable authority stores. */
export type AuthorityWriteResult<T, ConflictCode extends string> =
  | { readonly status: 'stored'; readonly value: T }
  | { readonly status: 'existing'; readonly value: T }
  | { readonly status: 'conflict'; readonly code: ConflictCode };

export interface AgentTaskSpecStorePort {
  /** Create-only. A given ref and Attempt may never be rebound to another canonical Spec digest. */
  putSpec(input: { readonly tenantId: string; readonly spec: AgentTaskSpec }): Promise<AuthorityWriteResult<AgentTaskSpec, 'SPEC_REF_CONFLICT' | 'ATTEMPT_SPEC_CONFLICT'>>;
  getSpec(input: { readonly tenantId: string; readonly specRef: string; readonly expectedDigest: string }): Promise<AgentTaskSpec | undefined>;
  health(): Promise<AdapterHealth>;
}

export interface BoundedRunReceiptStorePort {
  /** Idempotent only when invocation ID and canonical receipt digest identify the same Receipt. */
  putReceipt(input: { readonly tenantId: string; readonly receipt: BoundedRunReceipt; readonly receiptDigest: string }): Promise<AuthorityWriteResult<BoundedRunReceipt, 'RECEIPT_CONFLICT'>>;
  getReceipt(input: { readonly tenantId: string; readonly invocationId: string }): Promise<BoundedRunReceipt | undefined>;
  health(): Promise<AdapterHealth>;
}

/** A lease issued by the Event Store; only its owner and monotonically increasing epoch may append. */
export interface AgentEventWriterFence {
  readonly tenantId: string;
  readonly taskId: string;
  readonly runId: string;
  readonly attemptId: string;
  readonly ownerToken: string;
  readonly epoch: number;
}

export type EventFenceResult =
  | { readonly status: 'acquired'; readonly fence: AgentEventWriterFence }
  | { readonly status: 'held'; readonly code: 'EVENT_WRITER_FENCED' };

export type EventAppendResult =
  | { readonly status: 'appended'; readonly event: AgentEventV2 }
  | { readonly status: 'existing'; readonly event: AgentEventV2 }
  | { readonly status: 'conflict'; readonly code: 'EVENT_FENCE_LOST' | 'EVENT_SEQUENCE_CONFLICT' | 'EVENT_ID_CONFLICT' };

export interface AgentEventStorePort {
  acquireWriterFence(input: Omit<AgentEventWriterFence, 'epoch'>): Promise<EventFenceResult>;
  appendEvent(input: { readonly fence: AgentEventWriterFence; readonly event: AgentEventV2 }): Promise<EventAppendResult>;
  listEvents(input: { readonly tenantId: string; readonly taskId: string; readonly runId: string; readonly attemptId: string; readonly fromSequence?: number }): Promise<readonly AgentEventV2[]>;
  health(): Promise<AdapterHealth>;
}

export type CheckpointCandidateResult =
  | { readonly status: 'staged'; readonly candidate: CheckpointCandidate }
  | { readonly status: 'existing'; readonly candidate: CheckpointCandidate }
  | { readonly status: 'conflict'; readonly code: 'CHECKPOINT_CANDIDATE_CONFLICT' | 'CHECKPOINT_FENCE_LOST' };

export type CheckpointSealResult =
  | { readonly status: 'sealed'; readonly checkpoint: SealedCheckpointRef }
  | { readonly status: 'existing'; readonly checkpoint: SealedCheckpointRef }
  | { readonly status: 'conflict'; readonly code: 'CHECKPOINT_SEAL_CONFLICT' | 'CHECKPOINT_FENCE_LOST' | 'CHECKPOINT_LINEAGE_INVALID' | 'CHECKPOINT_INCOMPATIBLE' };

/** Candidate staging is not resumable; only a successfully sealed value can be loaded. */
export interface CheckpointStorePort {
  stageCandidate(input: { readonly tenantId: string; readonly fence: AgentEventWriterFence; readonly candidate: CheckpointCandidate }): Promise<CheckpointCandidateResult>;
  sealCandidate(input: { readonly tenantId: string; readonly fence: AgentEventWriterFence; readonly candidateDigest: string }): Promise<CheckpointSealResult>;
  getSealedCheckpoint(input: { readonly tenantId: string; readonly checkpointRef: string; readonly taskId: string; readonly runId: string; readonly attemptId: string; readonly specDigest: string; readonly sequence?: number; readonly engineCodec: string; readonly runtimeContractMajor: number }): Promise<SealedCheckpointRef | undefined>;
  health(): Promise<AdapterHealth>;
}
export const CoordinatorOwnerRefSchema = referenceSchema('owner', 'CoordinatorOwnerRef.v1');
export const CoordinatorTargetRefSchema = referenceSchema('target', 'CoordinatorTargetRef.v1');
export const CoordinatorAdapterRefSchema = referenceSchema('adapter', 'CoordinatorAdapterRef.v1');
export const CoordinatorRuntimeRefSchema = referenceSchema('runtime', 'CoordinatorRuntimeRef.v1');
export const CoordinatorCursorRefSchema = referenceSchema('cursor', 'CoordinatorCursorRef.v1');
export const CoordinatorPathSchema = Type.Literal('DURABLE_COORDINATOR_V2', { $id: 'CoordinatorPath.v1' });
export type CoordinatorOwnerRef = Static<typeof CoordinatorOwnerRefSchema>;
export type CoordinatorTargetRef = Static<typeof CoordinatorTargetRefSchema>;
export type CoordinatorAdapterRef = Static<typeof CoordinatorAdapterRefSchema>;
export type CoordinatorRuntimeRef = Static<typeof CoordinatorRuntimeRefSchema>;
export type CoordinatorCursorRef = Static<typeof CoordinatorCursorRefSchema>;
export type CoordinatorPath = Static<typeof CoordinatorPathSchema>;

export const CoordinatorLifecycleStateSchema = Type.Union([
  Type.Literal('READY'), Type.Literal('DISPATCHED'), Type.Literal('WAITING'),
  Type.Literal('PAUSED'), Type.Literal('COMPLETED'), Type.Literal('FAILED'),
  Type.Literal('CANCELLED'), Type.Literal('TIMED_OUT'), Type.Literal('EFFECT_UNKNOWN')
], { $id: 'CoordinatorLifecycleState.v1' });
export type CoordinatorLifecycleState = Static<typeof CoordinatorLifecycleStateSchema>;

export const CoordinatorControlSchema = Type.Union([
  Type.Literal('PAUSE'), Type.Literal('RESUME'), Type.Literal('CANCEL'), Type.Literal('RETRY')
], { $id: 'CoordinatorControl.v1' });
export type CoordinatorControl = Static<typeof CoordinatorControlSchema>;

export const CoordinatorRetryKindSchema = Type.Union([
  Type.Literal('DELIVERY'), Type.Literal('SEMANTIC'), Type.Literal('NEW_ATTEMPT')
], { $id: 'CoordinatorRetryKind.v1' });
export type CoordinatorRetryKind = Static<typeof CoordinatorRetryKindSchema>;

export const CoordinatorLogicalCursorSchema = Type.Object({
  schemaVersion: Type.Literal('1'),
  cursorRef: CoordinatorCursorRefSchema,
  sequence: Type.Integer({ minimum: 0 }),
  stateDigest: Type.String({ pattern: '^sha256:[a-f0-9]{64}$' }),
  previousCursorRef: Type.Optional(CoordinatorCursorRefSchema),
  nextCursorRef: Type.Optional(CoordinatorCursorRefSchema)
}, { additionalProperties: false, $id: 'CoordinatorLogicalCursor.v1' });
export type CoordinatorLogicalCursor = Static<typeof CoordinatorLogicalCursorSchema>;

export const CoordinatorReceiptSummarySchema = Type.Object({
  schemaVersion: Type.Literal('1'),
  receiptRef: Type.String({ pattern: '^receipt://', maxLength: 2_048 }),
  receiptDigest: Type.String({ pattern: '^sha256:[a-f0-9]{64}$' }),
  outcome: BoundedRunOutcomeSchema,
  receiptRefs: Type.Array(Type.String({ minLength: 1, maxLength: 2_048 }), { maxItems: 128, uniqueItems: true }),
  artifactRefs: Type.Array(ArtifactRefSchema, { maxItems: 128, uniqueItems: true }),
  checkpointRef: Type.Optional(CheckpointRefSchema),
  errorCode: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
  errorCategory: Type.Optional(Type.String({ minLength: 1, maxLength: 64 }))
}, { additionalProperties: false, $id: 'CoordinatorReceiptSummary.v1' });
export type CoordinatorReceiptSummary = Static<typeof CoordinatorReceiptSummarySchema>;

export const CoordinatorObservationKeySchema = Type.Object({
  tenantId: Type.String({ minLength: 1, maxLength: 128 }),
  taskId: Type.String({ minLength: 1, maxLength: 128 }),
  runId: Type.String({ minLength: 1, maxLength: 128 }),
  attemptId: Type.String({ minLength: 1, maxLength: 128 }),
  specDigest: Type.String({ pattern: '^sha256:[a-f0-9]{64}$' })
}, { additionalProperties: false, $id: 'CoordinatorObservationKey.v1' });
export type CoordinatorObservationKey = Static<typeof CoordinatorObservationKeySchema>;

export const CoordinatorObservationSchema = Type.Object({
  schemaVersion: Type.Literal('1'),
  tenantId: Type.String({ minLength: 1, maxLength: 128 }),
  taskId: Type.String({ minLength: 1, maxLength: 128 }),
  runId: Type.String({ minLength: 1, maxLength: 128 }),
  attemptId: Type.String({ minLength: 1, maxLength: 128 }),
  specDigest: Type.String({ pattern: '^sha256:[a-f0-9]{64}$' }),
  path: CoordinatorPathSchema,
  state: CoordinatorLifecycleStateSchema,
  revision: Type.Integer({ minimum: 0 }),
  dispatchEpoch: Type.Integer({ minimum: 0 }),
  controlSequence: Type.Integer({ minimum: 0 }),
  logicalCursor: CoordinatorLogicalCursorSchema,
  ownerRef: CoordinatorOwnerRefSchema,
  targetRef: CoordinatorTargetRefSchema,
  adapterRef: CoordinatorAdapterRefSchema,
  runtimeRef: CoordinatorRuntimeRefSchema,
  activeInvocationId: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
  requestedControl: Type.Optional(CoordinatorControlSchema),
  effectiveControl: Type.Optional(CoordinatorControlSchema),
  receiptRefs: Type.Array(Type.String({ minLength: 1, maxLength: 2_048 }), { maxItems: 128, uniqueItems: true }),
  artifactRefs: Type.Array(ArtifactRefSchema, { maxItems: 128, uniqueItems: true }),
  lastReceipt: Type.Optional(CoordinatorReceiptSummarySchema),
  blockedCode: Type.Optional(Type.String({ minLength: 1, maxLength: 128 }))
}, { additionalProperties: false, $id: 'CoordinatorObservation.v1' });
export type CoordinatorObservation = Static<typeof CoordinatorObservationSchema>;

const coordinatorCommandBase = {
  schemaVersion: Type.Literal('1'),
  commandKey: Type.String({ minLength: 1, maxLength: 256 }),
  expectedRevision: Type.Integer({ minimum: 0 }),
  controlSequence: Type.Optional(Type.Integer({ minimum: 0 }))
} as const;

export const CoordinatorStartCommandSchema = Type.Object({
  ...coordinatorCommandBase,
  type: Type.Literal('START'),
  envelope: AgentExecutionEnvelopeSchema,
  ownerRef: CoordinatorOwnerRefSchema,
  targetRef: CoordinatorTargetRefSchema,
  adapterRef: CoordinatorAdapterRefSchema,
  runtimeRef: CoordinatorRuntimeRefSchema
}, { additionalProperties: false, $id: 'CoordinatorStartCommand.v1' });
export type CoordinatorStartCommand = Static<typeof CoordinatorStartCommandSchema>;

export const CoordinatorCommandSchema = Type.Union([
  CoordinatorStartCommandSchema,
  Type.Object({ ...coordinatorCommandBase, type: Type.Literal('DISPATCH'), invocationId: Type.String({ minLength: 1, maxLength: 128 }) }, { additionalProperties: false }),
  Type.Object({ ...coordinatorCommandBase, type: Type.Literal('WAIT'), wakeCursorRef: Type.Optional(CoordinatorCursorRefSchema) }, { additionalProperties: false }),
  Type.Object({ ...coordinatorCommandBase, type: Type.Literal('SIGNAL'), signalRef: Type.String({ minLength: 1, maxLength: 2_048 }), signalDigest: Type.String({ pattern: '^sha256:[a-f0-9]{64}$' }) }, { additionalProperties: false }),
  Type.Object({ ...coordinatorCommandBase, type: Type.Literal('PAUSE') }, { additionalProperties: false }),
  Type.Object({ ...coordinatorCommandBase, type: Type.Literal('RESUME') }, { additionalProperties: false }),
  Type.Object({ ...coordinatorCommandBase, type: Type.Literal('CANCEL') }, { additionalProperties: false }),
  Type.Object({ ...coordinatorCommandBase, type: Type.Literal('RETRY'), retryKind: CoordinatorRetryKindSchema, invocationId: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })), receiptRefs: Type.Array(Type.String({ minLength: 1, maxLength: 2_048 }), { maxItems: 128, uniqueItems: true }) }, { additionalProperties: false }),
  Type.Object({ ...coordinatorCommandBase, type: Type.Literal('TIMEOUT') }, { additionalProperties: false }),
  Type.Object({ ...coordinatorCommandBase, type: Type.Literal('CONTINUE'), stateDigest: Type.String({ pattern: '^sha256:[a-f0-9]{64}$' }), cursor: CoordinatorLogicalCursorSchema }, { additionalProperties: false })
], { $id: 'CoordinatorCommand.v1' });
export type CoordinatorCommand = Static<typeof CoordinatorCommandSchema>;

export const CoordinatorErrorCodeSchema = Type.Union([
  Type.Literal('COMMAND_KEY_CONFLICT'), Type.Literal('CONTROL_SEQUENCE_CONFLICT'), Type.Literal('NEW_ATTEMPT_REQUIRES_ADMISSION'), Type.Literal('REVISION_CONFLICT'), Type.Literal('INVALID_TRANSITION'),
  Type.Literal('OWNER_CONFLICT'), Type.Literal('TARGET_UNAVAILABLE'), Type.Literal('RUNTIME_INCOMPATIBLE'),
  Type.Literal('ENVELOPE_INVALID'), Type.Literal('PAYLOAD_BOUND_EXCEEDED'), Type.Literal('REFERENCE_BOUND_EXCEEDED'),
  Type.Literal('EFFECT_UNKNOWN_BLOCKED'), Type.Literal('STALE_DISPATCH_EPOCH'), Type.Literal('COORDINATOR_UNAVAILABLE'),
  Type.Literal('COORDINATOR_NOT_FOUND'), Type.Literal('COMMAND_NOT_AUTHORIZED')
], { $id: 'CoordinatorErrorCode.v1' });
export type CoordinatorErrorCode = Static<typeof CoordinatorErrorCodeSchema>;

export const CoordinatorErrorSchema = Type.Object({
  code: CoordinatorErrorCodeSchema,
  safeMessage: Type.String({ minLength: 1, maxLength: 1_024 }),
  retryable: Type.Boolean()
}, { additionalProperties: false, $id: 'CoordinatorError.v1' });
export type CoordinatorError = Static<typeof CoordinatorErrorSchema>;

export type CoordinatorCommandResult =
  | { readonly status: 'applied' | 'duplicate'; readonly observation: CoordinatorObservation }
  | { readonly status: 'conflict'; readonly code: CoordinatorErrorCode; readonly observation: CoordinatorObservation; readonly error?: CoordinatorError };

const coordinatorReferenceValues = (value: CoordinatorCommand | CoordinatorReceiptSummary | CoordinatorObservation): readonly string[] => {
  const refs: string[] = [];
  if ('receiptRefs' in value) refs.push(...value.receiptRefs);
  if ('artifactRefs' in value) refs.push(...value.artifactRefs);
  if ('checkpointRef' in value && value.checkpointRef !== undefined) refs.push(value.checkpointRef);
  return refs;
};

const assertCoordinatorPayloadBounds = (value: unknown, refs: readonly string[]): void => {
  try {
    assertCanonicalPayloadBounds(value, refs);
  } catch (error) {
    if (error instanceof RangeError && error.message === 'CANONICAL_RECEIPT_REF_LIMIT_EXCEEDED') throw new RangeError('REFERENCE_BOUND_EXCEEDED');
    if (error instanceof RangeError) throw new RangeError('PAYLOAD_BOUND_EXCEEDED');
    throw error;
  }
};

export function assertCoordinatorEnvelope(value: unknown): asserts value is AgentExecutionEnvelope {
  if (!Value.Check(AgentExecutionEnvelopeSchema, value)) throw new TypeError('ENVELOPE_INVALID');
  assertNoSensitiveData(value);
  assertCoordinatorPayloadBounds(value, []);
}

export function assertCoordinatorStartCommand(value: unknown): asserts value is CoordinatorStartCommand {
  if (!Value.Check(CoordinatorStartCommandSchema, value)) throw new TypeError('COMMAND_SCHEMA_INVALID');
  assertCoordinatorEnvelope((value as CoordinatorStartCommand).envelope);
  assertNoSensitiveData(value);
  assertCoordinatorPayloadBounds(value, []);
}

export function assertCoordinatorCommand(value: unknown): asserts value is CoordinatorCommand {
  if (!Value.Check(CoordinatorCommandSchema, value)) throw new TypeError('COMMAND_SCHEMA_INVALID');
  assertNoSensitiveData(value);
  assertCoordinatorPayloadBounds(value as CoordinatorCommand, coordinatorReferenceValues(value as CoordinatorCommand));
}

export function assertCoordinatorReceiptSummary(value: unknown): asserts value is CoordinatorReceiptSummary {
  if (!Value.Check(CoordinatorReceiptSummarySchema, value)) throw new TypeError('RECEIPT_SUMMARY_SCHEMA_INVALID');
  assertNoSensitiveData(value);
  assertCoordinatorPayloadBounds(value as CoordinatorReceiptSummary, coordinatorReferenceValues(value as CoordinatorReceiptSummary));
}

export function assertCoordinatorObservation(value: unknown): asserts value is CoordinatorObservation {
  if (!Value.Check(CoordinatorObservationSchema, value)) throw new TypeError('OBSERVATION_SCHEMA_INVALID');
  assertNoSensitiveData(value);
  assertCoordinatorPayloadBounds(value as CoordinatorObservation, coordinatorReferenceValues(value as CoordinatorObservation));
}

/** SDK-neutral lifecycle authority. Implementations persist the contract, not implementation objects. */
export interface DurableCoordinatorPort {
  start(command: CoordinatorStartCommand): Promise<CoordinatorCommandResult>;
  command(command: CoordinatorCommand): Promise<CoordinatorCommandResult>;
  observe(input: CoordinatorObservationKey): Promise<CoordinatorObservation | undefined>;
  health(): Promise<AdapterHealth>;
}

// ===== Schedule Plane (canonical, scheduler-facility neutral) =====
// Canonical schedule contracts express periodic AI App triggers. Concrete scheduler
// facility types (managed schedulers, cron daemons, …) are adapter details and must
// never leak into these schemas, the public API, or canonical boundary scans.

export const ScheduleTriggerRuleSchema = Type.Union([
  Type.Object({
    kind: Type.Literal('cron'),
    expression: Type.String({ minLength: 5, maxLength: 128 }),
    timezone: Type.String({ minLength: 1, maxLength: 64 })
  }, { additionalProperties: false }),
  Type.Object({
    kind: Type.Literal('interval'),
    everyMs: Type.Integer({ minimum: 60_000, maximum: 2_147_483_647 })
  }, { additionalProperties: false })
], { $id: 'ScheduleTriggerRule.v1' });
export type ScheduleTriggerRule = Static<typeof ScheduleTriggerRuleSchema>;

export const ScheduleOverlapPolicySchema = Type.Union([
  Type.Literal('SKIP'), Type.Literal('ALLOW'), Type.Literal('BUFFER_ONE')
], { $id: 'ScheduleOverlapPolicy.v1' });
export type ScheduleOverlapPolicy = Static<typeof ScheduleOverlapPolicySchema>;

export const ScheduleMisfirePolicySchema = Type.Union([
  Type.Literal('SKIP'), Type.Literal('CATCH_UP_ONE')
], { $id: 'ScheduleMisfirePolicy.v1' });
export type ScheduleMisfirePolicy = Static<typeof ScheduleMisfirePolicySchema>;

export const ScheduleReleaseBindingSchema = Type.Union([
  Type.Object({
    strategy: Type.Literal('FIXED'),
    releaseId: Type.String({ minLength: 1, maxLength: 128 }),
    contentDigest: Type.String({ pattern: '^sha256:[a-f0-9]{64}$' })
  }, { additionalProperties: false }),
  Type.Object({ strategy: Type.Literal('FOLLOW') }, { additionalProperties: false })
], { $id: 'ScheduleReleaseBinding.v1' });
export type ScheduleReleaseBinding = Static<typeof ScheduleReleaseBindingSchema>;

export const ScheduleBudgetDimensionSchema = Type.Union([
  Type.Literal('runs'), Type.Literal('tokens'), Type.Literal('tool_calls'), Type.Literal('cost_minor_units')
], { $id: 'ScheduleBudgetDimension.v1' });
export type ScheduleBudgetDimension = Static<typeof ScheduleBudgetDimensionSchema>;

export const ScheduleBudgetSchema = Type.Object({
  limits: Type.Array(Type.Object({
    dimension: ScheduleBudgetDimensionSchema,
    limit: Type.Integer({ minimum: 1 })
  }, { additionalProperties: false }), { minItems: 1, maxItems: 8 }),
  windowMs: Type.Optional(Type.Integer({ minimum: 60_000, maximum: 2_147_483_647 }))
}, { additionalProperties: false, $id: 'ScheduleBudget.v1' });
export type ScheduleBudget = Static<typeof ScheduleBudgetSchema>;

export const ScheduleTargetConstraintsSchema = Type.Object({
  allowedEnvironments: Type.Array(EnvironmentSchema, { minItems: 1, maxItems: 8 }),
  isolationLevel: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
  dataResidency: Type.Optional(Type.String({ minLength: 1, maxLength: 64 }))
}, { additionalProperties: false, $id: 'ScheduleTargetConstraints.v1' });
export type ScheduleTargetConstraints = Static<typeof ScheduleTargetConstraintsSchema>;

export const ScheduleInvocationTemplateSchema = Type.Object({
  task: Type.Optional(Type.String({ minLength: 1, maxLength: 64, pattern: '^[a-z][a-z0-9-]{0,63}$' })),
  params: Type.Optional(Type.Record(
    Type.String({ minLength: 1, maxLength: 64 }),
    Type.Union([Type.String({ maxLength: 2_048 }), Type.Number()]),
    { maxProperties: 16 }
  ))
}, { additionalProperties: false, $id: 'ScheduleInvocationTemplate.v1' });
export type ScheduleInvocationTemplate = Static<typeof ScheduleInvocationTemplateSchema>;

export const ScheduleStateSchema = Type.Union([
  Type.Literal('ACTIVE'), Type.Literal('PAUSED'), Type.Literal('DELETED')
], { $id: 'ScheduleState.v1' });
export type ScheduleState = Static<typeof ScheduleStateSchema>;

export const ScheduleDefinitionSchema = Type.Object({
  schemaVersion: Type.Literal('1'),
  scheduleId: Type.String({ minLength: 3, maxLength: 128, pattern: '^[a-z0-9][a-z0-9._-]*$' }),
  tenantId: Type.String({ minLength: 1, maxLength: 128 }),
  displayName: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
  trigger: ScheduleTriggerRuleSchema,
  overlapPolicy: ScheduleOverlapPolicySchema,
  misfirePolicy: ScheduleMisfirePolicySchema,
  releaseBinding: ScheduleReleaseBindingSchema,
  targetConstraints: ScheduleTargetConstraintsSchema,
  budget: ScheduleBudgetSchema,
  invocation: ScheduleInvocationTemplateSchema
}, { additionalProperties: false, $id: 'ScheduleDefinition.v1' });
export type ScheduleDefinition = Static<typeof ScheduleDefinitionSchema>;

export const ScheduleSnapshotSchema = Type.Object({
  schemaVersion: Type.Literal('1'),
  definition: ScheduleDefinitionSchema,
  revision: Type.Integer({ minimum: 1 }),
  state: ScheduleStateSchema,
  contentDigest: Type.String({ pattern: '^sha256:[a-f0-9]{64}$' }),
  createdAtMs: Type.Integer({ minimum: 0 }),
  updatedAtMs: Type.Integer({ minimum: 0 })
}, { additionalProperties: false, $id: 'ScheduleSnapshot.v1' });
export type ScheduleSnapshot = Static<typeof ScheduleSnapshotSchema>;

export const ScheduleOccurrenceSchema = Type.Object({
  schemaVersion: Type.Literal('1'),
  scheduleId: Type.String({ minLength: 3, maxLength: 128 }),
  tenantId: Type.String({ minLength: 1, maxLength: 128 }),
  occurrenceId: Type.String({ minLength: 1, maxLength: 128, pattern: '^[a-zA-Z0-9][a-zA-Z0-9._:-]*$' }),
  dueAtMs: Type.Integer({ minimum: 0 })
}, { additionalProperties: false, $id: 'ScheduleOccurrence.v1' });
export type ScheduleOccurrence = Static<typeof ScheduleOccurrenceSchema>;

export const scheduleOccurrenceKey = (occurrence: Pick<ScheduleOccurrence, 'scheduleId' | 'occurrenceId'>): string =>
  `schedule:${occurrence.scheduleId}:occ:${occurrence.occurrenceId}`;

export const ScheduleTriggerEventKindSchema = Type.Union([
  Type.Literal('SUCCEEDED'), Type.Literal('FAILED'), Type.Literal('SKIPPED'), Type.Literal('MISSED')
], { $id: 'ScheduleTriggerEventKind.v1' });
export type ScheduleTriggerEventKind = Static<typeof ScheduleTriggerEventKindSchema>;

export const ScheduleTriggerEventSchema = Type.Object({
  schemaVersion: Type.Literal('1'),
  scheduleId: Type.String({ minLength: 3, maxLength: 128 }),
  tenantId: Type.String({ minLength: 1, maxLength: 128 }),
  occurrenceId: Type.String({ minLength: 1, maxLength: 128 }),
  kind: ScheduleTriggerEventKindSchema,
  occurredAtMs: Type.Integer({ minimum: 0 }),
  taskId: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
  errorCode: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
  detail: Type.Optional(Type.String({ maxLength: 1_024 }))
}, { additionalProperties: false, $id: 'ScheduleTriggerEvent.v1' });
export type ScheduleTriggerEvent = Static<typeof ScheduleTriggerEventSchema>;

export const ScheduleErrorCodeSchema = Type.Union([
  Type.Literal('SCHEDULE_ALREADY_EXISTS'), Type.Literal('SCHEDULE_NOT_FOUND'),
  Type.Literal('SCHEDULE_RULE_INVALID'), Type.Literal('SCHEDULE_STATE_CONFLICT'),
  Type.Literal('SCHEDULE_REVISION_CONFLICT'), Type.Literal('SCHEDULE_UNAVAILABLE')
], { $id: 'ScheduleErrorCode.v1' });
export type ScheduleErrorCode = Static<typeof ScheduleErrorCodeSchema>;

export const ScheduleErrorSchema = Type.Object({
  code: ScheduleErrorCodeSchema,
  safeMessage: Type.String({ minLength: 1, maxLength: 1_024 }),
  retryable: Type.Boolean()
}, { additionalProperties: false, $id: 'ScheduleError.v1' });
export type ScheduleError = Static<typeof ScheduleErrorSchema>;

export interface ScheduleRef {
  readonly tenantId: string;
  readonly scheduleId: string;
}

/**
 * SDK-neutral schedule lifecycle authority for the control plane. Adapters map this
 * port onto a concrete scheduler facility; occurrence dispatch and missed-window
 * accounting remain canonical behavior expressed by the trigger event stream.
 */
export interface SchedulePort {
  create(definition: ScheduleDefinition): Promise<ScheduleSnapshot>;
  update(definition: ScheduleDefinition, expectedRevision: number): Promise<ScheduleSnapshot>;
  pause(ref: ScheduleRef): Promise<ScheduleSnapshot>;
  resume(ref: ScheduleRef): Promise<ScheduleSnapshot>;
  remove(ref: ScheduleRef): Promise<void>;
  describe(ref: ScheduleRef): Promise<ScheduleSnapshot | undefined>;
  health(): Promise<AdapterHealth>;
}

const scheduleReferenceValues = (value: ScheduleDefinition | ScheduleSnapshot | ScheduleTriggerEvent): readonly string[] => {
  if (value.schemaVersion !== '1') return [];
  if ('definition' in value) {
    const binding = value.definition.releaseBinding;
    return binding.strategy === 'FIXED' ? [`release://${binding.releaseId}`] : [];
  }
  if ('taskId' in value) return value.taskId !== undefined ? [`task://${value.taskId}`] : [];
  return [];
};

export function assertScheduleDefinition(value: unknown): asserts value is ScheduleDefinition {
  if (!Value.Check(ScheduleDefinitionSchema, value)) throw new TypeError('SCHEDULE_RULE_INVALID');
  assertNoSensitiveData(value);
  try {
    assertCanonicalPayloadBounds(value, scheduleReferenceValues(value as ScheduleDefinition));
  } catch (error) {
    if (error instanceof RangeError) throw new RangeError('SCHEDULE_RULE_INVALID');
    throw error;
  }
}

export function assertScheduleOccurrence(value: unknown): asserts value is ScheduleOccurrence {
  if (!Value.Check(ScheduleOccurrenceSchema, value)) throw new TypeError('SCHEDULE_RULE_INVALID');
  assertNoSensitiveData(value);
}

export function assertScheduleTriggerEvent(value: unknown): asserts value is ScheduleTriggerEvent {
  if (!Value.Check(ScheduleTriggerEventSchema, value)) throw new TypeError('SCHEDULE_TRIGGER_EVENT_INVALID');
  assertNoSensitiveData(value);
  try {
    assertCanonicalPayloadBounds(value, scheduleReferenceValues(value as ScheduleTriggerEvent));
  } catch (error) {
    if (error instanceof RangeError) throw new RangeError('PAYLOAD_BOUND_EXCEEDED');
    throw error;
  }
}

export const scheduleDefinitionDigest = (definition: ScheduleDefinition): string =>
  `sha256:${createHash('sha256').update(JSON.stringify(definition)).digest('hex')}`;

export * from './runtime.js';

export type TrustedPackageDependencyKind =
  | 'engine-compatibility'
  | 'skill'
  | 'context'
  | 'capability'
  | 'tool'
  | 'model'
  | 'policy'
  | 'schema'
  | 'budget';

export interface TrustedPackageDependencyRequest {
  readonly dependencyKind: TrustedPackageDependencyKind;
  readonly selector: string;
  readonly catalogRevision: string;
}

export type TrustedPackageDependencyResolutionErrorCode =
  | 'DEPENDENCY_UNRESOLVED'
  | 'DEPENDENCY_AMBIGUOUS'
  | 'DEPENDENCY_REVOKED'
  | 'DEPENDENCY_UNTRUSTED'
  | 'DEPENDENCY_SELECTOR_INVALID';

export interface TrustedPackageDependencyIdentity {
  readonly dependencyKind: TrustedPackageDependencyKind;
  readonly artifactRef: string;
  readonly version: string;
  readonly digest: string;
  readonly catalogRevision: string;
  readonly trustStatus?: 'trusted' | 'untrusted';
  readonly revocationStatus?: 'active' | 'revoked';
  readonly matchCount?: number;
}

/**
 * Framework-neutral resolution port. Implementations must resolve against a
 * trusted immutable catalog revision and return an exact artifact identity;
 * package compiler code never receives provider or runtime SDK objects.
 */
export interface TrustedArtifactCatalogPort {
  resolve(request: TrustedPackageDependencyRequest): Promise<TrustedPackageDependencyIdentity | undefined>;
  health(): Promise<AdapterHealth>;
}


/** Exact model/provider identities returned by an immutable, trusted Catalog revision. */
export interface TrustedModelBuildIdentity {
  readonly modelRef: string;
  readonly modelBuildRef: string;
  readonly modelBuildDigest: `sha256:${string}`;
  readonly providerRef: string;
  readonly providerBuildRef: string;
  readonly providerBuildDigest: `sha256:${string}`;
  readonly parameterDigest: `sha256:${string}`;
  readonly dataHandlingPolicyDigest: `sha256:${string}`;
}

/** Provider/Model metadata used only by the Catalog projection; no endpoint or SDK objects are allowed. */
export interface TrustedModelCatalogBuild extends TrustedModelBuildIdentity {
  readonly selector: string;
  readonly aliases?: readonly string[];
  readonly tenantIds?: readonly string[];
  readonly environments?: readonly ('development' | 'staging' | 'production')[];
  readonly residencies?: readonly string[];
  readonly capabilities?: readonly string[];
  readonly trustStatus: 'trusted' | 'untrusted';
  readonly revocationStatus: 'active' | 'revoked';
}

export interface TrustedModelCatalogSnapshot {
  readonly catalogRevision: string;
  readonly projection: 'ready' | 'unavailable';
  readonly builds: readonly TrustedModelCatalogBuild[];
}

export interface TrustedModelResolutionRequest {
  readonly catalogRevision: string;
  readonly primarySelector: string;
  readonly fallbackSelectors: readonly string[];
  readonly tenantId: string;
  readonly environment: 'development' | 'staging' | 'production';
  readonly residency: string;
  readonly requiredCapabilities?: readonly string[];
  readonly allowedProviderRefs?: readonly string[];
}

export interface TrustedModelResolutionAudit {
  readonly requirementsDigest: `sha256:${string}`;
  readonly catalogRevision: string;
  readonly selectedModelBuildRefs: readonly string[];
  readonly rejectedModelBuildRefs: readonly string[];
  readonly reason?: string;
}

export interface TrustedModelResolution {
  readonly catalogRevision: string;
  readonly primary: TrustedModelBuildIdentity;
  readonly fallbacks: readonly TrustedModelBuildIdentity[];
  readonly parameterDigests: readonly `sha256:${string}`[];
  readonly dataHandlingPolicyDigests: readonly `sha256:${string}`[];
  readonly audit: TrustedModelResolutionAudit;
}

export type TrustedModelResolutionErrorCode =
  | 'MODEL_UNAVAILABLE'
  | 'CATALOG_PROJECTION_UNAVAILABLE'
  | 'CATALOG_REVISION_MISMATCH'
  | 'MODEL_SELECTOR_INVALID'
  | 'MODEL_ALIAS_AMBIGUOUS'
  | 'MODEL_REVOKED'
  | 'MODEL_UNTRUSTED';

export class TrustedModelResolutionError extends Error {
  constructor(readonly code: TrustedModelResolutionErrorCode, reason = code) {
    super(reason);
  }
}

/** Framework-neutral port consumed by Admission; implementations must never return physical endpoints. */
export interface TrustedModelCatalogPort {
  resolveModel(request: TrustedModelResolutionRequest): Promise<TrustedModelResolution>;
  health(): Promise<AdapterHealth>;
}

const stableCatalogJson = (value: unknown): string => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableCatalogJson).join(',')}]`;
  return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right))
    .map(([key, child]) => `${JSON.stringify(key)}:${stableCatalogJson(child)}`).join(',')}}`;
};

const catalogDigest = (value: unknown): `sha256:${string}` =>
  `sha256:${createHash('sha256').update(stableCatalogJson(value)).digest('hex')}` as `sha256:${string}`;

const invalidFloatingSelector = (selector: string): boolean => selector.trim() === ''
  || /^(?:latest|current|default|stable)$/i.test(selector.trim())
  || /^(?:\^|~)/.test(selector.trim())
  || /(?:^|[/:])(?:latest|current|default|stable|\*|\^|~)(?:$|[/:])/i.test(selector)
  || /[<>*=]/.test(selector);

const buildMatches = (build: TrustedModelCatalogBuild, selector: string): boolean =>
  build.selector === selector || build.modelRef === selector || build.aliases?.includes(selector) === true;

const eligibleBuild = (build: TrustedModelCatalogBuild, request: TrustedModelResolutionRequest): boolean =>
  (build.tenantIds === undefined || build.tenantIds.includes(request.tenantId))
  && (build.environments === undefined || build.environments.includes(request.environment))
  && (build.residencies === undefined || build.residencies.includes(request.residency))
  && (request.allowedProviderRefs === undefined || request.allowedProviderRefs.includes(build.providerRef))
  && (request.requiredCapabilities === undefined || request.requiredCapabilities.every((capability) => build.capabilities?.includes(capability) === true));

const resolveSelector = (
  snapshot: TrustedModelCatalogSnapshot,
  request: TrustedModelResolutionRequest,
  selector: string,
  rejected: string[]
): TrustedModelBuildIdentity => {
  if (invalidFloatingSelector(selector)) throw new TrustedModelResolutionError('MODEL_SELECTOR_INVALID');
  const matches = snapshot.builds.filter((build) => buildMatches(build, selector));
  if (matches.length === 0) throw new TrustedModelResolutionError('MODEL_UNAVAILABLE');
  if (matches.some((build) => build.revocationStatus === 'revoked')) {
    matches.filter((build) => build.revocationStatus === 'revoked').forEach((build) => rejected.push(build.modelBuildRef));
    throw new TrustedModelResolutionError('MODEL_REVOKED');
  }
  if (matches.some((build) => build.trustStatus === 'untrusted')) {
    matches.filter((build) => build.trustStatus === 'untrusted').forEach((build) => rejected.push(build.modelBuildRef));
    throw new TrustedModelResolutionError('MODEL_UNTRUSTED');
  }
  const eligible = matches.filter((build) => eligibleBuild(build, request));
  if (eligible.length > 1) throw new TrustedModelResolutionError('MODEL_ALIAS_AMBIGUOUS');
  if (eligible.length === 0) throw new TrustedModelResolutionError('MODEL_UNAVAILABLE');
  const selected = eligible[0];
  if (selected === undefined) throw new TrustedModelResolutionError('MODEL_UNAVAILABLE');
  return {
    modelRef: selected.modelRef,
    modelBuildRef: selected.modelBuildRef,
    modelBuildDigest: selected.modelBuildDigest,
    providerRef: selected.providerRef,
    providerBuildRef: selected.providerBuildRef,
    providerBuildDigest: selected.providerBuildDigest,
    parameterDigest: selected.parameterDigest,
    dataHandlingPolicyDigest: selected.dataHandlingPolicyDigest
  };
};

/** Resolve logical selectors once against one immutable projection; never re-resolves an active alias later. */
export function resolveTrustedModelFromSnapshot(
  snapshot: TrustedModelCatalogSnapshot,
  request: TrustedModelResolutionRequest
): TrustedModelResolution {
  if (snapshot.projection !== 'ready') throw new TrustedModelResolutionError('CATALOG_PROJECTION_UNAVAILABLE');
  if (snapshot.catalogRevision !== request.catalogRevision) throw new TrustedModelResolutionError('CATALOG_REVISION_MISMATCH');
  if (request.fallbackSelectors.length > 32) throw new TrustedModelResolutionError('MODEL_SELECTOR_INVALID');
  const rejected: string[] = [];
  const primary = resolveSelector(snapshot, request, request.primarySelector, rejected);
  const fallbacks = request.fallbackSelectors.map((selector) => resolveSelector(snapshot, request, selector, rejected));
  const requirementsDigest = catalogDigest({
    catalogRevision: request.catalogRevision, primarySelector: request.primarySelector,
    fallbackSelectors: request.fallbackSelectors, environment: request.environment, residency: request.residency,
    requiredCapabilities: request.requiredCapabilities ?? [], allowedProviderRefs: request.allowedProviderRefs ?? []
  });
  const identities = [primary, ...fallbacks];
  return Object.freeze({
    catalogRevision: snapshot.catalogRevision,
    primary,
    fallbacks: Object.freeze(fallbacks),
    parameterDigests: Object.freeze(identities.map((identity) => identity.parameterDigest)),
    dataHandlingPolicyDigests: Object.freeze(identities.map((identity) => identity.dataHandlingPolicyDigest)),
    audit: Object.freeze({
      requirementsDigest, catalogRevision: snapshot.catalogRevision,
      selectedModelBuildRefs: Object.freeze(identities.map((identity) => identity.modelBuildRef)),
      rejectedModelBuildRefs: Object.freeze(rejected)
    })
  });
}

export * from './production-governance.js';
