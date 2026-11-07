import { describe, expect, it } from 'vitest';
import { InMemoryAgentEventStore } from '@sage/local-fakes';
import { appendLiveSliceRunLog, LiveSliceRunLogSession } from './slice-run-log.js';

describe('appendLiveSliceRunLog', () => {
  it('writes run.started → engine.started → model.completed → run.completed for a package slice', async () => {
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
    expect(listed.map((event) => event.type)).toEqual(['run.started', 'engine.started', 'model.completed', 'run.completed']);
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

describe('LiveSliceRunLogSession', () => {
  it('maps turn/tool harness events into durable model/tool completed rows', async () => {
    const events = new InMemoryAgentEventStore();
    const taskId = 'pkg-stream-1';
    const session = await LiveSliceRunLogSession.open({
      events,
      tenantId: 'tenant-local',
      taskId,
      attempt: 2,
      source: 'package'
    });
    expect(session).toBeDefined();
    await session!.observe({
      schemaVersion: '1', runId: 'x', sequence: 1, type: 'turn.completed', occurredAt: '2026-11-07T00:00:00.000Z',
      payload: { turn: 1, tokens: 42 }
    });
    await session!.observe({
      schemaVersion: '1', runId: 'x', sequence: 2, type: 'tool.completed', occurredAt: '2026-11-07T00:00:01.000Z',
      payload: { count: 1, total: 1 }
    });
    await session!.finish('succeeded');
    const listed = await events.listEvents({
      tenantId: 'tenant-local',
      taskId,
      runId: `run-${taskId}`,
      attemptId: `attempt-${taskId}-2`
    });
    expect(listed.map((event) => event.type)).toEqual([
      'run.started', 'engine.started', 'model.completed', 'tool.completed', 'run.completed'
    ]);
    expect(listed[2]?.payload).toEqual({ turn: 1, tokens: 42 });
  });
});
