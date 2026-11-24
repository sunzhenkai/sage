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

  it('isolates Temporal delivery retries by deliveryAttempt and persists detailed progress + redaction', async () => {
    const events = new InMemoryAgentEventStore();
    const taskId = 'pkg-retry-1';
    const d1 = await LiveSliceRunLogSession.open({
      events,
      tenantId: 'tenant-local',
      taskId,
      attempt: 1,
      deliveryAttempt: 1,
      source: 'package',
      metadata: { modelId: 'glm-5.3-flash', adapterKind: 'openai-compatible', toolsEnabled: true, toolCount: 3 }
    });
    expect(d1?.attemptId).toBe(`attempt-${taskId}-1`);
    await d1!.recordProgress({
      kind: 'model.failed',
      turn: 1,
      modelId: 'glm-5.3-flash',
      adapterKind: 'openai-compatible',
      durationMs: 120,
      errorMessage: 'Bearer secret-abc-123 failed'
    });
    await d1!.finish('failed', {
      errorCode: 'ACTIVITY_RETRYABLE_ERROR',
      message: 'Bearer secret-abc-123 failed',
      retryable: true,
      deliveryAttempt: 1
    });

    const d2 = await LiveSliceRunLogSession.open({
      events,
      tenantId: 'tenant-local',
      taskId,
      attempt: 1,
      deliveryAttempt: 2,
      source: 'package',
      metadata: { modelId: 'glm-5.3-flash', adapterKind: 'openai-compatible', toolsEnabled: true, toolCount: 3 }
    });
    expect(d2?.attemptId).toBe(`attempt-${taskId}-1-d2`);
    await d2!.recordContextResolved({ inputBytes: 512, modelId: 'glm-5.3-flash', toolsEnabled: true, toolCount: 3 });
    await d2!.recordProgress({
      kind: 'model.completed',
      turn: 1,
      modelId: 'glm-5.3-flash',
      adapterKind: 'openai-compatible',
      tokens: 45,
      durationMs: 300,
      toolCallCount: 1,
      toolNames: ['http_probe'],
      stopReason: 'toolUse'
    });
    await d2!.recordProgress({
      kind: 'tool.completed',
      turn: 1,
      index: 1,
      totalInTurn: 1,
      toolCallId: 'call-1',
      toolName: 'http_probe',
      arguments: { url: 'https://example.com', apiKey: 'must-redact' },
      ok: true,
      durationMs: 85,
      resultContent: '{"ok":true,"statusCode":200}'
    });
    // Coarse observe should be deduplicated once detailed progress is recorded.
    await d2!.observe({
      schemaVersion: '1', runId: 'x', sequence: 1, type: 'tool.completed', occurredAt: '2026-11-24T00:00:00.000Z',
      payload: { count: 1, total: 1 }
    });
    await d2!.observe({
      schemaVersion: '1', runId: 'x', sequence: 2, type: 'turn.completed', occurredAt: '2026-11-24T00:00:00.000Z',
      payload: { turn: 1, tokens: 45 }
    });
    await d2!.finish('succeeded', { turns: 1, toolCalls: 1, tokens: 45, durationMs: 400, files: 'report.json' });

    const d1Events = await events.listEvents({
      tenantId: 'tenant-local', taskId, runId: `run-${taskId}`, attemptId: `attempt-${taskId}-1`
    });
    expect(d1Events.map((e) => e.type)).toEqual(['run.started', 'engine.started', 'model.completed', 'run.failed']);
    expect(d1Events[2]?.payload).toMatchObject({ ok: false, error: 'Bearer [REDACTED] failed' });
    expect(d1Events[3]?.payload).toMatchObject({
      status: 'failed', errorCode: 'ACTIVITY_RETRYABLE_ERROR', message: 'Bearer [REDACTED] failed', retryable: true, deliveryAttempt: 1
    });

    const d2Events = await events.listEvents({
      tenantId: 'tenant-local', taskId, runId: `run-${taskId}`, attemptId: `attempt-${taskId}-1-d2`
    });
    expect(d2Events.map((e) => e.type)).toEqual([
      'run.started', 'engine.started', 'context.resolved', 'model.completed', 'tool.completed', 'run.completed'
    ]);
    expect(d2Events[4]?.payload).toMatchObject({
      turn: 1, index: 1, totalInTurn: 1, toolName: 'http_probe', ok: true, durationMs: 85
    });
    expect(String(d2Events[4]?.payload.args)).toContain('[REDACTED]');
    expect(String(d2Events[4]?.payload.args)).not.toContain('must-redact');
  });
});
