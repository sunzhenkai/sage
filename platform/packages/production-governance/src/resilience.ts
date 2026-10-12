export interface TenantCapacity { readonly tenantId: string; readonly weight: number; readonly concurrency: number; readonly queueLimit: number }
interface Queued<T> { readonly tenantId: string; readonly value: T; readonly sequence: number }
export class WeightedFairQueue<T> {
  readonly #queues = new Map<string, Queued<T>[]>(); readonly #active = new Map<string, number>(); readonly #served = new Map<string, number>(); #sequence = 0;
  constructor(private readonly capacities: readonly TenantCapacity[], private readonly globalConcurrency: number) { if (globalConcurrency < 1 || capacities.some((item) => item.weight <= 0 || item.concurrency < 1 || item.queueLimit < 1)) throw new Error('FAIRNESS_CONFIG_INVALID'); }
  enqueue(tenantId: string, value: T): void { const capacity = this.capacities.find((item) => item.tenantId === tenantId); if (!capacity) throw new Error('TENANT_CAPACITY_UNAPPROVED'); const queue = this.#queues.get(tenantId) ?? []; if (queue.length >= capacity.queueLimit) throw new Error('TENANT_BACKPRESSURE'); queue.push({ tenantId, value, sequence: ++this.#sequence }); this.#queues.set(tenantId, queue); }
  take(): { readonly tenantId: string; readonly value: T; readonly release: () => void } | undefined {
    const totalActive = [...this.#active.values()].reduce((sum, value) => sum + value, 0); if (totalActive >= this.globalConcurrency) return undefined;
    const eligible = this.capacities
      .filter((capacity) => (this.#queues.get(capacity.tenantId)?.length ?? 0) > 0 && (this.#active.get(capacity.tenantId) ?? 0) < capacity.concurrency)
      .sort((a, b) => {
        const normalizedDifference = ((this.#served.get(a.tenantId) ?? 0) / a.weight) - ((this.#served.get(b.tenantId) ?? 0) / b.weight);
        return normalizedDifference !== 0 ? normalizedDifference : (this.#queues.get(a.tenantId)?.[0]?.sequence ?? 0) - (this.#queues.get(b.tenantId)?.[0]?.sequence ?? 0);
      });
    const selected = eligible[0]; if (!selected) return undefined; const item = this.#queues.get(selected.tenantId)!.shift()!; this.#active.set(selected.tenantId, (this.#active.get(selected.tenantId) ?? 0) + 1); this.#served.set(selected.tenantId, (this.#served.get(selected.tenantId) ?? 0) + 1);
    let released = false; return { tenantId: selected.tenantId, value: item.value, release: () => { if (!released) { released = true; this.#active.set(selected.tenantId, Math.max(0, (this.#active.get(selected.tenantId) ?? 1) - 1)); } } };
  }
  snapshot(): Readonly<Record<string, { queued: number; active: number }>> { return Object.fromEntries(this.capacities.map((item) => [item.tenantId, { queued: this.#queues.get(item.tenantId)?.length ?? 0, active: this.#active.get(item.tenantId) ?? 0 }])); }
}

export class CircuitBreaker { #failures = 0; #openUntil = 0; constructor(private readonly threshold: number, private readonly cooldownMs: number, private readonly now: () => number = Date.now) {} allow(): boolean { return this.now() >= this.#openUntil; } success(): void { this.#failures = 0; this.#openUntil = 0; } failure(): void { this.#failures += 1; if (this.#failures >= this.threshold) this.#openUntil = this.now() + this.cooldownMs; } }
export class RetryBudget { #remaining: number; constructor(maxRetries: number) { this.#remaining = maxRetries; } consume(input: { readonly effectState?: string }): boolean { if (input.effectState === 'EFFECT_UNKNOWN' || this.#remaining <= 0) return false; this.#remaining -= 1; return true; } get remaining(): number { return this.#remaining; } }
export const boundedBackoffMs = (attempt: number, input: { readonly baseMs: number; readonly maxMs: number; readonly jitter: number }, random: () => number = Math.random): number => Math.min(input.maxMs, input.baseMs * 2 ** Math.max(0, attempt - 1)) * (1 - input.jitter + random() * input.jitter * 2);

export const CANARY_STAGES = ['identity_secret', 'consumption', 'artifact_checkpoint', 'effect', 'sandbox_egress', 'supply_chain'] as const;
export type CanaryStage = typeof CANARY_STAGES[number];
export interface CanaryState { readonly current?: CanaryStage; readonly completed: readonly CanaryStage[]; readonly stopped: boolean; readonly productionEvidenceRefs: readonly string[] }
export interface EvaluatedCanaryReadiness { readonly decision: 'GO' | 'NO_GO'; readonly recordRef?: string; readonly recordDigest?: string; readonly validUntil?: string }
export interface CanaryEvidence { readonly evidenceRef: string; readonly evidenceDigest: string; readonly environmentRef: 'production'; readonly outcome: 'PASS' | 'FAIL'; readonly productionEquivalent: boolean; readonly evaluatedAt: string; readonly validUntil: string }
export function advanceCanary(state: CanaryState, input: { readonly stage: CanaryStage; readonly readiness?: EvaluatedCanaryReadiness; readonly evidence?: readonly CanaryEvidence[]; readonly now?: string }): CanaryState {
  if (state.stopped) throw new Error('CANARY_STOPPED'); const expected = CANARY_STAGES[state.completed.length]; if (input.stage !== expected) throw new Error('CANARY_STAGE_ORDER_INVALID');
  const now = Date.parse(input.now ?? new Date().toISOString());
  const readinessValid = input.readiness?.decision === 'GO' && typeof input.readiness.recordRef === 'string' && /^sha256:[a-f0-9]{64}$/.test(input.readiness.recordDigest ?? '') && Number.isFinite(Date.parse(input.readiness.validUntil ?? '')) && Date.parse(input.readiness.validUntil!) > now;
  const evidence = input.evidence ?? [];
  const evidenceValid = evidence.length > 0 && evidence.every(item => item.environmentRef === 'production' && item.outcome === 'PASS' && item.productionEquivalent && /^sha256:[a-f0-9]{64}$/.test(item.evidenceDigest) && Number.isFinite(Date.parse(item.evaluatedAt)) && Date.parse(item.evaluatedAt) <= now && Number.isFinite(Date.parse(item.validUntil)) && Date.parse(item.validUntil) > now);
  if (!readinessValid || !evidenceValid) return Object.freeze({ ...state, current: input.stage, stopped: true });
  const next = CANARY_STAGES[state.completed.length + 1];
  return Object.freeze({ ...(next === undefined ? {} : { current: next }), completed: Object.freeze([...state.completed, input.stage]), stopped: false, productionEvidenceRefs: Object.freeze([...state.productionEvidenceRefs, input.readiness!.recordRef!, ...evidence.map(item => item.evidenceRef)]) });
}


interface ScheduledWork<T, R> {
  readonly value: T;
  readonly run: (value: T) => Promise<R>;
  readonly resolve: (value: R) => void;
  readonly reject: (cause: unknown) => void;
}

/**
 * Production composition primitive: every accepted item is bounded by the underlying
 * tenant queue and global/tenant concurrency caps. beginDrain atomically rejects new
 * work; drain resolves only after queued and active work reaches zero.
 */
export class BoundedProductionScheduler<T, R> {
  readonly #queue: WeightedFairQueue<ScheduledWork<T, R>>;
  readonly #drainWaiters = new Set<() => void>();
  #draining = false;
  #pumping = false;

  constructor(capacities: readonly TenantCapacity[], globalConcurrency: number) {
    this.#queue = new WeightedFairQueue(capacities, globalConcurrency);
  }

  submit(tenantId: string, value: T, run: (value: T) => Promise<R>): Promise<R> {
    if (this.#draining) return Promise.reject(new Error('PRODUCTION_DRAINING'));
    return new Promise<R>((resolve, reject) => {
      this.#queue.enqueue(tenantId, { value, run, resolve, reject });
      this.#pump();
    });
  }

  beginDrain(): void {
    this.#draining = true;
    this.#notifyDrained();
  }

  async drain(timeoutMs: number): Promise<void> {
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1) throw new Error('DRAIN_TIMEOUT_INVALID');
    this.beginDrain();
    if (this.#isDrained()) return;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { this.#drainWaiters.delete(done); reject(new Error('DRAIN_TIMEOUT')); }, timeoutMs);
      const done = (): void => { clearTimeout(timer); resolve(); };
      this.#drainWaiters.add(done);
    });
  }

  snapshot(): Readonly<{ draining: boolean; tenants: Readonly<Record<string, { queued: number; active: number }>> }> {
    return Object.freeze({ draining: this.#draining, tenants: this.#queue.snapshot() });
  }

  #pump(): void {
    if (this.#pumping) return;
    this.#pumping = true;
    try {
      for (let selected = this.#queue.take(); selected !== undefined; selected = this.#queue.take()) {
        const work = selected.value;
        void work.run(work.value).then(work.resolve, work.reject).finally(() => {
          selected.release();
          this.#pumping = false;
          this.#pump();
          this.#notifyDrained();
        });
      }
    } finally {
      this.#pumping = false;
      this.#notifyDrained();
    }
  }

  #isDrained(): boolean {
    return Object.values(this.#queue.snapshot()).every(({ queued, active }) => queued === 0 && active === 0);
  }

  #notifyDrained(): void {
    if (!this.#draining || !this.#isDrained()) return;
    for (const resolve of this.#drainWaiters) resolve();
    this.#drainWaiters.clear();
  }
}
