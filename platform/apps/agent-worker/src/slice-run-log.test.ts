import { describe, expect, it } from 'vitest';
import { InMemoryAgentEventStore } from '@sage/local-fakes';
import { appendLiveSliceRunLog } from './slice-run-log.js';

describe('appendLiveSliceRunLog', () => {
  it('writes run.started → engine.started → run.completed for a package slice', async () => {
    const events = new InMemoryAgentEventStore();
    const taskId = 'pkg-demo-1';
    expect(await appendLiveSliceRunLog({
      events,
      tenantId: 'tenant-local',
      taskId,
      outcome: 'succeeded',
      source: 'package'
    })).toBe('written');
    const listed = await events.listEvents({
      tenantId: 'tenant-local',
      taskId,
      runId: `run-${taskId}`,
      attemptId: `attempt-${taskId}-1`
    });
    expect(listed.map((event) => event.type)).toEqual(['run.started', 'engine.started', 'run.completed']);
    expect(listed[0]?.payload).toEqual({ source: 'package' });
  });

  it('writes run.failed when outcome is failed', async () => {
    const events = new InMemoryAgentEventStore();
    const taskId = 'pkg-demo-fail';
    await appendLiveSliceRunLog({
      events,
      tenantId: 'tenant-local',
      taskId,
      outcome: 'failed',
      source: 'package'
    });
    const listed = await events.listEvents({
      tenantId: 'tenant-local',
      taskId,
      runId: `run-${taskId}`,
      attemptId: `attempt-${taskId}-1`
    });
    expect(listed.at(-1)?.type).toBe('run.failed');
  });
});
