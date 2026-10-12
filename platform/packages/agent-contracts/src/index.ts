import { createHash } from 'node:crypto';
import { Type, type Static } from 'typebox';
import { Value } from 'typebox/value';

export type StableId = string & { readonly __stableId: unique symbol };
export type ContentDigest = `sha256:${string}`;
export type ContentRef = string & { readonly __contentRef: unique symbol };

const canonicalize = (value: unknown, excludedKeys: ReadonlySet<string>): unknown => {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('canonical JSON rejects non-finite numbers');
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) return value.map((item) => canonicalize(item, excludedKeys));
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(Object.keys(record).filter((key) => !excludedKeys.has(key)).sort().map((key) => [key, canonicalize(record[key], excludedKeys)]));
  }
  throw new TypeError('canonical JSON accepts only JSON values');
};

/** RFC 8785-compatible canonical JSON for JSON data (lexicographic object keys, no whitespace). */
export const canonicalJson = (value: unknown, options: { readonly excludeKeys?: readonly string[] } = {}): string =>
  JSON.stringify(canonicalize(value, new Set(options.excludeKeys)));

export const sha256Digest = (value: unknown, options: { readonly excludeKeys?: readonly string[] } = {}): ContentDigest =>
  `sha256:${createHash('sha256').update(canonicalJson(value, options)).digest('hex')}`;

export const stableId = (value: string): StableId => {
  if (!value.trim()) throw new TypeError('stable ID must not be blank');
  return value as StableId;
};

export const contentRef = (value: string): ContentRef => {
  if (!value.trim()) throw new TypeError('content ref must not be blank');
  return value as ContentRef;
};

/** Versioned v1 boundary shared by Envelope/command/receipt-summary consumers. */
export const CANONICAL_RUNTIME_CONTRACT_V1 = Object.freeze({
  schemaMajor: 1,
  maxSerializedPayloadBytes: 64 * 1024,
  maxReceiptRefs: 128
} as const);

export const serializedPayloadBytes = (value: unknown): number =>
  new TextEncoder().encode(canonicalJson(value)).byteLength;

export const assertCanonicalPayloadBounds = (value: unknown, refs: readonly string[] = []): void => {
  if (serializedPayloadBytes(value) > CANONICAL_RUNTIME_CONTRACT_V1.maxSerializedPayloadBytes) {
    throw new RangeError('CANONICAL_PAYLOAD_TOO_LARGE');
  }
  if (refs.length > CANONICAL_RUNTIME_CONTRACT_V1.maxReceiptRefs) {
    throw new RangeError('CANONICAL_RECEIPT_REF_LIMIT_EXCEEDED');
  }
};

export const AgentPackageReleaseSchema = Type.Object({ schemaVersion: Type.Literal('1'), releaseRef: Type.String({ pattern: '^release://' }), releaseId: Type.String({ pattern: '^sha256:[a-f0-9]{64}$' }), packageRef: Type.String({ pattern: '^package://' }), packageId: Type.String({ minLength: 1 }), packageVersion: Type.String({ minLength: 1 }), packageDigest: Type.String({ pattern: '^sha256:[a-f0-9]{64}$' }), contentDigest: Type.String({ pattern: '^sha256:[a-f0-9]{64}$' }), lockDigest: Type.String({ pattern: '^sha256:[a-f0-9]{64}$' }), ownerRef: Type.String({ minLength: 1 }), compatibility: Type.Object({ kernelContractMajor: Type.Integer({ minimum: 1 }), engineIds: Type.Array(Type.String({ minLength: 1 }), { minItems: 1, uniqueItems: true }), engineCompatibilityDigests: Type.Array(Type.String({ pattern: '^sha256:[a-f0-9]{64}$' }), { minItems: 1, uniqueItems: true }) }, { additionalProperties: false }), provenance: Type.Object({ compilerRef: Type.String({ minLength: 1 }), compilerDigest: Type.String({ pattern: '^sha256:[a-f0-9]{64}$' }), compilerBuild: Type.String({ minLength: 1 }), sourceDigest: Type.String({ pattern: '^sha256:[a-f0-9]{64}$' }), lockDigest: Type.String({ pattern: '^sha256:[a-f0-9]{64}$' }), sbomDigest: Type.String({ pattern: '^sha256:[a-f0-9]{64}$' }), provenanceDigest: Type.String({ pattern: '^sha256:[a-f0-9]{64}$' }), policyDigest: Type.String({ pattern: '^sha256:[a-f0-9]{64}$' }), signatureDigest: Type.String({ pattern: '^sha256:[a-f0-9]{64}$' }) }, { additionalProperties: false }), signatureRefs: Type.Array(Type.String({ minLength: 1 }), { minItems: 1, uniqueItems: true }), attestationRefs: Type.Array(Type.String({ minLength: 1 }), { minItems: 3, uniqueItems: true }), dependencyDigests: Type.Array(Type.String({ pattern: '^sha256:[a-f0-9]{64}$' }), { minItems: 1, uniqueItems: true }) }, { $id: 'AgentPackageRelease.v1', additionalProperties: false });
export type AgentPackageRelease = Static<typeof AgentPackageReleaseSchema>;
export const isAgentPackageRelease = (value: unknown): value is AgentPackageRelease => Value.Check(AgentPackageReleaseSchema, value);

export const AgentTaskSpecSchema = Type.Object({
  schemaVersion: Type.Literal('1'), specRef: Type.String({ pattern: '^spec://' }), specDigest: Type.String({ pattern: '^sha256:[a-f0-9]{64}$' }), taskId: Type.String({ minLength: 1 }), runId: Type.String({ minLength: 1 }), attemptId: Type.String({ minLength: 1 }), releaseRef: Type.String({ pattern: '^release://' }), releaseDigest: Type.String({ pattern: '^sha256:[a-f0-9]{64}$' }), targetSnapshotRef: Type.Optional(Type.String({ minLength: 1, maxLength: 2_048 })), targetSnapshotDigest: Type.Optional(Type.String({ pattern: '^sha256:[a-f0-9]{64}$' })), requirementsDigest: Type.Optional(Type.String({ pattern: '^sha256:[a-f0-9]{64}$' })), principalRef: Type.String({ minLength: 1 }), tenantId: Type.String({ minLength: 1 }), goalRef: Type.String({ minLength: 1 }), engineId: Type.String({ minLength: 1 }), skillRefs: Type.Array(Type.String({ minLength: 1 }), { uniqueItems: true }), modelRouteRef: Type.String({ minLength: 1 }), contextPlanRef: Type.String({ minLength: 1 }), capabilityGrantRef: Type.String({ minLength: 1 }), executionPolicyRef: Type.String({ minLength: 1 }), boundsRef: Type.String({ minLength: 1 }), governanceRef: Type.String({ minLength: 1 }), admittedAt: Type.String({ format: 'date-time' })
}, { $id: 'AgentTaskSpec.v1', additionalProperties: false });
export type AgentTaskSpec = Static<typeof AgentTaskSpecSchema>;
export const isAgentTaskSpec = (value: unknown): value is AgentTaskSpec => Value.Check(AgentTaskSpecSchema, value);

export const AgentErrorCodeSchema = Type.Union([
  Type.Literal('INVALID_RUN_SPEC'),
  Type.Literal('HARNESS_CAPABILITY_MISSING'),
  Type.Literal('HARNESS_FAILURE'),
  Type.Literal('CANCELLED'),
  Type.Literal('DEADLINE_EXCEEDED'),
  Type.Literal('TURN_BUDGET_EXHAUSTED'),
  Type.Literal('TOOL_BUDGET_EXHAUSTED'),
  Type.Literal('TOKEN_BUDGET_EXHAUSTED')
], { $id: 'AgentErrorCode.v1' });
export type AgentErrorCode = Static<typeof AgentErrorCodeSchema>;

export const AgentErrorSchema = Type.Object({
  code: AgentErrorCodeSchema,
  message: Type.String({ minLength: 1 }),
  retryable: Type.Boolean(),
  details: Type.Optional(Type.Record(Type.String(), Type.Unknown()))
}, { $id: 'AgentError.v1', additionalProperties: false });
export type AgentError = Static<typeof AgentErrorSchema>;

export const HarnessCapabilitySchema = Type.Union([
  Type.Literal('events'),
  Type.Literal('cancellation'),
  Type.Literal('checkpoint'),
  Type.Literal('skills'),
  Type.Literal('tools')
], { $id: 'HarnessCapability.v1' });
export type HarnessCapability = Static<typeof HarnessCapabilitySchema>;

export const AgentRunSpecSchema = Type.Object({
  schemaVersion: Type.Literal('1'),
  runId: Type.String({ minLength: 1, maxLength: 128 }),
  sessionRef: Type.Optional(Type.String({ pattern: '^session://' })),
  // 输入上限对齐平台输入快照上限（512 KiB）：声明数据源的组装输入可合法达到该量级。
  input: Type.String({ minLength: 1, maxLength: 512 * 1024 }),
  skillRefs: Type.Array(Type.String({ minLength: 1 }), { maxItems: 32 }),
  requiredCapabilities: Type.Array(HarnessCapabilitySchema, { uniqueItems: true }),
  limits: Type.Object({
    maxTurns: Type.Integer({ minimum: 1, maximum: 100 }),
    maxToolCalls: Type.Integer({ minimum: 0, maximum: 1_000 }),
    maxTokens: Type.Integer({ minimum: 1, maximum: 10_000_000 }),
    deadlineAt: Type.String({ format: 'date-time' })
  }, { additionalProperties: false }),
  resumeFrom: Type.Optional(Type.String({ pattern: '^checkpoint://' }))
}, { $id: 'AgentRunSpec.v1', additionalProperties: false });
export type AgentRunSpec = Static<typeof AgentRunSpecSchema>;

export const AgentEventTypeSchema = Type.Union([
  Type.Literal('run.started'),
  Type.Literal('turn.started'),
  Type.Literal('output.delta'),
  Type.Literal('turn.completed'),
  Type.Literal('tool.completed'),
  Type.Literal('checkpoint.created'),
  Type.Literal('run.cancel.requested'),
  Type.Literal('run.paused'),
  Type.Literal('run.completed'),
  Type.Literal('run.failed')
]);
export type AgentEventType = Static<typeof AgentEventTypeSchema>;

export const AgentToolArtifactSchema = Type.Object({
  artifactRef: Type.String({ pattern: '^artifact://', maxLength: 2048 }),
  name: Type.String({ minLength: 1, maxLength: 512 }),
  mediaType: Type.String({ minLength: 1, maxLength: 255 }),
  sizeBytes: Type.Integer({ minimum: 0, maximum: 10 * 1024 * 1024 })
}, { $id: 'AgentToolArtifact.v1', additionalProperties: false });
export type AgentToolArtifact = Static<typeof AgentToolArtifactSchema>;
export const isAgentToolArtifact = (value: unknown): value is AgentToolArtifact => Value.Check(AgentToolArtifactSchema, value);

export const AgentEventSchema = Type.Object({
  schemaVersion: Type.Literal('1'),
  runId: Type.String({ minLength: 1 }),
  sequence: Type.Integer({ minimum: 1 }),
  type: AgentEventTypeSchema,
  occurredAt: Type.String({ format: 'date-time' }),
  payload: Type.Record(Type.String(), Type.Unknown()),
  checkpointRef: Type.Optional(Type.String({ pattern: '^checkpoint://' }))
}, { $id: 'AgentEvent.v1', additionalProperties: false });
export type AgentEvent = Static<typeof AgentEventSchema>;

export const AgentRunStatusSchema = Type.Union([
  Type.Literal('succeeded'),
  Type.Literal('failed'),
  Type.Literal('cancelled'),
  Type.Literal('deadline_exceeded'),
  Type.Literal('budget_exhausted'),
  Type.Literal('paused')
]);
export type AgentRunStatus = Static<typeof AgentRunStatusSchema>;

export const AgentRunOutcomeSchema = Type.Object({
  schemaVersion: Type.Literal('1'),
  runId: Type.String({ minLength: 1 }),
  status: AgentRunStatusSchema,
  output: Type.Optional(Type.String()),
  error: Type.Optional(AgentErrorSchema),
  checkpointRef: Type.Optional(Type.String({ pattern: '^checkpoint://' })),
  usage: Type.Object({ turns: Type.Integer({ minimum: 0 }), toolCalls: Type.Integer({ minimum: 0 }), tokens: Type.Integer({ minimum: 0 }) }),
  completedAt: Type.String({ format: 'date-time' })
}, { $id: 'AgentRunOutcome.v1', additionalProperties: false });
export type AgentRunOutcome = Static<typeof AgentRunOutcomeSchema>;

export const HarnessCapabilitiesSchema = Type.Object({
  harness: Type.String({ minLength: 1 }),
  version: Type.String({ minLength: 1 }),
  supported: Type.Array(HarnessCapabilitySchema, { uniqueItems: true })
}, { $id: 'HarnessCapabilities.v1', additionalProperties: false });
export type HarnessCapabilities = Static<typeof HarnessCapabilitiesSchema>;

export interface HarnessTurnRequest {
  readonly runId: string;
  readonly input: string;
  readonly turn: number;
  readonly skillRefs: readonly string[];
  readonly resumeFrom?: string;
  readonly remaining: { readonly toolCalls: number; readonly tokens: number };
}

export interface HarnessTurnResult {
  readonly output: string;
  readonly done: boolean;
  readonly toolCalls: number;
  readonly tokens: number;
  readonly checkpointRef?: string;
  readonly pause?: boolean;
}

export interface HarnessPort {
  readonly capabilities: HarnessCapabilities;
  executeTurn(request: HarnessTurnRequest, signal: AbortSignal): Promise<HarnessTurnResult>;
}

export const PUBLIC_SCHEMA_VERSION = '1' as const;

export const isAgentRunSpec = (value: unknown): value is AgentRunSpec => Value.Check(AgentRunSpecSchema, value);

export const AgentExecutionEnvelopeSchema = Type.Object({ schemaVersion: Type.Literal('1'), specRef: Type.String({ pattern: '^spec://' }), specDigest: Type.String({ pattern: '^sha256:[a-f0-9]{64}$' }), taskId: Type.String({ minLength: 1 }), runId: Type.String({ minLength: 1 }), attemptId: Type.String({ minLength: 1 }), invocationId: Type.String({ minLength: 1 }), checkpointRef: Type.Optional(Type.String({ pattern: '^checkpoint://' })), correlationIds: Type.Optional(Type.Record(Type.String({ minLength: 1, maxLength: 64 }), Type.String({ minLength: 1, maxLength: 256 }), { maxProperties: 16 }) ) }, { $id: 'AgentExecutionEnvelope.v1', additionalProperties: false });
export type AgentExecutionEnvelope = Static<typeof AgentExecutionEnvelopeSchema>;
export const isAgentExecutionEnvelope = (value: unknown): value is AgentExecutionEnvelope => Value.Check(AgentExecutionEnvelopeSchema, value);

export const envelopeMatchesSpec = (envelope: AgentExecutionEnvelope, spec: AgentTaskSpec): boolean =>
  envelope.specRef === spec.specRef && envelope.specDigest === spec.specDigest && envelope.taskId === spec.taskId && envelope.runId === spec.runId && envelope.attemptId === spec.attemptId;

export const AgentEventV2TypeSchema = Type.Union([Type.Literal('run.started'), Type.Literal('context.resolved'), Type.Literal('engine.started'), Type.Literal('model.completed'), Type.Literal('tool.completed'), Type.Literal('checkpoint.sealed'), Type.Literal('run.completed'), Type.Literal('run.failed')]);
export const AgentEventV2Schema = Type.Object({ schemaVersion: Type.Literal('2'), eventId: Type.String({ minLength: 1, maxLength: 128 }), taskId: Type.String({ minLength: 1 }), runId: Type.String({ minLength: 1 }), attemptId: Type.String({ minLength: 1 }), invocationId: Type.String({ minLength: 1 }), specDigest: Type.String({ pattern: '^sha256:[a-f0-9]{64}$' }), sequence: Type.Integer({ minimum: 1 }), type: AgentEventV2TypeSchema, payload: Type.Record(Type.String({ minLength: 1, maxLength: 64 }), Type.Union([Type.String({ maxLength: 4096 }), Type.Number(), Type.Boolean()]), { maxProperties: 32 }), receiptRefs: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 2048 }), { maxItems: 32, uniqueItems: true })), artifactRefs: Type.Optional(Type.Array(Type.String({ pattern: '^artifact://' }), { maxItems: 32, uniqueItems: true })) }, { $id: 'AgentEvent.v2', additionalProperties: false });
export type AgentEventV2 = Static<typeof AgentEventV2Schema>;
export const isAgentEventV2 = (value: unknown): value is AgentEventV2 => Value.Check(AgentEventV2Schema, value);

export const BoundedRunOutcomeSchema = Type.Union([Type.Literal('CONTINUE'), Type.Literal('COMPLETED'), Type.Literal('FAILED'), Type.Literal('WAITING_FOR_USER'), Type.Literal('WAITING_FOR_APPROVAL'), Type.Literal('PAUSED'), Type.Literal('CANCELLED'), Type.Literal('EFFECT_UNKNOWN')]);
export type BoundedRunOutcome = Static<typeof BoundedRunOutcomeSchema>;
export const ErrorCategorySchema = Type.Union([Type.Literal('VALIDATION'), Type.Literal('INTEGRITY'), Type.Literal('INCOMPATIBLE'), Type.Literal('AUTHORIZATION'), Type.Literal('BUDGET'), Type.Literal('CANCELLATION'), Type.Literal('DEPENDENCY_TRANSIENT'), Type.Literal('DEPENDENCY_PERMANENT'), Type.Literal('EFFECT_UNKNOWN'), Type.Literal('STATE_UNAVAILABLE'), Type.Literal('INTERNAL')]);
export type ErrorCategory = Static<typeof ErrorCategorySchema>;
export const RetryDispositionSchema = Type.Union([Type.Literal('NEVER'), Type.Literal('DELIVERY_RETRY'), Type.Literal('REQUIRES_NEW_ATTEMPT'), Type.Literal('MANUAL_RESOLUTION')]);
export type RetryDisposition = Static<typeof RetryDispositionSchema>;
export const BoundedRunReceiptSchema = Type.Object({ schemaVersion: Type.Literal('1'), receiptRef: Type.String({ pattern: '^receipt://' }), invocationId: Type.String({ minLength: 1 }), specDigest: Type.String({ pattern: '^sha256:[a-f0-9]{64}$' }), outcome: BoundedRunOutcomeSchema, eventRange: Type.Object({ first: Type.Integer({ minimum: 1 }), last: Type.Integer({ minimum: 1 }) }, { additionalProperties: false }), error: Type.Optional(Type.Object({ code: Type.String({ minLength: 1 }), category: ErrorCategorySchema, retryDisposition: RetryDispositionSchema, safeMessage: Type.String({ minLength: 1, maxLength: 1024 }) }, { additionalProperties: false })), checkpointRef: Type.Optional(Type.String({ pattern: '^checkpoint://' })), receiptRefs: Type.Array(Type.String({ minLength: 1 }), { maxItems: 64, uniqueItems: true }), artifactRefs: Type.Array(Type.String({ pattern: '^artifact://' }), { maxItems: 64, uniqueItems: true }) }, { $id: 'BoundedRunReceipt.v1', additionalProperties: false });
export type BoundedRunReceipt = Static<typeof BoundedRunReceiptSchema>;
export const isBoundedRunReceipt = (value: unknown): value is BoundedRunReceipt => Value.Check(BoundedRunReceiptSchema, value);

export const AgentStateSchema = Type.Object({ schemaVersion: Type.Literal('1'), goal: Type.Optional(Type.String({ maxLength: 4096 })), planRef: Type.Optional(Type.String({ minLength: 1, maxLength: 2048 })), currentIntent: Type.Optional(Type.String({ maxLength: 4096 })), observationRefs: Type.Array(Type.String({ minLength: 1, maxLength: 2048 }), { maxItems: 64, uniqueItems: true }), receiptRefs: Type.Array(Type.String({ minLength: 1, maxLength: 2048 }), { maxItems: 128, uniqueItems: true }), outputDraftRef: Type.Optional(Type.String({ pattern: '^artifact://' })), consumptionProjection: Type.Optional(Type.Object({ turns: Type.Integer({ minimum: 0, maximum: 10000 }), tokens: Type.Integer({ minimum: 0, maximum: 100000000 }) }, { additionalProperties: false })) }, { $id: 'AgentState.v1', additionalProperties: false });
export type AgentState = Static<typeof AgentStateSchema>;
export const isAgentState = (value: unknown): value is AgentState => Value.Check(AgentStateSchema, value);

export const CheckpointCandidateSchema = Type.Object({ schemaVersion: Type.Literal('1'), candidateDigest: Type.String({ pattern: '^sha256:[a-f0-9]{64}$' }), taskId: Type.String({ minLength: 1 }), runId: Type.String({ minLength: 1 }), attemptId: Type.String({ minLength: 1 }), specDigest: Type.String({ pattern: '^sha256:[a-f0-9]{64}$' }), sequence: Type.Integer({ minimum: 1 }), state: AgentStateSchema, engineCodec: Type.String({ minLength: 1 }), runtimeContractMajor: Type.Integer({ minimum: 1 }), receiptRefs: Type.Array(Type.String({ minLength: 1 }), { maxItems: 128, uniqueItems: true }), bodyDigest: Type.Optional(Type.String({ pattern: '^sha256:[a-f0-9]{64}$' })), inputDigest: Type.Optional(Type.String({ pattern: '^sha256:[a-f0-9]{64}$' })), evidenceDigest: Type.Optional(Type.String({ pattern: '^sha256:[a-f0-9]{64}$' })), sensitivity: Type.Optional(Type.Union([Type.Literal('public'), Type.Literal('internal'), Type.Literal('restricted')])), retentionRef: Type.Optional(Type.String({ pattern: '^retention://', maxLength: 2048 })) }, { $id: 'CheckpointCandidate.v1', additionalProperties: false });
export type CheckpointCandidate = Static<typeof CheckpointCandidateSchema>;
export const isCheckpointCandidate = (value: unknown): value is CheckpointCandidate => Value.Check(CheckpointCandidateSchema, value);
export const agentStateDigest = (state: AgentState): ContentDigest => sha256Digest(state);
export const SealedCheckpointRefSchema = Type.Object({ checkpointRef: Type.String({ pattern: '^checkpoint://' }), candidateDigest: Type.String({ pattern: '^sha256:[a-f0-9]{64}$' }), specDigest: Type.String({ pattern: '^sha256:[a-f0-9]{64}$' }), sequence: Type.Integer({ minimum: 1 }), engineCodec: Type.String({ minLength: 1 }), runtimeContractMajor: Type.Integer({ minimum: 1 }) }, { $id: 'SealedCheckpointRef.v1', additionalProperties: false });
export type SealedCheckpointRef = Static<typeof SealedCheckpointRefSchema>;
export const isSealedCheckpointRef = (value: unknown): value is SealedCheckpointRef => Value.Check(SealedCheckpointRefSchema, value);
export const FinalizedRunAuditRecordSchema = Type.Object({ schemaVersion: Type.Literal('1'), specRef: Type.String({ pattern: '^spec://' }), specDigest: Type.String({ pattern: '^sha256:[a-f0-9]{64}$' }), releaseRef: Type.String({ pattern: '^release://' }), releaseDigest: Type.String({ pattern: '^sha256:[a-f0-9]{64}$' }), finalReceiptRef: Type.String({ pattern: '^receipt://' }), receiptRefs: Type.Array(Type.String({ minLength: 1 }), { maxItems: 128, uniqueItems: true }), artifactRefs: Type.Array(Type.String({ pattern: '^artifact://' }), { maxItems: 128, uniqueItems: true }), checkpointRefs: Type.Array(Type.String({ pattern: '^checkpoint://' }), { maxItems: 128, uniqueItems: true }), buildAttestationRefs: Type.Array(Type.String({ minLength: 1, maxLength: 2048 }), { maxItems: 64, uniqueItems: true }), coordinatorRefs: Type.Array(Type.String({ minLength: 1, maxLength: 2048 }), { maxItems: 64, uniqueItems: true }), nonExactReasons: Type.Array(Type.String({ minLength: 1, maxLength: 512 }), { maxItems: 64, uniqueItems: true }) }, { $id: 'FinalizedRunAuditRecord.v1', additionalProperties: false });
export type FinalizedRunAuditRecord = Static<typeof FinalizedRunAuditRecordSchema>;
export const isFinalizedRunAuditRecord = (value: unknown): value is FinalizedRunAuditRecord => Value.Check(FinalizedRunAuditRecordSchema, value);

const uniqueSorted = (values: readonly string[]): string[] => [...new Set(values)].sort();
export const buildFinalizedRunAuditRecord = (input: { readonly specRef: string; readonly specDigest: string; readonly releaseRef: string; readonly releaseDigest: string; readonly receipt: BoundedRunReceipt; readonly receiptRefs?: readonly string[]; readonly artifactRefs?: readonly string[]; readonly checkpointRefs?: readonly string[]; readonly buildAttestationRefs?: readonly string[]; readonly coordinatorRefs?: readonly string[]; readonly nonExactReasons?: readonly string[] }): FinalizedRunAuditRecord => {
  if (!['COMPLETED', 'FAILED', 'CANCELLED', 'EFFECT_UNKNOWN'].includes(input.receipt.outcome)) throw new TypeError('audit requires terminal receipt');
  if (input.receipt.specDigest !== input.specDigest) throw new TypeError('audit receipt/spec digest mismatch');
  return { schemaVersion: '1', specRef: input.specRef, specDigest: input.specDigest, releaseRef: input.releaseRef, releaseDigest: input.releaseDigest, finalReceiptRef: input.receipt.receiptRef, receiptRefs: uniqueSorted([input.receipt.receiptRef, ...input.receipt.receiptRefs, ...(input.receiptRefs ?? [])]), artifactRefs: uniqueSorted([...(input.receipt.artifactRefs ?? []), ...(input.artifactRefs ?? [])]), checkpointRefs: uniqueSorted([...(input.receipt.checkpointRef === undefined ? [] : [input.receipt.checkpointRef]), ...(input.checkpointRefs ?? [])]), buildAttestationRefs: uniqueSorted(input.buildAttestationRefs ?? []), coordinatorRefs: uniqueSorted(input.coordinatorRefs ?? []), nonExactReasons: uniqueSorted(input.nonExactReasons ?? []) };
};

export * from './production-governance.js';
