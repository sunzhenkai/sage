import type { AgentExecutionEnvelope, AgentTaskSpec, BoundedRunReceipt, CheckpointCandidate, SealedCheckpointRef } from '@sage/agent-contracts';
import type { AdapterHealth, AgentEventStorePort, ArtifactRef, CheckpointStorePort } from './index.js';

export type RuntimeScalar = string | number | boolean;
export type BoundedRuntimePayload = Readonly<Record<string, RuntimeScalar>>;

export interface RuntimeIdentity {
  readonly principalRef: string;
  readonly tenantId: string;
  readonly taskId: string;
  readonly runId: string;
  readonly attemptId: string;
  readonly invocationId: string;
  readonly specDigest: string;
}

export interface LedgerAccountRef {
  readonly accountRef: string;
  readonly tenantId: string;
}

export interface LedgerBalance {
  readonly account: LedgerAccountRef;
  readonly remaining: Readonly<Record<string, number>>;
  readonly revision: number;
}

export interface UsageReservation {
  readonly reservationRef: string;
  readonly invocationId: string;
  readonly accountRef: string;
  readonly upperBound: Readonly<Record<string, number>>;
  readonly expiresAt: string;
  readonly fence: string;
}

export type LedgerReserveResult =
  | { readonly status: 'reserved'; readonly reservation: UsageReservation; readonly balance: LedgerBalance }
  | { readonly status: 'existing'; readonly reservation: UsageReservation; readonly balance: LedgerBalance }
  | { readonly status: 'rejected'; readonly code: 'LEDGER_INSUFFICIENT' | 'LEDGER_TENANT_MISMATCH' | 'LEDGER_RESERVATION_CONFLICT' | 'LEDGER_UNAVAILABLE' };

export interface UsageReceipt {
  readonly receiptRef: string;
  readonly receiptDigest: string;
  readonly invocationId: string;
  readonly reservationRef: string;
  readonly actual: Readonly<Record<string, number>>;
  readonly cost: number;
  readonly modelRef?: string;
  readonly providerRequestRef?: string;
  readonly nonExactReason?: string;
  /** Immutable adapter and route metadata needed for audit, not execution authority. */
  readonly adapterBuild?: string;
  readonly parametersDigest?: string;
  readonly region?: string;
  readonly dataPolicyDigest?: string;
}

export type LedgerCommitResult =
  | { readonly status: 'committed' | 'existing'; readonly receipt: UsageReceipt; readonly balance: LedgerBalance }
  | { readonly status: 'conflict'; readonly code: 'USAGE_CONFLICT' | 'RESERVATION_FENCE_LOST' }
  | { readonly status: 'unknown'; readonly code: 'LEDGER_COMMIT_UNKNOWN' };

export interface ConsumptionLedgerPort {
  getBalance(input: LedgerAccountRef): Promise<LedgerBalance>;
  reserve(input: { readonly identity: RuntimeIdentity; readonly accountRef: string; readonly upperBound: Readonly<Record<string, number>>; readonly leaseMs: number }): Promise<LedgerReserveResult>;
  commit(input: { readonly identity: RuntimeIdentity; readonly receipt: UsageReceipt }): Promise<LedgerCommitResult>;
  release(input: { readonly identity: RuntimeIdentity; readonly reservation: UsageReservation; readonly reason: string }): Promise<{ readonly status: 'released' | 'existing' | 'unknown'; readonly balance?: LedgerBalance }>;
  reconcile(input: { readonly now: string; readonly limit: number }): Promise<readonly UsageReservation[]>;
  health(): Promise<AdapterHealth>;
}

export interface ModelBrokerRequest {
  readonly identity: RuntimeIdentity;
  readonly modelRouteRef: string;
  readonly input: BoundedRuntimePayload;
  readonly upperBound: Readonly<Record<string, number>>;
  readonly timeoutMs: number;
  readonly signal: AbortSignal;
}

export interface ModelBrokerObservation {
  readonly observationRef: string;
  readonly output: BoundedRuntimePayload;
  readonly usageReceipt: UsageReceipt;
}

export interface ModelBrokerPort {
  invoke(request: ModelBrokerRequest): Promise<ModelBrokerObservation>;
  health(): Promise<AdapterHealth>;
}

export interface ContextPlanSource {
  readonly sourceRef: string;
  readonly revision: string;
  readonly sensitivity: 'public' | 'internal' | 'restricted';
  readonly content: BoundedRuntimePayload;
}

export interface ContextResolverRequest {
  readonly identity: RuntimeIdentity;
  readonly contextPlanRef: string;
  readonly allowedSourceRefs: readonly string[];
  readonly maxBytes: number;
  readonly maxTokens: number;
  readonly signal: AbortSignal;
}

export interface ContextReceipt {
  readonly receiptRef: string;
  readonly sourceRefs: readonly string[];
  readonly revisions: readonly string[];
  readonly truncated: boolean;
  readonly degraded: boolean;
  readonly provenanceRefs?: readonly string[];
  readonly sensitivity?: 'public' | 'internal' | 'restricted';
  readonly omittedSourceRefs?: readonly string[];
  readonly artifactRefs?: readonly string[];
}

export interface ContextResolverObservation {
  readonly view: BoundedRuntimePayload;
  readonly receipt: ContextReceipt;
}

export interface ContextResolverPort {
  resolve(request: ContextResolverRequest): Promise<ContextResolverObservation>;
  health(): Promise<AdapterHealth>;
}

export interface CapabilityAuthorizationRequest {
  readonly identity: RuntimeIdentity;
  readonly capabilityGrantRef: string;
  readonly toolRef: string;
  readonly providerRef: string;
  readonly schemaVersion: string;
  readonly input: BoundedRuntimePayload;
  readonly actionId: string;
  readonly signal: AbortSignal;
}

export type CapabilityAuthorizationResult =
  | { readonly status: 'allowed' }
  | { readonly status: 'denied'; readonly code: 'CAPABILITY_GRANT_DENIED' | 'CAPABILITY_REVOKED' | 'CAPABILITY_SCOPE_DENIED' | 'CAPABILITY_APPROVAL_REQUIRED' | 'CAPABILITY_APPROVAL_EXPIRED' | 'CAPABILITY_BUDGET_EXCEEDED' | 'CAPABILITY_AUTHORITY_UNAVAILABLE' };

/** Evaluates the monotonic intersection of all capability authorities before execution. */
export interface CapabilityAuthorityPort {
  authorize(request: CapabilityAuthorizationRequest): Promise<CapabilityAuthorizationResult>;
  health(): Promise<AdapterHealth>;
}

export interface CapabilityDescriptor {
  readonly toolRef: string;
  readonly providerRef: string;
  readonly schemaVersion: string;
  readonly access: 'read' | 'write';
}

export interface CapabilityRequest {
  readonly identity: RuntimeIdentity;
  readonly capabilityGrantRef: string;
  readonly toolRef: string;
  readonly providerRef: string;
  readonly schemaVersion: string;
  readonly input: BoundedRuntimePayload;
  readonly actionId: string;
  readonly approvalDigest?: string;
  readonly approvalExpiresAt?: string;
  readonly signal: AbortSignal;
}

export type CapabilityObservation =
  | { readonly status: 'committed'; readonly observationRef: string; readonly effectReceiptRef?: string; readonly output: BoundedRuntimePayload; readonly normalizedResult: unknown }
  | { readonly status: 'denied'; readonly code: string }
  | { readonly status: 'effect_unknown'; readonly code: 'EFFECT_UNKNOWN'; readonly effectReceiptRef?: string; readonly normalizedResult: unknown };

export interface CapabilityBrokerPort {
  describe(input: { readonly identity: RuntimeIdentity; readonly capabilityGrantRef: string }): Promise<readonly CapabilityDescriptor[]>;
  invoke(request: CapabilityRequest): Promise<CapabilityObservation>;
  health(): Promise<AdapterHealth>;
}

export interface ArtifactFinalizeRequest {
  readonly identity: RuntimeIdentity;
  readonly operationId: string;
  readonly mediaType: string;
  readonly bytes: Uint8Array;
  readonly digest: string;
  readonly sensitivity: 'public' | 'internal' | 'restricted';
  readonly lineageRefs: readonly string[];
}

export interface FinalizedArtifact {
  readonly artifactRef: ArtifactRef;
  readonly digest: string;
  readonly sizeBytes: number;
  readonly operationId: string;
}

export interface ArtifactFinalizePort {
  stage(request: ArtifactFinalizeRequest): Promise<{ readonly status: 'staged'; readonly operationId: string } | { readonly status: 'existing'; readonly artifact: FinalizedArtifact }>;
  finalize(input: { readonly identity: RuntimeIdentity; readonly operationId: string }): Promise<{ readonly status: 'finalized' | 'existing'; readonly artifact: FinalizedArtifact } | { readonly status: 'unavailable' | 'conflict'; readonly code: string }>;
  get(input: { readonly identity: RuntimeIdentity; readonly artifactRef: string }): Promise<Uint8Array | undefined>;
  reconcile(input: { readonly now: string; readonly limit: number }): Promise<readonly string[]>;
  health(): Promise<AdapterHealth>;
}

export interface KernelAuthorityStores {
  readonly specs: { getSpec(input: { readonly tenantId: string; readonly specRef: string; readonly expectedDigest: string }): Promise<AgentTaskSpec | undefined> };
  readonly events: AgentEventStorePort;
  readonly receipts: { getReceipt(input: { readonly tenantId: string; readonly invocationId: string }): Promise<BoundedRunReceipt | undefined>; putReceipt(input: { readonly tenantId: string; readonly receipt: BoundedRunReceipt; readonly receiptDigest: string }): Promise<unknown> };
  readonly checkpoints: CheckpointStorePort;
}

export type KernelCommitBarrier = 'none' | 'usage' | 'effect' | 'artifact' | 'checkpoint';
export type KernelExecutionMode = 'legacy' | 'shadow' | 'kernel';

export interface KernelInvocationBinding {
  readonly envelope: AgentExecutionEnvelope;
  readonly spec: AgentTaskSpec;
  readonly identity: RuntimeIdentity;
  readonly commitBarrier: KernelCommitBarrier;
  readonly receipt?: BoundedRunReceipt;
  readonly checkpoint?: SealedCheckpointRef;
  readonly candidate?: CheckpointCandidate;
}
