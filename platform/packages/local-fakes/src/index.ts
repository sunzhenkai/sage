import { createHash, randomUUID } from 'node:crypto';
import { agentStateDigest, isAgentEventV2, isBoundedRunReceipt, isCheckpointCandidate } from '@sage/platform-ports';
import type {
  AdapterHealth,
  AgentTaskSpecStorePort,
  ArtifactAdapter,
  CheckpointStorePort,
  ArtifactMetadata,
  ConnectionRef,
  CredentialLease,
  CredentialProvider,
  CredentialResolutionRequest,
  Environment,
  FailureInjectable,
  IdempotencyClaim,
  IdempotencyStore,
  IdentityClaims,
  OidcAdapter,
  PutArtifactRequest,
  RegistryAdapter,
  RegistryRecord,
  SecretManagerAdapter,
  SecretRef,
  SecretResolutionContext,
  SecretValue
} from '@sage/platform-ports';
import { assertCredentialResolutionRequest, assertNoSensitiveData } from '@sage/platform-ports';

const health = (): AdapterHealth => ({ healthy: true, checkedAt: new Date().toISOString() });

export class InMemoryRegistryAdapter implements RegistryAdapter {
  readonly #records = new Map<string, RegistryRecord>();

  publish<T>(record: RegistryRecord<T>): void {
    this.#records.set(`${record.kind}:${record.id}:${record.version}`, record as RegistryRecord);
  }

  async get<T>(kind: string, id: string, version?: string): Promise<RegistryRecord<T> | undefined> {
    const matches = [...this.#records.values()]
      .filter((record) => record.kind === kind && record.id === id && (version === undefined || record.version === version))
      .sort((left, right) => right.version.localeCompare(left.version));
    return matches[0] as RegistryRecord<T> | undefined;
  }

  async list<T>(kind: string): Promise<readonly RegistryRecord<T>[]> {
    return [...this.#records.values()].filter((record) => record.kind === kind) as RegistryRecord<T>[];
  }

  async health(): Promise<AdapterHealth> { return health(); }
}

export class InMemorySecretManagerAdapter implements SecretManagerAdapter {
  readonly #values = new Map<string, Uint8Array>();

  set(secretRef: string, value: string | Uint8Array): void {
    this.#values.set(secretRef, typeof value === 'string' ? new TextEncoder().encode(value) : value.slice());
  }

  async resolve(secretRef: string, context: SecretResolutionContext): Promise<SecretValue> {
    void context;
    const value = this.#values.get(secretRef);
    if (!value) throw new Error('SECRET_NOT_FOUND');
    return { value: value.slice() };
  }

  async health(): Promise<AdapterHealth> { return health(); }
}

export class StaticOidcAdapter implements OidcAdapter {
  constructor(private readonly claimsByToken: ReadonlyMap<string, IdentityClaims>) {}

  async verify(token: string, requiredScopes: readonly string[] = []): Promise<IdentityClaims> {
    const claims = this.claimsByToken.get(token);
    if (!claims || Date.parse(claims.expiresAt) <= Date.now()) throw new Error('IDENTITY_INVALID');
    if (!requiredScopes.every((scope) => claims.scopes.includes(scope))) throw new Error('SCOPE_DENIED');
    return claims;
  }

  async health(): Promise<AdapterHealth> { return health(); }
}

export class InMemoryArtifactAdapter implements ArtifactAdapter {
  readonly #objects = new Map<string, { tenantId: string; bytes: Uint8Array; metadata: ArtifactMetadata }>();

  async put(request: PutArtifactRequest): Promise<ArtifactMetadata> {
    const artifactRef = `artifact://${randomUUID()}`;
    const metadata: ArtifactMetadata = {
      artifactRef,
      mediaType: request.mediaType,
      size: request.bytes.byteLength,
      sha256: createHash('sha256').update(request.bytes).digest('hex'),
      createdAt: new Date().toISOString()
    };
    this.#objects.set(artifactRef, { tenantId: request.tenantId, bytes: request.bytes.slice(), metadata });
    return metadata;
  }

  async get(artifactRef: string, tenantId: string): Promise<Uint8Array> {
    const object = this.#objects.get(artifactRef);
    if (!object || object.tenantId !== tenantId) throw new Error('ARTIFACT_NOT_FOUND');
    return object.bytes.slice();
  }

  async delete(artifactRef: string, tenantId: string): Promise<void> {
    const object = this.#objects.get(artifactRef);
    if (!object || object.tenantId !== tenantId) throw new Error('ARTIFACT_NOT_FOUND');
    this.#objects.delete(artifactRef);
  }

  async health(): Promise<AdapterHealth> { return health(); }
}

class FailureInjection implements FailureInjectable {
  readonly #failures = new Map<string, Error>();
  readonly #cancellations = new Set<string>();
  failNext(operation: string, error: Error = new Error(`INJECTED_${operation.toUpperCase()}_FAILURE`)): void {
    this.#failures.set(operation, error);
  }
  cancelNext(operation: string): void {
    this.#cancellations.add(operation);
  }
  consume(operation: string): void {
    const error = this.#failures.get(operation);
    if (error) {
      this.#failures.delete(operation);
      throw error;
    }
    if (this.#cancellations.delete(operation)) throw new Error('CANCELLED');
  }
}

interface CredentialBinding {
  readonly value: Uint8Array;
  readonly scope: string;
  readonly connectionRef?: ConnectionRef;
  readonly tenantId: string;
  readonly environment: Environment;
  readonly purpose: string;
}

export class InMemoryCredentialProvider implements CredentialProvider, FailureInjectable {
  readonly #values = new Map<string, CredentialBinding>();
  readonly #failure = new FailureInjection();

  set(secretRef: SecretRef, value: string | Uint8Array, options: {
    scope: string;
    connectionRef?: ConnectionRef;
    tenantId: string;
    environment: Environment;
    purpose: string;
  }): void {
    if (!options.scope || !options.tenantId || !options.environment || !options.purpose) throw new Error('INVALID_CREDENTIAL_BINDING');
    this.#values.set(secretRef, {
      value: typeof value === 'string' ? new TextEncoder().encode(value) : value.slice(),
      scope: options.scope,
      tenantId: options.tenantId,
      environment: options.environment,
      purpose: options.purpose,
      ...(options.connectionRef === undefined ? {} : { connectionRef: options.connectionRef })
    });
  }

  failNext(operation: string, error?: Error): void { this.#failure.failNext(operation, error); }

  async resolveCredential(request: CredentialResolutionRequest): Promise<CredentialLease> {
    this.#failure.consume('resolve');
    assertCredentialResolutionRequest(request);
    const stored = this.#values.get(request.secretRef);
    if (!stored
      || stored.connectionRef !== request.connectionRef
      || stored.tenantId !== request.tenantId
      || stored.environment !== request.environment
      || stored.purpose !== request.purpose
      || stored.scope !== request.scope) {
      throw new Error('CREDENTIAL_NOT_FOUND');
    }
    return {
      value: stored.value.slice(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      scope: stored.scope
    };
  }

  async health(): Promise<AdapterHealth> {
    this.#failure.consume('health');
    return health();
  }
}

export class InMemoryIdempotencyStore implements IdempotencyStore {
  readonly #records = new Map<string, { status: 'claimed'; ownerToken: string; leaseExpiresAt: string } | { status: 'completed'; result: unknown }>();

  async claim(key: string, ownerToken: string, leaseExpiresAt: string): Promise<IdempotencyClaim> {
    const existing = this.#records.get(key);
    if (!existing || (existing.status === 'claimed' && Date.parse(existing.leaseExpiresAt) <= Date.now())) {
      this.#records.set(key, { status: 'claimed', ownerToken, leaseExpiresAt });
      return { status: 'claimed' };
    }
    return existing.status === 'completed'
      ? { status: 'completed', result: structuredClone(existing.result) }
      : { status: 'in_progress' };
  }

  async get(key: string): Promise<IdempotencyClaim> {
    const existing = this.#records.get(key);
    if (!existing) return { status: 'in_progress' };
    return existing.status === 'completed'
      ? { status: 'completed', result: structuredClone(existing.result) }
      : { status: 'in_progress' };
  }

  async complete(key: string, ownerToken: string, result: unknown): Promise<void> {
    assertNoSensitiveData(result);
    const existing = this.#records.get(key);
    if (!existing || existing.status !== 'claimed' || existing.ownerToken !== ownerToken) throw new Error('IDEMPOTENCY_CLAIM_LOST');
    this.#records.set(key, { status: 'completed', result: structuredClone(result) });
  }

  async release(key: string, ownerToken: string): Promise<void> {
    const existing = this.#records.get(key);
    if (existing?.status === 'claimed' && existing.ownerToken === ownerToken) this.#records.delete(key);
  }

  async health(): Promise<AdapterHealth> { return health(); }
}

export class FailureInjectableArtifactAdapter implements ArtifactAdapter, FailureInjectable {
  readonly #failure = new FailureInjection();
  constructor(private readonly delegate: ArtifactAdapter = new InMemoryArtifactAdapter()) {}
  failNext(operation: string, error?: Error): void { this.#failure.failNext(operation, error); }
  async put(request: PutArtifactRequest): Promise<ArtifactMetadata> {
    this.#failure.consume('put');
    return this.delegate.put(request);
  }
  async get(artifactRef: string, tenantId: string): Promise<Uint8Array> {
    this.#failure.consume('get');
    return this.delegate.get(artifactRef, tenantId);
  }
  async delete(artifactRef: string, tenantId: string): Promise<void> {
    this.#failure.consume('delete');
    return this.delegate.delete(artifactRef, tenantId);
  }
  async health(): Promise<AdapterHealth> {
    this.#failure.consume('health');
    return this.delegate.health();
  }
}


/** Content-addressed fake that preserves immutable Spec authority for each tenant Attempt. */
export class InMemoryAgentTaskSpecStore implements AgentTaskSpecStorePort, FailureInjectable {
  readonly #byRef = new Map<string, { readonly tenantId: string; readonly spec: Parameters<AgentTaskSpecStorePort['putSpec']>[0]['spec'] }>();
  readonly #attemptRef = new Map<string, string>();
  readonly #failure = new FailureInjection();

  failNext(operation: string, error?: Error): void { this.#failure.failNext(operation, error); }

  async putSpec(input: Parameters<AgentTaskSpecStorePort['putSpec']>[0]): Promise<Awaited<ReturnType<AgentTaskSpecStorePort['putSpec']>>> {
    this.#failure.consume('putSpec');
    if (input.spec.tenantId !== input.tenantId) throw new Error('SPEC_TENANT_MISMATCH');
    const attemptKey = `${input.tenantId}\u0000${input.spec.attemptId}`;
    const existingAttemptRef = this.#attemptRef.get(attemptKey);
    if (existingAttemptRef !== undefined && existingAttemptRef !== input.spec.specRef) {
      return { status: 'conflict', code: 'ATTEMPT_SPEC_CONFLICT' };
    }
    const existing = this.#byRef.get(input.spec.specRef);
    if (existing !== undefined) {
      if (existing.tenantId !== input.tenantId || existing.spec.specDigest !== input.spec.specDigest) {
        return { status: 'conflict', code: 'SPEC_REF_CONFLICT' };
      }
      this.#attemptRef.set(attemptKey, input.spec.specRef);
      return { status: 'existing', value: structuredClone(existing.spec) };
    }
    this.#byRef.set(input.spec.specRef, { tenantId: input.tenantId, spec: structuredClone(input.spec) });
    this.#attemptRef.set(attemptKey, input.spec.specRef);
    return { status: 'stored', value: structuredClone(input.spec) };
  }

  async getSpec(input: Parameters<AgentTaskSpecStorePort['getSpec']>[0]): Promise<Awaited<ReturnType<AgentTaskSpecStorePort['getSpec']>>> {
    this.#failure.consume('getSpec');
    const existing = this.#byRef.get(input.specRef);
    if (existing === undefined || existing.tenantId !== input.tenantId || existing.spec.specDigest !== input.expectedDigest) return undefined;
    return structuredClone(existing.spec);
  }

  async health(): Promise<AdapterHealth> {
    this.#failure.consume('health');
    return health();
  }
}


import type { AgentEventStorePort, BoundedRunReceiptStorePort } from '@sage/platform-ports';

/** Fenced in-memory Event authority: exactly one writer may append a strictly ordered run stream. */
export class InMemoryAgentEventStore implements AgentEventStorePort, FailureInjectable {
  readonly #streams = new Map<string, {
    readonly ownerToken: string;
    readonly epoch: number;
    readonly eventsBySequence: Map<number, Parameters<AgentEventStorePort['appendEvent']>[0]['event']>;
    readonly eventsById: Map<string, Parameters<AgentEventStorePort['appendEvent']>[0]['event']>;
    nextSequence: number;
  }>();
  readonly #epochs = new Map<string, number>();
  readonly #artifactRefs = new Set<string>();
  readonly #receiptRefs = new Set<string>();
  readonly #sealedCheckpointRefs = new Set<string>();
  readonly #failure = new FailureInjection();

  registerFinalizedArtifactRef(tenantId: string, artifactRef: string): void { this.#artifactRefs.add(`${tenantId}\u0000${artifactRef}`); }
  registerCommittedReceiptRef(tenantId: string, receiptRef: string): void { this.#receiptRefs.add(`${tenantId}\u0000${receiptRef}`); }
  registerSealedCheckpointRef(tenantId: string, checkpointRef: string): void { this.#sealedCheckpointRefs.add(`${tenantId}\u0000${checkpointRef}`); }

  failNext(operation: string, error?: Error): void { this.#failure.failNext(operation, error); }

  async acquireWriterFence(input: Parameters<AgentEventStorePort['acquireWriterFence']>[0]): Promise<Awaited<ReturnType<AgentEventStorePort['acquireWriterFence']>>> {
    this.#failure.consume('acquireWriterFence');
    const key = this.#streamKey(input);
    const existing = this.#streams.get(key);
    if (existing !== undefined) {
      if (existing.ownerToken !== input.ownerToken) return { status: 'held', code: 'EVENT_WRITER_FENCED' };
      return { status: 'acquired', fence: { ...input, epoch: existing.epoch } };
    }
    const epoch = (this.#epochs.get(key) ?? 0) + 1;
    this.#epochs.set(key, epoch);
    this.#streams.set(key, { ownerToken: input.ownerToken, epoch, eventsBySequence: new Map(), eventsById: new Map(), nextSequence: 1 });
    return { status: 'acquired', fence: { ...input, epoch } };
  }

  async appendEvent(input: Parameters<AgentEventStorePort['appendEvent']>[0]): Promise<Awaited<ReturnType<AgentEventStorePort['appendEvent']>>> {
    this.#failure.consume('appendEvent');
    if (!isAgentEventV2(input.event)) throw new Error('EVENT_SCHEMA_INVALID');
    this.#assertReferences(input.fence.tenantId, input.event);
    const stream = this.#streams.get(this.#streamKey(input.fence));
    if (stream === undefined || stream.ownerToken !== input.fence.ownerToken || stream.epoch !== input.fence.epoch) {
      return { status: 'conflict', code: 'EVENT_FENCE_LOST' };
    }
    if (input.event.taskId !== input.fence.taskId || input.event.runId !== input.fence.runId || input.event.attemptId !== input.fence.attemptId) {
      return { status: 'conflict', code: 'EVENT_FENCE_LOST' };
    }
    const existingById = stream.eventsById.get(input.event.eventId);
    if (existingById !== undefined) {
      return this.#sameEvent(existingById, input.event)
        ? { status: 'existing', event: structuredClone(existingById) }
        : { status: 'conflict', code: 'EVENT_ID_CONFLICT' };
    }
    if (input.event.sequence !== stream.nextSequence) return { status: 'conflict', code: 'EVENT_SEQUENCE_CONFLICT' };
    const stored = structuredClone(input.event);
    stream.eventsBySequence.set(stored.sequence, stored);
    stream.eventsById.set(stored.eventId, stored);
    stream.nextSequence += 1;
    return { status: 'appended', event: structuredClone(stored) };
  }

  async listEvents(input: Parameters<AgentEventStorePort['listEvents']>[0]): Promise<Awaited<ReturnType<AgentEventStorePort['listEvents']>>> {
    this.#failure.consume('listEvents');
    const stream = this.#streams.get(this.#streamKey(input));
    if (stream === undefined) return [];
    const fromSequence = input.fromSequence ?? 1;
    return [...stream.eventsBySequence.values()]
      .filter((event) => event.sequence >= fromSequence)
      .sort((left, right) => left.sequence - right.sequence)
      .map((event) => structuredClone(event));
  }

  async health(): Promise<AdapterHealth> {
    this.#failure.consume('health');
    return health();
  }

  #assertReferences(tenantId: string, event: Parameters<AgentEventStorePort['appendEvent']>[0]['event']): void {
    if (event.artifactRefs?.some((ref) => !this.#artifactRefs.has(`${tenantId}\u0000${ref}`))) throw new Error('EVENT_ARTIFACT_REF_UNAVAILABLE');
    if (event.receiptRefs?.some((ref) => !this.#receiptRefs.has(`${tenantId}\u0000${ref}`))) throw new Error('EVENT_RECEIPT_REF_UNAVAILABLE');
  }

  #streamKey(identity: Pick<Parameters<AgentEventStorePort['acquireWriterFence']>[0], 'tenantId' | 'taskId' | 'runId' | 'attemptId'>): string {
    return `${identity.tenantId}\u0000${identity.taskId}\u0000${identity.runId}\u0000${identity.attemptId}`;
  }

  #sameEvent(left: Parameters<AgentEventStorePort['appendEvent']>[0]['event'], right: Parameters<AgentEventStorePort['appendEvent']>[0]['event']): boolean {
    return JSON.stringify(left) === JSON.stringify(right);
  }
}

/** In-memory Receipt authority keyed by tenant and invocation, retaining the original immutable receipt. */
export class InMemoryBoundedRunReceiptStore implements BoundedRunReceiptStorePort, FailureInjectable {
  readonly #receipts = new Map<string, { readonly digest: string; readonly receipt: Parameters<BoundedRunReceiptStorePort['putReceipt']>[0]['receipt'] }>();
  readonly #artifactRefs = new Set<string>();
  readonly #receiptRefs = new Set<string>();
  readonly #failure = new FailureInjection();

  registerFinalizedArtifactRef(tenantId: string, artifactRef: string): void { this.#artifactRefs.add(`${tenantId}\u0000${artifactRef}`); }
  registerCommittedReceiptRef(tenantId: string, receiptRef: string): void { this.#receiptRefs.add(`${tenantId}\u0000${receiptRef}`); }

  failNext(operation: string, error?: Error): void { this.#failure.failNext(operation, error); }

  async putReceipt(input: Parameters<BoundedRunReceiptStorePort['putReceipt']>[0]): Promise<Awaited<ReturnType<BoundedRunReceiptStorePort['putReceipt']>>> {
    this.#failure.consume('putReceipt');
    if (!isBoundedRunReceipt(input.receipt)) throw new Error('RECEIPT_SCHEMA_INVALID');
    if (input.receipt.artifactRefs.some((ref) => !this.#artifactRefs.has(`${input.tenantId}\u0000${ref}`))) throw new Error('RECEIPT_ARTIFACT_REF_UNAVAILABLE');
    if (input.receipt.receiptRefs.some((ref) => !this.#receiptRefs.has(`${input.tenantId}\u0000${ref}`))) throw new Error('RECEIPT_REF_UNAVAILABLE');
    const key = this.#receiptKey(input.tenantId, input.receipt.invocationId);
    const existing = this.#receipts.get(key);
    if (existing !== undefined) {
      return existing.digest === input.receiptDigest
        ? { status: 'existing', value: structuredClone(existing.receipt) }
        : { status: 'conflict', code: 'RECEIPT_CONFLICT' };
    }
    const stored = structuredClone(input.receipt);
    this.#receipts.set(key, { digest: input.receiptDigest, receipt: stored });
    this.#receiptRefs.add(`${input.tenantId}\u0000${stored.receiptRef}`);
    return { status: 'stored', value: structuredClone(stored) };
  }

  async getReceipt(input: Parameters<BoundedRunReceiptStorePort['getReceipt']>[0]): Promise<Awaited<ReturnType<BoundedRunReceiptStorePort['getReceipt']>>> {
    this.#failure.consume('getReceipt');
    const stored = this.#receipts.get(this.#receiptKey(input.tenantId, input.invocationId));
    return stored === undefined ? undefined : structuredClone(stored.receipt);
  }

  async health(): Promise<AdapterHealth> {
    this.#failure.consume('health');
    return health();
  }

  #receiptKey(tenantId: string, invocationId: string): string { return `${tenantId}\u0000${invocationId}`; }
}


type CheckpointFence = Parameters<CheckpointStorePort['stageCandidate']>[0]['fence'];
type CheckpointCandidate = Parameters<CheckpointStorePort['stageCandidate']>[0]['candidate'];
type SealedCheckpoint = Exclude<Awaited<ReturnType<CheckpointStorePort['sealCandidate']>>, { status: 'conflict' }>['checkpoint'];

/** Candidate-only fake: it publishes a resumable reference only after a fenced, validated seal. */
export class InMemoryCheckpointStore implements CheckpointStorePort, FailureInjectable {
  readonly #candidates = new Map<string, { readonly tenantId: string; readonly fence: CheckpointFence; readonly candidate: CheckpointCandidate }>();
  readonly #candidateBySequence = new Map<string, string>();
  readonly #highestSequence = new Map<string, number>();
  readonly #activeFences = new Map<string, CheckpointFence>();
  readonly #sealedByDigest = new Map<string, { readonly tenantId: string; readonly candidate: CheckpointCandidate; readonly checkpoint: SealedCheckpoint }>();
  readonly #sealedByRef = new Map<string, { readonly tenantId: string; readonly candidate: CheckpointCandidate; readonly checkpoint: SealedCheckpoint }>();
  readonly #lineage = new Set<string>();
  readonly #artifactRefs = new Set<string>();
  readonly #failure = new FailureInjection();

  /** Registers a finalized ArtifactRef permitted for this tenant's checkpoint state. */
  registerFinalizedArtifactRef(tenantId: string, artifactRef: string): void { this.#artifactRefs.add(`${tenantId}\u0000${artifactRef}`); }

  /** Registers a committed Effect/Usage/other receipt reference permitted for this tenant's candidate lineage. */
  registerReceiptLineage(tenantId: string, receiptRef: string): void { this.#lineage.add(`${tenantId}\u0000${receiptRef}`); }
  failNext(operation: string, error?: Error): void { this.#failure.failNext(operation, error); }
  cancelNext(operation: string): void { this.#failure.cancelNext(operation); }

  async stageCandidate(input: Parameters<CheckpointStorePort['stageCandidate']>[0]): Promise<Awaited<ReturnType<CheckpointStorePort['stageCandidate']>>> {
    this.#failure.consume('stageBody');
    this.#failure.consume('stageMetadata');
    this.#failure.consume('stageCandidate');
    if (!isCheckpointCandidate(input.candidate)) return { status: 'conflict', code: 'CHECKPOINT_CANDIDATE_CONFLICT' };
    if (input.candidate.bodyDigest !== undefined && input.candidate.bodyDigest !== agentStateDigest(input.candidate.state)) return { status: 'conflict', code: 'CHECKPOINT_CANDIDATE_CONFLICT' };
    if (input.candidate.state.outputDraftRef !== undefined && !this.#artifactRefs.has(`${input.tenantId}\u0000${input.candidate.state.outputDraftRef}`)) return { status: 'conflict', code: 'CHECKPOINT_CANDIDATE_CONFLICT' };
    if (!this.#matchesFence(input.tenantId, input.fence, input.candidate) || !this.#acceptFence(input.fence)) {
      return { status: 'conflict', code: 'CHECKPOINT_FENCE_LOST' };
    }
    if (input.candidate.state.schemaVersion !== '1' || !input.candidate.engineCodec || input.candidate.runtimeContractMajor < 1) {
      return { status: 'conflict', code: 'CHECKPOINT_CANDIDATE_CONFLICT' };
    }
    if (!input.candidate.receiptRefs.every((ref) => this.#lineage.has(`${input.tenantId}\u0000${ref}`))) {
      return { status: 'conflict', code: 'CHECKPOINT_CANDIDATE_CONFLICT' };
    }
    const digestKey = this.#digestKey(input.tenantId, input.candidate.candidateDigest);
    const existing = this.#candidates.get(digestKey);
    if (existing !== undefined) {
      return existing.tenantId === input.tenantId && this.#same(existing.candidate, input.candidate)
        ? { status: 'existing', candidate: structuredClone(existing.candidate) }
        : { status: 'conflict', code: 'CHECKPOINT_CANDIDATE_CONFLICT' };
    }
    const identityKey = this.#identityKey(input.tenantId, input.candidate);
    const sequenceKey = `${identityKey}\u0000${input.candidate.sequence}`;
    if (this.#candidateBySequence.has(sequenceKey) || input.candidate.sequence <= (this.#highestSequence.get(identityKey) ?? 0)) {
      return { status: 'conflict', code: 'CHECKPOINT_CANDIDATE_CONFLICT' };
    }
    const stored = structuredClone(input.candidate);
    this.#candidates.set(digestKey, { tenantId: input.tenantId, fence: structuredClone(input.fence), candidate: stored });
    this.#candidateBySequence.set(sequenceKey, stored.candidateDigest);
    this.#highestSequence.set(identityKey, stored.sequence);
    return { status: 'staged', candidate: structuredClone(stored) };
  }

  async sealCandidate(input: Parameters<CheckpointStorePort['sealCandidate']>[0]): Promise<Awaited<ReturnType<CheckpointStorePort['sealCandidate']>>> {
    this.#failure.consume('sealCandidate');
    const stored = this.#candidates.get(this.#digestKey(input.tenantId, input.candidateDigest));
    if (stored === undefined) return { status: 'conflict', code: 'CHECKPOINT_SEAL_CONFLICT' };
    if (!this.#matchesFence(input.tenantId, input.fence, stored.candidate) || !this.#isCurrentFence(input.fence)) {
      return { status: 'conflict', code: 'CHECKPOINT_FENCE_LOST' };
    }
    const alreadySealed = this.#sealedByDigest.get(this.#digestKey(input.tenantId, input.candidateDigest));
    if (alreadySealed !== undefined) return { status: 'existing', checkpoint: structuredClone(alreadySealed.checkpoint) };
    if (!stored.candidate.receiptRefs.every((ref) => this.#lineage.has(`${input.tenantId}\u0000${ref}`))) {
      return { status: 'conflict', code: 'CHECKPOINT_LINEAGE_INVALID' };
    }
    const checkpoint: SealedCheckpoint = {
      checkpointRef: `checkpoint://sealed/${stored.candidate.candidateDigest.slice('sha256:'.length)}`,
      candidateDigest: stored.candidate.candidateDigest,
      specDigest: stored.candidate.specDigest,
      sequence: stored.candidate.sequence,
      engineCodec: stored.candidate.engineCodec,
      runtimeContractMajor: stored.candidate.runtimeContractMajor
    };
    const sealed = { tenantId: input.tenantId, candidate: structuredClone(stored.candidate), checkpoint };
    this.#sealedByDigest.set(this.#digestKey(input.tenantId, input.candidateDigest), sealed);
    this.#sealedByRef.set(this.#refKey(input.tenantId, checkpoint.checkpointRef), sealed);
    return { status: 'sealed', checkpoint: structuredClone(checkpoint) };
  }

  async getSealedCheckpoint(input: Parameters<CheckpointStorePort['getSealedCheckpoint']>[0]): Promise<Awaited<ReturnType<CheckpointStorePort['getSealedCheckpoint']>>> {
    this.#failure.consume('getSealedCheckpoint');
    const sealed = this.#sealedByRef.get(this.#refKey(input.tenantId, input.checkpointRef));
    if (sealed === undefined) return undefined;
    const candidate = sealed.candidate;
    if (!isCheckpointCandidate(candidate)
      || (candidate.bodyDigest !== undefined && candidate.bodyDigest !== agentStateDigest(candidate.state))
      || candidate.taskId !== input.taskId || candidate.runId !== input.runId || candidate.attemptId !== input.attemptId
      || candidate.specDigest !== input.specDigest || (input.sequence !== undefined && candidate.sequence !== input.sequence)
      || candidate.engineCodec !== input.engineCodec || candidate.runtimeContractMajor !== input.runtimeContractMajor) return undefined;
    if (!candidate.receiptRefs.every((ref) => this.#lineage.has(`${input.tenantId}\u0000${ref}`))) return undefined;
    return structuredClone(sealed.checkpoint);
  }

  async health(): Promise<AdapterHealth> {
    this.#failure.consume('health');
    return health();
  }

  #matchesFence(tenantId: string, fence: CheckpointFence, candidate: CheckpointCandidate): boolean {
    return fence.tenantId === tenantId && candidate.taskId === fence.taskId && candidate.runId === fence.runId && candidate.attemptId === fence.attemptId;
  }
  #acceptFence(fence: CheckpointFence): boolean {
    const key = this.#identityKey(fence.tenantId, fence);
    const active = this.#activeFences.get(key);
    if (active !== undefined && (fence.epoch < active.epoch || (fence.epoch === active.epoch && fence.ownerToken !== active.ownerToken))) return false;
    this.#activeFences.set(key, structuredClone(fence));
    return true;
  }
  #isCurrentFence(fence: CheckpointFence): boolean {
    const active = this.#activeFences.get(this.#identityKey(fence.tenantId, fence));
    return active !== undefined && active.ownerToken === fence.ownerToken && active.epoch === fence.epoch;
  }
  #identityKey(tenantId: string, identity: Pick<CheckpointFence, 'taskId' | 'runId' | 'attemptId'>): string {
    return `${tenantId}\u0000${identity.taskId}\u0000${identity.runId}\u0000${identity.attemptId}`;
  }
  #digestKey(tenantId: string, digest: string): string { return `${tenantId}\u0000${digest}`; }
  #refKey(tenantId: string, ref: string): string { return `${tenantId}\u0000${ref}`; }
  #same(left: CheckpointCandidate, right: CheckpointCandidate): boolean { return JSON.stringify(left) === JSON.stringify(right); }
}
export * from './runtime.js';

export { InMemoryDurableCoordinatorFake } from './coordinator.js';

export { InMemoryScheduleFake, ScheduleFakeError } from './schedule.js';

export * from './production-governance.js';
