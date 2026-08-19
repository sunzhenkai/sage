import { describe, expect, it } from 'vitest';
import { failureNextSyncAt, successNextSyncAt } from './manager.js';

describe('Catalog sync schedule', () => {
  it('uses stable source-derived ±15 minute daily jitter', () => {
    const checked = new Date('2026-08-14T00:00:00.000Z');
    const first = successNextSyncAt(checked);
    expect(successNextSyncAt(checked)).toBe(first);
    const minutes = (Date.parse(first) - checked.getTime()) / 60_000;
    expect(minutes).toBeGreaterThanOrEqual(24 * 60 - 15);
    expect(minutes).toBeLessThanOrEqual(24 * 60 + 15);
  });

  it('uses 5m→30m→2h→6h capped retry chain', () => {
    const checked = new Date('2026-08-14T00:00:00.000Z');
    expect([0, 1, 2, 3, 4, 99].map((count) => (Date.parse(failureNextSyncAt(checked, count)) - checked.getTime()) / 60_000)).toEqual([5, 30, 120, 360, 360, 360]);
  });
});
