import { readdir, readFile } from 'node:fs/promises';
import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import type { Attributes, Meter, Span, SpanOptions, Tracer } from '@opentelemetry/api';
import { AgentObservability, assertNoSensitiveData, createOtlpTraceExporter, recordAgentPlatformCorrelation, recordDurableCoordinatorSignal, sanitizeTelemetry } from './index.js';

class CaptureStream extends Writable {
  readonly lines: string[] = [];
  override _write(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    this.lines.push(chunk.toString()); callback();
  }
}

const fakeSpan = { end() {}, setAttribute() { return this; } } as unknown as Span;

class CaptureTracer implements Tracer {
  options: SpanOptions | undefined;
  name: string | undefined;
  startSpan(name: string, options?: SpanOptions): Span { this.name = name; this.options = options; return fakeSpan; }
  startActiveSpan<F extends (span: Span) => unknown>(_name: string, ...args: unknown[]): ReturnType<F> {
    const callback = args.at(-1) as F; return callback(fakeSpan) as ReturnType<F>;
  }
}

describe('correlated sanitized observability', () => {
  it('puts all allowlisted correlation identifiers on Pino logs, OTel spans, and metrics', () => {
    const stream = new CaptureStream();
    const tracer = new CaptureTracer();
    const correlation = { run_id: 'run-1', task_id: 'task-1', workflow_id: 'wf-1', target_id: 'target-1', attempt: 2, tool_call_id: 'call-1' };
    const observability = new AgentObservability({ correlation, destination: stream, tracer });
    observability.log('tool completed', { result: 'ok' });
    observability.startSpan('tool.call', { phase: 'execute' }).end();
    const metric = observability.metric('tool.duration', 12, { unit: 'ms' });

    const logs = stream.lines.map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(logs[0]).toMatchObject(correlation);
    expect(tracer.options?.attributes).toMatchObject(correlation);
    expect(metric).toMatchObject(correlation);
    expect(logs[1]).toMatchObject({ telemetry_kind: 'metric', metric_name: 'tool.duration' });
  });

  it('filters Pino correlation, fields, and message plus OTel span/metric data', () => {
    const stream = new CaptureStream();
    const tracer = new CaptureTracer();
    const known = 'opaque-correlation-123';
    const observability = new AgentObservability({
      correlation: { run_id: known }, knownSecrets: [known, 'message-private'], destination: stream, tracer
    });
    observability.log('message-private', {
      password: 'hunter2', nested: { authorization: 'Bearer abcdefghijklmnop' }, secret_ref: 'secret://provider/key', run_id: 'spoofed'
    });
    observability.startSpan('Bearer abcdefghijklmnop', { access_token: 'token-abcdefghijkl', connection_ref: 'connection://crm' });
    const metric = observability.metric('safe.metric', 1, { restricted_result: 'private-result' });

    const serializedLogs = stream.lines.join('');
    expect(serializedLogs).not.toContain('hunter2');
    expect(serializedLogs).not.toContain('message-private');
    expect(serializedLogs).not.toContain('opaque-correlation-123');
    expect(serializedLogs).not.toContain('spoofed');
    expect(serializedLogs).toContain('secret://provider/key');
    expect(JSON.parse(stream.lines[0] ?? '{}')).toMatchObject({ msg: '[REDACTED]', run_id: '[REDACTED]' });
    expect(tracer.name).toBe('redacted.span');
    expect(tracer.options?.attributes).toMatchObject({ connection_ref: 'connection://crm', run_id: '[REDACTED]' });
    expect(tracer.options?.attributes).not.toHaveProperty('access_token');
    expect(metric).not.toHaveProperty('restricted_result');
  });

  it('rejects non-allowlisted or sensitive correlation fields at the telemetry boundary', () => {
    expect(() => new AgentObservability({ correlation: { run_id: 'run-1', token: 'value' } as never })).toThrow('INVALID_RUNTIME_CORRELATION');
    expect(() => new AgentObservability({ correlation: { run_id: 'Bearer abcdefghijklmnop' } })).toThrow('INVALID_RUNTIME_CORRELATION');
  });

  it('never exports malformed references through Pino, OTel spans, or metrics while preserving legal refs', () => {
    const stream = new CaptureStream();
    const tracer = new CaptureTracer();
    const metricAttributes: Attributes[] = [];
    const meter = {
      createHistogram: () => ({ record: (_value: number, attributes?: Attributes) => metricAttributes.push({ ...attributes }) })
    } as unknown as Meter;
    const observability = new AgentObservability({ correlation: { run_id: 'run-1' }, destination: stream, tracer, meter });

    observability.log('references received', {
      nested: { secret_ref: 'plain-text-credential' },
      artifact_ref: 'https://example.invalid/raw-artifact',
      context_ref: 'context://tenant-a/context-1'
    });
    observability.startSpan('reference.check', {
      checkpoint_ref: 'checkpoint-1',
      sessionRef: 'session://tenant-a/session-1'
    }).end();
    const metric = observability.metric('reference.invalid', 1, {
      run_ref: 'run-1',
      connection_ref: 'connection://tenant-a/crm/read'
    });

    const exported = JSON.stringify({ logs: stream.lines, span: tracer.options?.attributes, metric, metricAttributes });
    for (const raw of ['plain-text-credential', 'https://example.invalid/raw-artifact', 'checkpoint-1']) {
      expect(exported).not.toContain(raw);
    }
    expect(JSON.parse(stream.lines[0] ?? '{}')).toMatchObject({
      nested: {}, context_ref: 'context://tenant-a/context-1'
    });
    expect(JSON.parse(stream.lines[0] ?? '{}')).not.toHaveProperty('artifact_ref');
    expect(tracer.options?.attributes).not.toHaveProperty('checkpoint_ref');
    expect(tracer.options?.attributes).toMatchObject({ sessionRef: 'session://tenant-a/session-1' });
    expect(metric).not.toHaveProperty('run_ref');
    expect(metric).toMatchObject({ connection_ref: 'connection://tenant-a/crm/read' });
    expect(metricAttributes[0]).not.toHaveProperty('run_ref');
    expect(metricAttributes[0]).toMatchObject({ connection_ref: 'connection://tenant-a/crm/read' });
  });

  it('enumerates prompt/history/event/checkpoint/trace fixtures and rejects the malformed-ref fixture', async () => {
    const fixturesDirectory = new URL('../fixtures/', import.meta.url);
    const fixtureNames = (await readdir(fixturesDirectory)).filter((name) => name.endsWith('.json')).sort();
    expect(fixtureNames).toEqual([
      'checkpoint.safe.json', 'event.safe.json', 'history.safe.json', 'malformed-reference.malformed.json',
      'prompt.safe.json', 'trace.safe.json'
    ]);

    for (const fixtureName of fixtureNames) {
      const fixture = JSON.parse(await readFile(new URL(fixtureName, fixturesDirectory), 'utf8')) as unknown;
      if (fixtureName.endsWith('.safe.json')) {
        expect(() => assertNoSensitiveData(fixture), fixtureName).not.toThrow();
        expect(sanitizeTelemetry(fixture), fixtureName).toEqual(fixture);
      } else {
        expect(() => assertNoSensitiveData(fixture), fixtureName).toThrow('INVALID_REFERENCE_VALUE');
        const sanitized = sanitizeTelemetry(fixture);
        const serialized = JSON.stringify(sanitized);
        expect(() => assertNoSensitiveData(sanitized), fixtureName).not.toThrow();
        expect(serialized).not.toContain('secret_ref');
        expect(serialized).not.toContain('artifact_ref');
        expect(serialized).not.toContain('runRef');
        expect(serialized).not.toContain('plain-text-credential');
        expect(serialized).not.toContain('https://example.invalid/not-an-artifact-ref');
      }
    }
  });

  it('constructs the exact OTLP HTTP exporter used at the backend boundary', () => {
    expect(createOtlpTraceExporter({ url: 'http://127.0.0.1:4318/v1/traces' })).toBeTruthy();
  });
});


describe('P6 cross-chain operational dashboard',()=>{
  it('covers Chat Router Worker Store Artifact and Temporal target with alertable correlation',async()=>{
    const {P6_CROSS_CHAIN_DASHBOARD,p6CorrelationComplete}=await import('./index.js');
    expect(P6_CROSS_CHAIN_DASHBOARD.map((panel)=>panel.id)).toEqual(expect.arrayContaining(['chat-promotion-rate','route-target','worker-attempt','projection-lag','reconcile-failure','artifact-outage','target-unavailable']));
    expect(P6_CROSS_CHAIN_DASHBOARD.filter((panel)=>panel.alert).map((panel)=>panel.id)).toEqual(expect.arrayContaining(['projection-lag','reconcile-failure','artifact-outage','target-unavailable']));
    const complete={tenant_id:'tenant',message_id:'message',session_id:'session',run_id:'run',task_id:'task',workflow_id:'workflow',target_id:'target',attempt:1};
    expect(p6CorrelationComplete(complete)).toBe(true);
    for(const field of Object.keys(complete))expect(p6CorrelationComplete({...complete,[field]:undefined})).toBe(false);
    for(const malformed of [{...complete,message_id:''},{...complete,tenant_id:'   '},{...complete,attempt:0},{...complete,attempt:1.5},{...complete,attempt:'1'},null,[]])expect(p6CorrelationComplete(malformed as never)).toBe(false);
  });
});


describe('Durable Coordinator operational signals', () => {
  it('emits all required signals with low-cardinality metric labels and actionable alerts', async () => {
    const { DURABLE_COORDINATOR_SIGNALS, DURABLE_COORDINATOR_ALERTS } = await import('./index.js');
    const stream = new CaptureStream();
    const metricAttributes: Attributes[] = [];
    const meter = { createHistogram: () => ({ record: (_value: number, attributes?: Attributes) => metricAttributes.push({ ...attributes }) }) } as unknown as Meter;
    const observability = new AgentObservability({ correlation: { run_id: 'run-1' }, destination: stream, meter });
    const result = recordDurableCoordinatorSignal(observability, {
      signal: 'owner_conflict', labels: { path: 'DURABLE_COORDINATOR_V2', outcome: 'rejected', reasonCode: 'OWNER_CAS_LOST' },
      correlation: { task_id: 'task-1', workflow_id: 'workflow-1' }, fields: { owner_ref: 'owner://task-1' }
    });
    expect(DURABLE_COORDINATOR_SIGNALS).toHaveLength(8);
    expect(result).toMatchObject({ metric_name: 'sage_durable_coordinator_owner_conflict_total', path: 'DURABLE_COORDINATOR_V2', outcome: 'rejected', reason_code: 'OWNER_CAS_LOST' });
    expect(metricAttributes[0]).toEqual({ path: 'DURABLE_COORDINATOR_V2', outcome: 'rejected', reason_code: 'OWNER_CAS_LOST' });
    expect(DURABLE_COORDINATOR_ALERTS).toHaveLength(8);
    expect(DURABLE_COORDINATOR_ALERTS.every((alert) => alert.threshold === 0 && alert.runbook.includes('p7-incident-runbooks'))).toBe(true);
  });

  it('keeps payloads and high-cardinality correlation out of metrics and redacts sensitive log fields', () => {
    const stream = new CaptureStream();
    const metricAttributes: Attributes[] = [];
    const meter = { createHistogram: () => ({ record: (_value: number, attributes?: Attributes) => metricAttributes.push({ ...attributes }) }) } as unknown as Meter;
    const observability = new AgentObservability({ correlation: { run_id: 'run-1' }, knownSecrets: ['credential-value'], destination: stream, meter });
    recordDurableCoordinatorSignal(observability, {
      signal: 'effect_unknown', labels: { outcome: 'blocked', reasonCode: 'REMOTE_COMMIT_UNCERTAIN' },
      correlation: { task_id: 'task-high-cardinality', run_id: 'run-high-cardinality' },
      fields: { credential: 'credential-value', messageBody: 'private body', receipt_ref: 'receipt://tenant/receipt-1' }
    });
    expect(metricAttributes[0]).toEqual({ outcome: 'blocked', reason_code: 'REMOTE_COMMIT_UNCERTAIN' });
    const serialized = stream.lines.join('');
    expect(serialized).not.toContain('credential-value');
    expect(serialized).not.toContain('private body');
    expect(serialized).not.toContain('task-high-cardinality');
  });

  it('rejects unbounded reason labels', () => {
    const observability = new AgentObservability({ correlation: { run_id: 'run-1' } });
    expect(() => recordDurableCoordinatorSignal(observability, {
      signal: 'stale_receipt', labels: { outcome: 'blocked', reasonCode: 'x'.repeat(65) }
    })).toThrow('DURABLE_SIGNAL_LABEL_INVALID');
  });
});

describe('Phase 3 platform correlation telemetry', () => {
  it('keeps Release/Admission/Spec/Target refs in sanitized traces/logs but not metric labels', () => {
    const stream = new CaptureStream();
    const metricAttributes: Attributes[] = [];
    const meter = { createHistogram: () => ({ record: (_value: number, attributes?: Attributes) => metricAttributes.push({ ...attributes }) }) } as unknown as Meter;
    const observability = new AgentObservability({ correlation: { run_id: 'run-1' }, destination: stream, meter });
    const metric = recordAgentPlatformCorrelation(observability, {
      stage: 'admission', outcome: 'accepted', reasonCode: 'ADMISSION_ACCEPTED',
      releaseRef: 'release://sha256:' + 'a'.repeat(64), admissionId: 'admission-high-cardinality',
      reservationRef: 'usage-reservation://tenant/reservation-1', specRef: 'spec://tenant/spec-1',
      targetRef: 'target://tenant/target-1', adapterRef: 'adapter://legacy/v1',
    });
    expect(metric).toEqual({ name: 'sage_agent_platform_correlation_total', stage: 'admission', outcome: 'accepted', reasonCode: 'ADMISSION_ACCEPTED' });
    expect(metricAttributes[0]).toEqual({ stage: 'admission', outcome: 'accepted', reason_code: 'ADMISSION_ACCEPTED' });
    expect(metricAttributes[0]).not.toHaveProperty('admissionId');
    expect(stream.lines.join('')).toContain('admission-high-cardinality');
  });

  it('drops endpoint, input, context, secret, and payload fields before telemetry', () => {
    const stream = new CaptureStream();
    const observability = new AgentObservability({ correlation: { run_id: 'run-1' }, destination: stream });
    recordAgentPlatformCorrelation(observability, {
      stage: 'compatibility_adapter', outcome: 'rejected', reasonCode: 'LEGACY_SPEC_INVALID',
      endpoint: 'https://private.invalid', input: 'full input', context: 'full context', secret: 'secret-value', payload: 'private payload',
    } as never);
    const serialized = stream.lines.join('');
    for (const forbidden of ['https://private.invalid', 'full input', 'full context', 'secret-value', 'private payload']) {
      expect(serialized).not.toContain(forbidden);
    }
  });
});
