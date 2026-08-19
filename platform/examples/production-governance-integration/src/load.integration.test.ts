import { describe, expect, it } from 'vitest';
import { CircuitBreaker, RetryBudget, WeightedFairQueue } from '@sage/production-governance';

describe('Phase 4 capacity/fairness/backpressure load (local engineering only)', () => {
  it('preserves a quiet tenant share under 1000 noisy items', () => {
    const queue = new WeightedFairQueue([{ tenantId: 'noisy', weight: 9, concurrency: 9, queueLimit: 1000 }, { tenantId: 'quiet', weight: 1, concurrency: 1, queueLimit: 10 }], 10);
    for (let index = 0; index < 1000; index += 1) queue.enqueue('noisy', index);
    queue.enqueue('quiet', 'important');
    const taken = Array.from({ length: 10 }, () => queue.take()!);
    expect(taken.every(Boolean)).toBe(true);
    expect(taken.some(item => item.tenantId === 'quiet')).toBe(true);
    expect(queue.snapshot()).toEqual({ noisy: { queued: 991, active: 9 }, quiet: { queued: 0, active: 1 } });
    taken.forEach(item => item.release());
  });

  it('bounds per-tenant queues and global/tenant concurrency under saturation', () => {
    const queue = new WeightedFairQueue([{ tenantId: 'a', weight: 1, concurrency: 2, queueLimit: 3 }, { tenantId: 'b', weight: 1, concurrency: 2, queueLimit: 3 }], 3);
    for (let index = 0; index < 3; index += 1) queue.enqueue('a', index);
    expect(() => queue.enqueue('a', 4)).toThrow('TENANT_BACKPRESSURE');
    for (let index = 0; index < 3; index += 1) queue.enqueue('b', index);
    const active = [queue.take()!, queue.take()!, queue.take()!];
    expect(active).toHaveLength(3);
    expect(queue.take()).toBeUndefined();
    expect(Math.max(...Object.values(queue.snapshot()).map(value => value.active))).toBeLessThanOrEqual(2);
    active.forEach(item => item.release());
  });

  it('caps retry storms, never retries unknown Effects, and opens on dependency outage', () => {
    const budget = new RetryBudget(25);
    const admitted = Array.from({ length: 10_000 }, () => budget.consume({})).filter(Boolean).length;
    expect(admitted).toBe(25);
    expect(budget.remaining).toBe(0);
    expect(new RetryBudget(25).consume({ effectState: 'EFFECT_UNKNOWN' })).toBe(false);
    let now = 0;
    const breaker = new CircuitBreaker(5, 1_000, () => now);
    for (let index = 0; index < 10_000; index += 1) breaker.failure();
    expect(breaker.allow()).toBe(false);
    now = 1_000;
    expect(breaker.allow()).toBe(true);
  });
});
