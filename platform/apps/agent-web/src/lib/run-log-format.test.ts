import { describe, expect, it } from 'vitest';
import type { RunLogEvent } from './types';
import { eventTone, extractDetailSections, formatDurationMs, formatEventTime, summarizeRunLogEvent } from './run-log-format';

const makeEvent = (type: string, payload: Record<string, unknown>, sequence = 1): RunLogEvent => ({
  eventId: `ev-${sequence}`,
  runId: 'run-1',
  attemptId: 'attempt-1',
  sequence,
  type,
  payload
});

describe('run-log-format', () => {
  it('formats durations cleanly across ms, s, and m', () => {
    expect(formatDurationMs(42)).toBe('42ms');
    expect(formatDurationMs(1_540)).toBe('1.5s');
    expect(formatDurationMs(125_000)).toBe('2m 5s');
  });

  it('computes clock and elapsed time from payload.at', () => {
    const base = Date.parse('2026-11-24T10:00:00.000Z');
    const time = formatEventTime({ at: '2026-11-24T10:00:02.500Z' }, base);
    expect(time.clock).toMatch(/^\d{2}:\d{2}:02$/);
    expect(time.elapsed).toBe('+2.5s');
  });

  it('derives semantic tones for ok, failed, and model events', () => {
    expect(eventTone(makeEvent('run.failed', { status: 'failed' }))).toBe('error');
    expect(eventTone(makeEvent('tool.completed', { toolName: 'http_probe', ok: false }))).toBe('error');
    expect(eventTone(makeEvent('tool.completed', { toolName: 'http_probe', ok: true }))).toBe('success');
    expect(eventTone(makeEvent('run.completed', { status: 'succeeded' }))).toBe('success');
    expect(eventTone(makeEvent('model.completed', { turn: 1, ok: true }))).toBe('active');
    expect(eventTone(makeEvent('run.started', { source: 'package' }))).toBe('neutral');
  });

  it('summarizes detailed and legacy run log events concisely', () => {
    expect(summarizeRunLogEvent(makeEvent('engine.started', {
      modelId: 'glm-5.3-flash', toolsEnabled: true, capabilities: 'http_probe, tls_probe', maxTurns: 8, timeoutMs: 120_000
    }))).toBe('glm-5.3-flash · tools: http_probe, tls_probe · maxTurns=8 · timeout=2m 0s');

    expect(summarizeRunLogEvent(makeEvent('model.completed', {
      turn: 1, modelId: 'glm-5.3-flash', ok: true, toolCallCount: 2, toolNames: 'http_probe, tls_probe', tokens: 320
    }))).toBe('turn 1 · glm-5.3-flash · → 2 tool(s): http_probe, tls_probe · 320 tok');

    expect(summarizeRunLogEvent(makeEvent('tool.completed', {
      turn: 1, index: 2, totalInTurn: 2, toolName: 'tls_probe', ok: false, errorCode: 'TLS_TIMEOUT'
    }))).toBe('T1 [2/2] · tls_probe · error (TLS_TIMEOUT)');

    expect(summarizeRunLogEvent(makeEvent('run.failed', {
      errorCode: 'ACTIVITY_RETRYABLE_ERROR', retryable: true, message: 'upstream 502'
    }))).toBe('ACTIVITY_RETRYABLE_ERROR · retryable · upstream 502');
  });

  it('extracts pretty-printed detail sections for args, resultPreview, and errors', () => {
    const sections = extractDetailSections(makeEvent('tool.completed', {
      toolName: 'http_probe',
      ok: false,
      error: 'timeout',
      args: '{"url":"https://example.com"}',
      resultPreview: '{"ok":false,"errorCode":"TIMEOUT"}'
    }));
    expect(sections.map((s) => s.key)).toEqual(['error', 'args', 'result']);
    expect(sections[1]?.text).toContain('\n  "url": "https://example.com"');
    expect(sections[2]?.text).toContain('\n  "errorCode": "TIMEOUT"');
  });
});
