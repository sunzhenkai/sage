import { createHash } from 'node:crypto';
import type { AdapterHealth, FailureInjectable } from '@sage/platform-ports';
import type { CapabilityBrokerPort, CapabilityDescriptor, CapabilityObservation, CapabilityRequest, ConsumptionLedgerPort, ContextResolverPort, ContextResolverRequest, ContextResolverObservation, ArtifactFinalizePort, ArtifactFinalizeRequest, FinalizedArtifact, LedgerBalance, LedgerCommitResult, LedgerReserveResult, ModelBrokerPort, ModelBrokerRequest, ModelBrokerObservation, RuntimeIdentity, UsageReceipt, UsageReservation } from '@sage/platform-ports';

const sha256Digest = (value: unknown): `sha256:${string}` => `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;

const sha256Bytes = (bytes: Uint8Array): `sha256:${string}` => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const artifactDigestPattern = /^sha256:[a-f0-9]{64}$/;

const validateArtifactRequest = (request: ArtifactFinalizeRequest): void => {
  if (!request.identity.tenantId || !request.identity.invocationId || !request.operationId) throw new Error('ARTIFACT_IDENTITY_INVALID');
  if (!request.mediaType || !request.sensitivity || !artifactDigestPattern.test(request.digest)) throw new Error('ARTIFACT_METADATA_INVALID');
  if (sha256Bytes(request.bytes) !== request.digest) throw new Error('ARTIFACT_DIGEST_MISMATCH');
  if (request.lineageRefs.some((ref) => !/^[a-z][a-z0-9+.-]*:\/\/[^\s]+$/.test(ref)) || new Set(request.lineageRefs).size !== request.lineageRefs.length) throw new Error('ARTIFACT_LINEAGE_INVALID');
};

const health = (): AdapterHealth => ({ healthy: true, checkedAt: new Date().toISOString() });

class Failures implements FailureInjectable {
  readonly #errors = new Map<string, Error>();
  readonly #timeouts = new Map<string, number>();
  readonly #responseLoss = new Set<string>();
  readonly #responseLossAfter = new Set<string>();
  readonly #cancellations = new Set<string>();
  failNext(operation: string, error = new Error(`INJECTED_${operation.toUpperCase()}_FAILURE`)): void { this.#errors.set(operation, error); }
  timeoutNext(operation: string, delayMs = 0): void { this.#timeouts.set(operation, delayMs); }
  loseResponseNext(operation: string): void { this.#responseLoss.add(operation); }
  loseResponseAfter(operation: string): void { this.#responseLossAfter.add(operation); }
  takeResponseLossAfter(operation: string): boolean { if (!this.#responseLossAfter.has(operation)) return false; this.#responseLossAfter.delete(operation); return true; }
  cancelNext(operation: string): void { this.#cancellations.add(operation); }
  take(operation: string): void { const error = this.#errors.get(operation); if (error) { this.#errors.delete(operation); throw error; } }
  async before(operation: string, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted || this.#cancellations.delete(operation)) throw new Error('CANCELLED');
    const delayMs = this.#timeouts.get(operation);
    if (delayMs !== undefined) { this.#timeouts.delete(operation); await new Promise<void>((resolve) => setTimeout(resolve, delayMs)); throw new Error('TIMEOUT'); }
    if (this.#responseLoss.delete(operation)) throw new Error('RESPONSE_LOST');
    this.take(operation);
  }
}
const key = (identity: Pick<RuntimeIdentity, 'tenantId' | 'invocationId'>): string => `${identity.tenantId}\0${identity.invocationId}`;
const add = (left: Readonly<Record<string, number>>, right: Readonly<Record<string, number>>): Record<string, number> => Object.fromEntries([...new Set([...Object.keys(left), ...Object.keys(right)])].map((name: string) => [name, (left[name] ?? 0) + (right[name] ?? 0)]));
const subtract = (left: Readonly<Record<string, number>>, right: Readonly<Record<string, number>>): Record<string, number> => Object.fromEntries(Object.keys(left).map((name) => [name, (left[name] ?? 0) - (right[name] ?? 0)]));
const fits = (balance: Readonly<Record<string, number>>, upper: Readonly<Record<string, number>>): boolean => Object.entries(upper).every(([name, value]) => (balance[name] ?? 0) >= value);

export class InMemoryConsumptionLedger implements ConsumptionLedgerPort, FailureInjectable {
  readonly #failures = new Failures();
  readonly #balances = new Map<string, LedgerBalance>();
  readonly #accountTenants = new Map<string, string>();
  readonly #reservations = new Map<string, { reservation: UsageReservation; balance: LedgerBalance; tenantId: string }>();
  readonly #locks = new Map<string, Promise<void>>();
  readonly #commits = new Map<string, { digest: string; receipt: UsageReceipt; balance: LedgerBalance }>();
  readonly #audit: string[] = [];
  async #withLock<T>(lockKey: string, action: () => Promise<T>): Promise<T> {
    const previous = this.#locks.get(lockKey) ?? Promise.resolve();
    let unlock!: () => void;
    const current = new Promise<void>((resolve) => { unlock = resolve; });
    const queued = previous.then(() => current);
    this.#locks.set(lockKey, queued);
    await previous;
    try { return await action(); } finally { unlock(); if (this.#locks.get(lockKey) === queued) this.#locks.delete(lockKey); }
  }
  failNext(operation: string, error?: Error): void { this.#failures.failNext(operation, error); }
  timeoutNext(operation: string, delayMs = 0): void { this.#failures.timeoutNext(operation, delayMs); }
  loseResponseNext(operation: string): void { this.#failures.loseResponseNext(operation); }
  cancelNext(operation: string): void { this.#failures.cancelNext(operation); }
  seed(accountRef: string, tenantId: string, remaining: Readonly<Record<string, number>>): void { this.#accountTenants.set(accountRef, tenantId); this.#balances.set(`${tenantId}\0${accountRef}`, { account: { accountRef, tenantId }, remaining: { ...remaining }, revision: 1 }); }
  get audit(): readonly string[] { return this.#audit; }
  async getBalance(account: { readonly accountRef: string; readonly tenantId: string }): Promise<LedgerBalance> { await this.#failures.before('getBalance'); const owner = this.#accountTenants.get(account.accountRef); if (owner !== undefined && owner !== account.tenantId) throw new Error('LEDGER_TENANT_MISMATCH'); const value = this.#balances.get(`${account.tenantId}\0${account.accountRef}`); if (!value) throw new Error('LEDGER_ACCOUNT_NOT_FOUND'); return structuredClone(value); }
  async reserve(input: { readonly identity: RuntimeIdentity; readonly accountRef: string; readonly upperBound: Readonly<Record<string, number>>; readonly leaseMs: number }): Promise<LedgerReserveResult> { return this.#withLock(key(input.identity), () => this.#reserve(input)); }
  async #reserve(input: { readonly identity: RuntimeIdentity; readonly accountRef: string; readonly upperBound: Readonly<Record<string, number>>; readonly leaseMs: number }): Promise<LedgerReserveResult> {
    this.#failures.take('reserve');
    await this.#failures.before('reserve');
    const reservationKey = key(input.identity);
    const existing = this.#reservations.get(reservationKey);
    if (existing) {
      const sameAccount = existing.reservation.accountRef === input.accountRef;
      const sameBound = JSON.stringify(existing.reservation.upperBound) === JSON.stringify(input.upperBound);
      if (!sameAccount || !sameBound) return { status: 'rejected', code: 'LEDGER_RESERVATION_CONFLICT' };
      const balance = await this.getBalance({ accountRef: existing.reservation.accountRef, tenantId: input.identity.tenantId });
      return { status: 'existing', reservation: structuredClone(existing.reservation), balance };
    }
    const owner = this.#accountTenants.get(input.accountRef);
    if (owner !== undefined && owner !== input.identity.tenantId) return { status: 'rejected', code: 'LEDGER_TENANT_MISMATCH' };
    if (Object.values(input.upperBound).some((value) => !Number.isFinite(value) || value < 0) || input.leaseMs < 0) return { status: 'rejected', code: 'LEDGER_RESERVATION_CONFLICT' };
    let balance: LedgerBalance;
    try { balance = await this.getBalance({ accountRef: input.accountRef, tenantId: input.identity.tenantId }); } catch (error) { if (error instanceof Error && error.message === 'LEDGER_TENANT_MISMATCH') return { status: 'rejected', code: 'LEDGER_TENANT_MISMATCH' }; return { status: 'rejected', code: 'LEDGER_UNAVAILABLE' }; }
    if (!fits(balance.remaining, input.upperBound)) return { status: 'rejected', code: 'LEDGER_INSUFFICIENT' };
    const reservation: UsageReservation = { reservationRef: `usage-reservation://${input.identity.invocationId}`, invocationId: input.identity.invocationId, accountRef: input.accountRef, upperBound: { ...input.upperBound }, expiresAt: new Date(Date.now() + input.leaseMs).toISOString(), fence: sha256Digest({ tenantId: input.identity.tenantId, invocationId: input.identity.invocationId, upperBound: input.upperBound }) };
    const next: LedgerBalance = { ...balance, remaining: subtract(balance.remaining, input.upperBound), revision: balance.revision + 1 };
    this.#balances.set(`${input.identity.tenantId}\0${input.accountRef}`, next);
    this.#reservations.set(reservationKey, { reservation, balance: next, tenantId: input.identity.tenantId });
    this.#audit.push(`reserve:${reservation.reservationRef}`);
    return { status: 'reserved', reservation: structuredClone(reservation), balance: structuredClone(next) };
  }
  async commit(input: { readonly identity: RuntimeIdentity; readonly receipt: UsageReceipt }): Promise<LedgerCommitResult> { return this.#withLock(key(input.identity), () => this.#commit(input)); }
  async #commit(input: { readonly identity: RuntimeIdentity; readonly receipt: UsageReceipt }): Promise<LedgerCommitResult> {
    await this.#failures.before('commit');
    const existing = this.#commits.get(key(input.identity));
    if (existing) return existing.digest === input.receipt.receiptDigest ? { status: 'existing', receipt: structuredClone(existing.receipt), balance: structuredClone(existing.balance) } : { status: 'conflict', code: 'USAGE_CONFLICT' };
    const reservation = this.#reservations.get(key(input.identity));
    if (!reservation || reservation.tenantId !== input.identity.tenantId || reservation.reservation.reservationRef !== input.receipt.reservationRef || input.receipt.invocationId !== input.identity.invocationId || Date.parse(reservation.reservation.expiresAt) <= Date.now()) return { status: 'conflict', code: 'RESERVATION_FENCE_LOST' };
    const balance = await this.getBalance({ accountRef: reservation.reservation.accountRef, tenantId: input.identity.tenantId });
    const actual = input.receipt.actual;
    const actualValues = Object.values(actual);
    const actualCost = actual.cost ?? input.receipt.cost;
    if (input.receipt.cost < 0 || !Number.isFinite(input.receipt.cost) || actualValues.some((value) => !Number.isFinite(value) || value < 0) || !Number.isFinite(actualCost) || actualCost < 0 || (actual.cost !== undefined && actual.cost !== input.receipt.cost)) return { status: 'conflict', code: 'USAGE_CONFLICT' };
    const consumed = { ...actual, cost: actualCost };
    if (!fits(reservation.reservation.upperBound, consumed)) return { status: 'conflict', code: 'USAGE_CONFLICT' };
    const refund = subtract(reservation.reservation.upperBound, consumed);
    const next: LedgerBalance = { ...balance, remaining: add(balance.remaining, refund), revision: balance.revision + 1 };
    this.#balances.set(`${input.identity.tenantId}\0${reservation.reservation.accountRef}`, next);
    this.#commits.set(key(input.identity), { digest: input.receipt.receiptDigest, receipt: structuredClone(input.receipt), balance: next });
    this.#reservations.delete(key(input.identity));
    this.#audit.push(`commit:${input.receipt.receiptRef}`);
    return { status: 'committed', receipt: structuredClone(input.receipt), balance: structuredClone(next) };
  }
  async release(input: { readonly identity: RuntimeIdentity; readonly reservation: UsageReservation; readonly reason: string }): Promise<{ readonly status: 'released' | 'existing' | 'unknown'; readonly balance?: LedgerBalance }> { return this.#withLock(key(input.identity), () => this.#release(input)); }
  async #release(input: { readonly identity: RuntimeIdentity; readonly reservation: UsageReservation; readonly reason: string }): Promise<{ readonly status: 'released' | 'existing' | 'unknown'; readonly balance?: LedgerBalance }> {
    await this.#failures.before('release');
    const existing = this.#reservations.get(key(input.identity));
    if (!existing) return { status: 'existing' };
    if (existing.tenantId !== input.identity.tenantId || existing.reservation.invocationId !== input.identity.invocationId || existing.reservation.fence !== input.reservation.fence) return { status: 'unknown' };
    const balance = await this.getBalance({ accountRef: existing.reservation.accountRef, tenantId: existing.tenantId });
    const next: LedgerBalance = { ...balance, remaining: add(balance.remaining, existing.reservation.upperBound), revision: balance.revision + 1 };
    this.#balances.set(`${existing.tenantId}\0${existing.reservation.accountRef}`, next);
    this.#reservations.delete(key(input.identity));
    this.#audit.push(`release:${existing.reservation.reservationRef}:${input.reason}`);
    return { status: 'released', balance: structuredClone(next) };
  }
  async reconcile(input: { readonly now: string; readonly limit: number }): Promise<readonly UsageReservation[]> { await this.#failures.before('reconcile'); if (input.limit <= 0) return []; const now = Date.parse(input.now); const expired = [...this.#reservations.values()].filter(({ reservation }) => Date.parse(reservation.expiresAt) <= now).slice(0, input.limit); for (const value of expired) await this.release({ identity: { principalRef: 'reconciler', tenantId: value.tenantId, taskId: 'reconcile', runId: 'reconcile', attemptId: 'reconcile', invocationId: value.reservation.invocationId, specDigest: 'sha256:' + '0'.repeat(64) }, reservation: value.reservation, reason: 'lease_expired' }); return expired.map(({ reservation }) => structuredClone(reservation)); }
  async health(): Promise<AdapterHealth> { this.#failures.take('health'); return health(); }
}

export class DeterministicModelBroker implements ModelBrokerPort, FailureInjectable {
  readonly #failures = new Failures();
  readonly calls: ModelBrokerRequest[] = [];
  failNext(operation: string, error?: Error): void { this.#failures.failNext(operation, error); }
  timeoutNext(operation: string, delayMs = 0): void { this.#failures.timeoutNext(operation, delayMs); }
  loseResponseNext(operation: string): void { this.#failures.loseResponseNext(operation); }
  cancelNext(operation: string): void { this.#failures.cancelNext(operation); }
  async invoke(request: ModelBrokerRequest): Promise<ModelBrokerObservation> { await this.#failures.before('invoke', request.signal); this.calls.push(structuredClone(request)); const receipt: UsageReceipt = { receiptRef: `usage-receipt://${request.identity.invocationId}`, receiptDigest: sha256Digest({ invocationId: request.identity.invocationId, modelRouteRef: request.modelRouteRef, input: request.input }), invocationId: request.identity.invocationId, reservationRef: `usage-reservation://${request.identity.invocationId}`, actual: { tokens: 1, cost: 1 }, cost: 1, modelRef: request.modelRouteRef, providerRequestRef: `provider-request://${request.identity.invocationId}`, nonExactReason: 'deterministic-fake' }; return { observationRef: `observation://model/${request.identity.invocationId}`, output: { text: `model:${request.modelRouteRef}` }, usageReceipt: receipt }; }
  async health(): Promise<AdapterHealth> { this.#failures.take('health'); return health(); }
}

export class DeterministicContextResolver implements ContextResolverPort, FailureInjectable {
  readonly #failures = new Failures();
  constructor(private readonly sources: readonly { ref: string; revision: string; content: Record<string, string | number | boolean>; tenantId: string }[] = []) {}
  failNext(operation: string, error?: Error): void { this.#failures.failNext(operation, error); }
  timeoutNext(operation: string, delayMs = 0): void { this.#failures.timeoutNext(operation, delayMs); }
  loseResponseNext(operation: string): void { this.#failures.loseResponseNext(operation); }
  cancelNext(operation: string): void { this.#failures.cancelNext(operation); }
  async resolve(request: ContextResolverRequest): Promise<ContextResolverObservation> { this.#failures.take('resolve'); const selected = this.sources.filter((source) => source.tenantId === request.identity.tenantId && request.allowedSourceRefs.includes(source.ref)); const values = Object.fromEntries(selected.flatMap((source) => Object.entries(source.content)).slice(0, request.maxTokens)); return { view: values, receipt: { receiptRef: `context-receipt://${request.identity.invocationId}`, sourceRefs: selected.map((source) => source.ref), revisions: selected.map((source) => source.revision), truncated: selected.length > request.maxTokens, degraded: false } }; }
  async health(): Promise<AdapterHealth> { this.#failures.take('health'); return health(); }
}

export class DeterministicCapabilityBroker implements CapabilityBrokerPort, FailureInjectable {
  readonly #failures = new Failures();
  readonly #descriptors: CapabilityDescriptor[];
  readonly calls: CapabilityRequest[] = [];
  constructor(descriptors: readonly CapabilityDescriptor[] = []) { this.#descriptors = [...descriptors]; }
  failNext(operation: string, error?: Error): void { this.#failures.failNext(operation, error); }
  timeoutNext(operation: string, delayMs = 0): void { this.#failures.timeoutNext(operation, delayMs); }
  loseResponseNext(operation: string): void { this.#failures.loseResponseNext(operation); }
  cancelNext(operation: string): void { this.#failures.cancelNext(operation); }
  async describe(input: { readonly identity: RuntimeIdentity; readonly capabilityGrantRef: string }): Promise<readonly CapabilityDescriptor[]> { this.#failures.take('describe'); void input; return this.#descriptors.map((descriptor) => ({ ...descriptor })); }
  async invoke(request: CapabilityRequest): Promise<CapabilityObservation> { await this.#failures.before('invoke', request.signal); this.calls.push(structuredClone(request)); const descriptor = this.#descriptors.find((item) => item.toolRef === request.toolRef && item.providerRef === request.providerRef && item.schemaVersion === request.schemaVersion); if (!descriptor) return { status: 'denied', code: 'CAPABILITY_NOT_GRANTED' }; if (descriptor.access === 'write' && !request.approvalDigest) return { status: 'denied', code: 'APPROVAL_REQUIRED' }; return { status: 'committed', observationRef: `observation://tool/${request.actionId}`, effectReceiptRef: `effect-receipt://${request.actionId}`, output: { status: 'ok' }, normalizedResult: { status: 'succeeded', output: { status: 'ok' }, effectReceiptRef: `effect-receipt://${request.actionId}` } }; }
  async health(): Promise<AdapterHealth> { this.#failures.take('health'); return health(); }
}

export class InMemoryArtifactFinalizeStore implements ArtifactFinalizePort, FailureInjectable {
  readonly #failures = new Failures();
  readonly #staged = new Map<string, ArtifactFinalizeRequest>();
  readonly #finalized = new Map<string, { request: ArtifactFinalizeRequest; artifact: FinalizedArtifact }>();
  readonly #unavailable = new Set<string>();
  failNext(operation: string, error?: Error): void { this.#failures.failNext(operation, error); }
  timeoutNext(operation: string, delayMs = 0): void { this.#failures.timeoutNext(operation, delayMs); }
  loseResponseNext(operation: string): void { this.#failures.loseResponseNext(operation); }
  loseResponseAfter(operation: string): void { this.#failures.loseResponseAfter(operation); }
  cancelNext(operation: string): void { this.#failures.cancelNext(operation); }
  injectBodyLoss(input: { readonly tenantId: string; readonly operationId: string }): void {
    const key = `${input.tenantId}\0${input.operationId}`;
    const found = this.#finalized.get(key);
    if (found) found.request = { ...found.request, bytes: new Uint8Array() };
  }
  async stage(request: ArtifactFinalizeRequest): Promise<{ status: 'staged'; operationId: string } | { status: 'existing'; artifact: FinalizedArtifact }> {
    await this.#failures.before('stage');
    validateArtifactRequest(request);
    const key = `${request.identity.tenantId}\0${request.operationId}`;
    const existing = this.#finalized.get(key);
    if (existing) {
      if (existing.artifact.digest !== request.digest || existing.artifact.sizeBytes !== request.bytes.byteLength) throw new Error('ARTIFACT_OPERATION_CONFLICT');
      return { status: 'existing', artifact: structuredClone(existing.artifact) };
    }
    const staged = this.#staged.get(key);
    if (staged && (staged.digest !== request.digest || staged.bytes.byteLength !== request.bytes.byteLength)) throw new Error('ARTIFACT_OPERATION_CONFLICT');
    this.#staged.set(key, { ...request, bytes: request.bytes.slice(), lineageRefs: [...request.lineageRefs] });
    return { status: 'staged', operationId: request.operationId };
  }
  async finalize(input: { readonly identity: RuntimeIdentity; readonly operationId: string }): Promise<{ status: 'finalized' | 'existing'; artifact: FinalizedArtifact } | { status: 'unavailable' | 'conflict'; code: string }> {
    await this.#failures.before('finalize');
    const key = `${input.identity.tenantId}\0${input.operationId}`;
    const existing = this.#finalized.get(key);
    if (existing) return { status: 'existing', artifact: structuredClone(existing.artifact) };
    const request = this.#staged.get(key);
    if (!request) return { status: 'conflict', code: 'ARTIFACT_NOT_STAGED' };
    try { validateArtifactRequest(request); } catch (error) { return { status: 'conflict', code: error instanceof Error ? error.message : 'ARTIFACT_INVALID' }; }
    const artifact: FinalizedArtifact = {
      artifactRef: `artifact://finalized/${sha256Digest({ tenantId: input.identity.tenantId, operationId: input.operationId }).slice(7)}`,
      digest: request.digest,
      sizeBytes: request.bytes.byteLength,
      operationId: request.operationId
    };
    this.#finalized.set(key, { request, artifact });
    this.#staged.delete(key);
    if (this.#failures.takeResponseLossAfter('finalize')) throw new Error('RESPONSE_LOST');
    return { status: 'finalized', artifact: structuredClone(artifact) };
  }
  async get(input: { readonly identity: RuntimeIdentity; readonly artifactRef: string }): Promise<Uint8Array | undefined> {
    await this.#failures.before('get');
    const found = [...this.#finalized.entries()].find(([key, item]) => key.startsWith(`${input.identity.tenantId}\0`) && item.artifact.artifactRef === input.artifactRef);
    if (found === undefined || this.#unavailable.has(found[0])) return undefined;
    const bytes = found[1].request.bytes.slice();
    if (sha256Bytes(bytes) !== found[1].artifact.digest || bytes.byteLength !== found[1].artifact.sizeBytes) return undefined;
    return bytes;
  }
  async reconcile(input: { readonly now: string; readonly limit: number }): Promise<readonly string[]> {
    await this.#failures.before('reconcile');
    void input.now;
    if (input.limit <= 0) return [];
    const affected: string[] = [];
    for (const [key, request] of this.#staged) {
      if (affected.length >= input.limit) break;
      this.#staged.delete(key);
      affected.push(request.operationId);
    }
    for (const [key, found] of this.#finalized) {
      if (affected.length >= input.limit) break;
      const bytes = found.request.bytes;
      if (sha256Bytes(bytes) !== found.artifact.digest || bytes.byteLength !== found.artifact.sizeBytes) {
        this.#unavailable.add(key);
        affected.push(found.artifact.artifactRef);
      }
    }
    return affected;
  }
  async health(): Promise<AdapterHealth> { this.#failures.take('health'); return health(); }
}
