import { describe, expect, it } from 'vitest';
import type { ScheduleSnapshot, ScheduleTriggerEvent } from '@sage/platform-ports';
import { InMemoryScheduleControlStore } from './schedule-store.js';

const definition = {
  schemaVersion: '1' as const,
  scheduleId: 'daily-brief',
  tenantId: 'tenant-a',
  trigger: { kind: 'interval', everyMs: 60_000 } as const,
  overlapPolicy: 'SKIP' as const,
  misfirePolicy: 'SKIP' as const,
  releaseBinding: { strategy: 'FIXED', releaseId: 'release-1', contentDigest: `sha256:${'a'.repeat(64)}` } as const,
  targetConstraints: { allowedEnvironments: ['local'] },
  budget: { limits: [{ dimension: 'runs' as const, limit: 100 }] },
  invocation: { task: 'daily', params: { window: 7 } }
};

const snapshot = (revision: number, state: ScheduleSnapshot['state']): ScheduleSnapshot => ({
  schemaVersion: '1', definition, revision, state,
  contentDigest: `sha256:${'b'.repeat(64)}`, createdAtMs: 1_000, updatedAtMs: 1_000 + revision
});

const event = (occurrenceId: string, kind: ScheduleTriggerEvent['kind']): ScheduleTriggerEvent => ({
  schemaVersion: '1', scheduleId: 'daily-brief', tenantId: 'tenant-a', occurrenceId, kind, occurredAtMs: 2_000,
  ...(kind === 'FAILED' ? { errorCode: 'SCHEDULE_DISPATCH_FAILED' } : {}), ...(kind === 'SUCCEEDED' ? { taskId: 'pkg-1' } : {})
});

describe('InMemoryScheduleControlStore', () => {
  it('is create-only for records and enforces optimistic revision replacement', async () => {
    const store = new InMemoryScheduleControlStore();
    expect(await store.putRecord(snapshot(1, 'ACTIVE'))).toBe('stored');
    expect(await store.putRecord(snapshot(1, 'PAUSED'))).toBe('existing');
    await expect(store.replaceRecord(snapshot(3, 'ACTIVE'))).rejects.toThrow('SCHEDULE_REVISION_CONFLICT');
    await store.replaceRecord(snapshot(2, 'PAUSED'));
    expect((await store.getRecord({ tenantId: 'tenant-a', scheduleId: 'daily-brief' }))?.state).toBe('PAUSED');
  });

  it('deduplicates trigger events per occurrence+kind and lists newest first', async () => {
    const store = new InMemoryScheduleControlStore();
    expect(await store.appendTriggerEvent(event('occ-1', 'SUCCEEDED'))).toBe('stored');
    expect(await store.appendTriggerEvent(event('occ-1', 'SUCCEEDED'))).toBe('existing');
    expect(await store.appendTriggerEvent(event('occ-1', 'FAILED'))).toBe('stored');
    expect(await store.appendTriggerEvent(event('occ-2', 'SUCCEEDED'))).toBe('stored');
    const events = await store.listTriggerEvents({ tenantId: 'tenant-a', scheduleId: 'daily-brief' }, { limit: 200 });
    expect(events.map(item => item.occurrenceId)).toEqual(['occ-2', 'occ-1', 'occ-1']);
    expect(await store.listTriggerEvents({ tenantId: 'tenant-a', scheduleId: 'daily-brief' }, { limit: 1 })).toHaveLength(1);
  });

  it('filters record listing by state and isolates tenants', async () => {
    const store = new InMemoryScheduleControlStore();
    await store.putRecord(snapshot(1, 'ACTIVE'));
    expect(await store.listRecords('tenant-a')).toHaveLength(1);
    expect(await store.listRecords('tenant-b')).toHaveLength(0);
    expect(await store.listRecords('tenant-a', { state: 'DELETED' })).toHaveLength(0);
  });
});
