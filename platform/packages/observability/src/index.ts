import pino, { type DestinationStream, type Logger } from 'pino';
import { metrics, trace, type Attributes, type Meter, type Span, type Tracer } from '@opentelemetry/api';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import {
  assertRuntimeCorrelation,
  isReferenceKey,
  isSensitiveKey,
  isSensitiveString,
  isValidReference,
  type RuntimeCorrelation
} from '@sage/platform-ports';

export type TelemetryCorrelation = RuntimeCorrelation;
export { assertNoSensitiveData } from '@sage/platform-ports';

const HIGH_CARDINALITY_METRIC_KEY = /^(?:tenant_id|session_id|message_id|task_id|run_id|attempt_id|spec_id|spec_ref|invocation_id|semantic_action_id|artifact_id|artifact_ref|checkpoint_id|checkpoint_ref|workflow_id|release_id|release_ref|adapter_id|adapter_ref|provider_id|provider_ref|target_id|tool_call_id)$/i;
const redacted = '[REDACTED]';

export function sanitizeTelemetry<T>(value: T, knownSecrets: readonly string[] = []): T {
  const seen = new WeakMap<object, unknown>();
  const visit = (current: unknown): unknown => {
    if (typeof current === 'string') return isSensitiveString(current, knownSecrets) ? redacted : current;
    if (current instanceof Uint8Array) return redacted;
    if (Array.isArray(current)) return current.map((item) => visit(item));
    if (current && typeof current === 'object') {
      const existing = seen.get(current);
      if (existing !== undefined) return existing;
      const sanitized: Record<string, unknown> = {};
      seen.set(current, sanitized);
      for (const [nestedKey, nested] of Object.entries(current)) {
        if (isReferenceKey(nestedKey)) {
          if (isValidReference(nestedKey, nested)) sanitized[nestedKey] = nested;
        } else if (!isSensitiveKey(nestedKey)) {
          sanitized[nestedKey] = visit(nested);
        }
      }
      return sanitized;
    }
    return current;
  };
  return visit(value) as T;
}

const correlationFields = (correlation: TelemetryCorrelation, knownSecrets: readonly string[]): Record<string, string | number> => {
  assertRuntimeCorrelation(correlation);
  return sanitizeTelemetry(Object.fromEntries(
    Object.entries(correlation).filter((entry): entry is [string, string | number] => entry[1] !== undefined)
  ), knownSecrets);
};

const otelAttributes = (value: Readonly<Record<string, unknown>>, knownSecrets: readonly string[]): Attributes => Object.fromEntries(
  Object.entries(sanitizeTelemetry(value, knownSecrets)).map(([key, item]) => [
    key,
    typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean' ? item : JSON.stringify(item)
  ])
);

export interface ObservabilityOptions {
  readonly correlation: TelemetryCorrelation;
  readonly knownSecrets?: readonly string[];
  readonly destination?: DestinationStream;
  readonly tracer?: Tracer;
  readonly meter?: Meter;
}

export class AgentObservability {
  readonly #logger: Logger;
  readonly #tracer: Tracer;
  readonly #meter: Meter;
  readonly #correlation: Record<string, string | number>;
  readonly #knownSecrets: readonly string[];

  constructor(options: ObservabilityOptions) {
    this.#knownSecrets = [...(options.knownSecrets ?? [])];
    this.#correlation = correlationFields(options.correlation, this.#knownSecrets);
    this.#logger = pino({ base: null, level: 'info' }, options.destination);
    this.#tracer = options.tracer ?? trace.getTracer('@sage/observability', '0.1.0');
    this.#meter = options.meter ?? metrics.getMeter('@sage/observability', '0.1.0');
  }

  log(message: string, fields: Readonly<Record<string, unknown>> = {}): void {
    const safeFields = sanitizeTelemetry(fields, this.#knownSecrets);
    const safeMessage = sanitizeTelemetry(message, this.#knownSecrets);
    this.#logger.info({ ...safeFields, ...this.#correlation }, safeMessage);
  }

  startSpan(name: string, fields: Readonly<Record<string, unknown>> = {}): Span {
    const safeName = sanitizeTelemetry(name, this.#knownSecrets) === redacted ? 'redacted.span' : name;
    return this.#tracer.startSpan(safeName, {
      attributes: otelAttributes({ ...sanitizeTelemetry(fields, this.#knownSecrets), ...this.#correlation }, this.#knownSecrets)
    });
  }

  metric(name: string, value: number, fields: Readonly<Record<string, unknown>> = {}): Readonly<Record<string, unknown>> {
    const safeName = sanitizeTelemetry(name, this.#knownSecrets) === redacted ? 'redacted.metric' : name;
    const record = sanitizeTelemetry({ ...fields, ...this.#correlation, metric_name: safeName, metric_value: value }, this.#knownSecrets);
    const boundedMetricFields = Object.fromEntries(Object.entries(sanitizeTelemetry(fields, this.#knownSecrets)).filter(([key, item]) => !HIGH_CARDINALITY_METRIC_KEY.test(key) && (typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean')));
    this.#meter.createHistogram(safeName).record(value, otelAttributes(boundedMetricFields, this.#knownSecrets));
    this.#logger.info({ telemetry_kind: 'metric', ...record }, 'metric');
    return record;
  }

  metricLowCardinality(name: string, value: number, fields: Readonly<Record<string, unknown>> = {}): Readonly<Record<string, unknown>> {
    const safeName = sanitizeTelemetry(name, this.#knownSecrets) === redacted ? 'redacted.metric' : name;
    const boundedFields = Object.fromEntries(Object.entries(fields).filter(([key, item]) => !HIGH_CARDINALITY_METRIC_KEY.test(key) && (typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean')));
    const record = sanitizeTelemetry({ ...boundedFields, metric_name: safeName, metric_value: value }, this.#knownSecrets);
    this.#meter.createHistogram(safeName).record(value, otelAttributes(boundedFields, this.#knownSecrets));
    this.#logger.info({ telemetry_kind: 'metric', ...record }, 'metric');
    return record;
  }
}

export function createOtlpTraceExporter(config?: ConstructorParameters<typeof OTLPTraceExporter>[0]): OTLPTraceExporter {
  return config === undefined ? new OTLPTraceExporter() : new OTLPTraceExporter(config);
}


export type P6MetricName=
  |'sage_chat_task_promotions_total'|'sage_task_route_decisions_total'|'sage_task_worker_attempt_total'
  |'sage_task_projection_lag_ms'|'sage_task_reconcile_retryable_failure_total'
  |'sage_artifact_store_unavailable_total'|'sage_temporal_target_unavailable_total'
  |'sage_task_effect_unknown_total'|'sage_task_projection_drift_total';
export interface P6Correlation{readonly tenant_id:string;readonly message_id:string;readonly session_id:string;readonly run_id:string;readonly task_id:string;readonly workflow_id:string;readonly target_id:string;readonly attempt:number}
export interface P6TelemetryRecorder{record(name:P6MetricName,value:number,correlation:P6Correlation,fields?:Readonly<Record<string,unknown>>):void}
export class OtlpP6TelemetryRecorder implements P6TelemetryRecorder{
  record(name:P6MetricName,value:number,correlation:P6Correlation,fields:Readonly<Record<string,unknown>>={}):void{
    const {tenant_id,...runtime}=correlation;
    const observability=new AgentObservability({correlation:runtime});
    observability.log('p6.metric.correlation',{tenant_id,...fields});
    observability.metricLowCardinality(name,value,Object.fromEntries(Object.entries(fields).filter(([key])=>!HIGH_CARDINALITY_METRIC_KEY.test(key))));
  }
}
export interface P6DashboardPanel { readonly id:string; readonly metric:P6MetricName; readonly groupBy:readonly string[]; readonly alert?:{readonly threshold:number;readonly window:string;readonly severity:'warning'|'critical'} }
const p6GroupBy=['terminal_status','error_code','target_class'] as const;
export const P6_CROSS_CHAIN_DASHBOARD:readonly P6DashboardPanel[]=[
  {id:'chat-promotion-rate',metric:'sage_chat_task_promotions_total',groupBy:p6GroupBy},
  {id:'route-target',metric:'sage_task_route_decisions_total',groupBy:p6GroupBy},
  {id:'worker-attempt',metric:'sage_task_worker_attempt_total',groupBy:p6GroupBy},
  {id:'projection-lag',metric:'sage_task_projection_lag_ms',groupBy:p6GroupBy,alert:{threshold:30000,window:'5m',severity:'warning'}},
  {id:'reconcile-failure',metric:'sage_task_reconcile_retryable_failure_total',groupBy:p6GroupBy,alert:{threshold:0,window:'5m',severity:'critical'}},
  {id:'artifact-outage',metric:'sage_artifact_store_unavailable_total',groupBy:p6GroupBy,alert:{threshold:0,window:'5m',severity:'warning'}},
  {id:'target-unavailable',metric:'sage_temporal_target_unavailable_total',groupBy:p6GroupBy,alert:{threshold:0,window:'1m',severity:'critical'}},
  {id:'effect-unknown',metric:'sage_task_effect_unknown_total',groupBy:p6GroupBy,alert:{threshold:0,window:'5m',severity:'critical'}},
  {id:'projection-drift',metric:'sage_task_projection_drift_total',groupBy:p6GroupBy,alert:{threshold:0,window:'5m',severity:'warning'}}
] as const;
export function p6CorrelationComplete(fields:object):boolean{
  if(fields===null||typeof fields!=='object'||Array.isArray(fields))return false;
  const value=fields as Readonly<Record<string,unknown>>;
  const strings=['tenant_id','message_id','session_id','run_id','task_id','workflow_id','target_id'];
  return strings.every((field)=>typeof value[field]==='string'&&(value[field] as string).trim().length>0)
    && Number.isSafeInteger(value.attempt)&&(value.attempt as number)>=1;
}


/** Durable Coordinator operational signals are intentionally bounded and low-cardinality. */
export type DurableCoordinatorSignal =
  | 'effect_unknown'
  | 'replay_gate_rejection'
  | 'owner_conflict'
  | 'cross_path_start_attempt'
  | 'projection_lag'
  | 'projection_repair'
  | 'continue_chain_failure'
  | 'stale_receipt';
export type DurableCoordinatorSignalOutcome = 'blocked' | 'observed' | 'repaired' | 'rejected';
export type DurableCoordinatorLowCardinality = {
  readonly path?: 'LEGACY_TEMPORAL_TASK' | 'DURABLE_COORDINATOR_V2';
  readonly outcome: DurableCoordinatorSignalOutcome;
  readonly reasonCode: string;
};
export interface DurableCoordinatorSignalInput {
  readonly signal: DurableCoordinatorSignal;
  readonly correlation?: Readonly<Record<string, unknown>>;
  readonly labels: DurableCoordinatorLowCardinality;
  readonly fields?: Readonly<Record<string, unknown>>;
}
export const DURABLE_COORDINATOR_SIGNALS: readonly DurableCoordinatorSignal[] = [
  'effect_unknown', 'replay_gate_rejection', 'owner_conflict', 'cross_path_start_attempt',
  'projection_lag', 'projection_repair', 'continue_chain_failure', 'stale_receipt'
] as const;
const durableSignalMetric = (signal: DurableCoordinatorSignal): string => `sage_durable_coordinator_${signal}_total`;

/**
 * Emits safe operational telemetry. Correlation identifiers may be retained in logs/traces,
 * while metrics receive only the fixed signal/path/outcome/reason_code dimensions.
 */
export function recordDurableCoordinatorSignal(
  observability: AgentObservability,
  input: DurableCoordinatorSignalInput
): Readonly<Record<string, unknown>> {
  if (!DURABLE_COORDINATOR_SIGNALS.includes(input.signal)) throw new TypeError('DURABLE_SIGNAL_INVALID');
  if (input.labels.reasonCode.length === 0 || input.labels.reasonCode.length > 64) throw new TypeError('DURABLE_SIGNAL_LABEL_INVALID');
  const labels = {
    ...(input.labels.path === undefined ? {} : { path: input.labels.path }),
    outcome: input.labels.outcome,
    reason_code: input.labels.reasonCode
  } as const;
  const safeFields = Object.fromEntries(Object.entries(sanitizeTelemetry(input.fields ?? {})).filter(([key]) => !/body|payload|content|prompt|context|checkpoint|memory|credential|secret|token/i.test(key)));
  const safeCorrelation = sanitizeTelemetry(input.correlation ?? {});
  observability.log(`durable_coordinator.${input.signal}`, { signal: input.signal, ...safeFields, ...safeCorrelation });
  observability.startSpan(`durable_coordinator.${input.signal}`, { signal: input.signal, ...safeFields, ...safeCorrelation }).end();
  return observability.metricLowCardinality(durableSignalMetric(input.signal), 1, labels);
}
export interface DurableCoordinatorAlertPanel {
  readonly id: DurableCoordinatorSignal;
  readonly metric: string;
  readonly threshold: number;
  readonly window: string;
  readonly severity: 'warning' | 'critical';
  readonly runbook: string;
}
export const DURABLE_COORDINATOR_ALERTS: readonly DurableCoordinatorAlertPanel[] = DURABLE_COORDINATOR_SIGNALS.map((signal) => ({
  id: signal,
  metric: durableSignalMetric(signal),
  threshold: 0,
  window: signal === 'projection_lag' || signal === 'projection_repair' ? '5m' : '1m',
  severity: signal === 'projection_lag' || signal === 'projection_repair' ? 'warning' : 'critical',
  runbook: 'platform/docs/p7-incident-runbooks.md'
}));

export type AgentPlatformCorrelationStage =
  | 'release'
  | 'admission'
  | 'reservation'
  | 'spec'
  | 'target'
  | 'compatibility_adapter';
export type AgentPlatformCorrelationOutcome = 'accepted' | 'rejected' | 'pending' | 'compensated' | 'shadow';
export interface AgentPlatformCorrelation {
  readonly stage: AgentPlatformCorrelationStage;
  readonly outcome: AgentPlatformCorrelationOutcome;
  readonly releaseRef?: string;
  readonly admissionId?: string;
  readonly reservationRef?: string;
  readonly specRef?: string;
  readonly targetRef?: string;
  readonly adapterRef?: string;
  readonly reasonCode: string;
}
export interface AgentPlatformCorrelationMetric {
  readonly name: 'sage_agent_platform_correlation_total';
  readonly stage: AgentPlatformCorrelationStage;
  readonly outcome: AgentPlatformCorrelationOutcome;
  readonly reasonCode: string;
}

const forbiddenAgentPlatformTelemetryKey = /(?:secret|credential|token|password|endpoint|input|context|prompt|payload|body|memory|checkpoint|reasoning|sql|mql)/iu;
const boundedCorrelationFields = (input: AgentPlatformCorrelation): Readonly<Record<string, unknown>> => {
  const fields = Object.fromEntries(Object.entries(input).filter(([key, value]) =>
    !forbiddenAgentPlatformTelemetryKey.test(key) && (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')));
  if (typeof fields.reasonCode !== 'string' || fields.reasonCode.length === 0 || fields.reasonCode.length > 64) {
    throw new TypeError('AGENT_PLATFORM_CORRELATION_INVALID');
  }
  return sanitizeTelemetry(fields);
};

/** Correlation IDs are retained only in sanitized logs/traces; metric labels stay fixed-cardinality. */
export function recordAgentPlatformCorrelation(
  observability: AgentObservability,
  input: AgentPlatformCorrelation,
): AgentPlatformCorrelationMetric {
  const fields = boundedCorrelationFields(input);
  observability.log('agent_platform.correlation', fields);
  observability.startSpan('agent_platform.correlation', fields).end();
  const metric: AgentPlatformCorrelationMetric = {
    name: 'sage_agent_platform_correlation_total',
    stage: input.stage,
    outcome: input.outcome,
    reasonCode: input.reasonCode,
  };
  observability.metricLowCardinality(metric.name, 1, {
    stage: metric.stage, outcome: metric.outcome, reason_code: metric.reasonCode,
  });
  return metric;
}

// ===== P8 Schedule 触发观测（低基数：metrics 只带 outcome/reason_code，schedule 标识进日志字段） =====
export type ScheduleTriggerOutcome = 'succeeded' | 'failed' | 'skipped' | 'missed';
export interface ScheduleTriggerSignalInput {
  readonly outcome: ScheduleTriggerOutcome;
  readonly reasonCode?: string;
  /** 日志/追踪可保留的关联标识（schedule/occurrence/task）；metrics label 不含高基数标识。 */
  readonly correlation?: Readonly<Record<string, unknown>>;
}
export const scheduleTriggerMetricName = 'sage_schedule_trigger_total';
export function recordScheduleTriggerSignal(
  observability: AgentObservability,
  input: ScheduleTriggerSignalInput
): void {
  const reasonCode = (input.reasonCode ?? 'none').slice(0, 64);
  try {
    observability.metricLowCardinality(scheduleTriggerMetricName, 1, { outcome: input.outcome, reason_code: reasonCode });
    observability.log(`schedule.trigger.${input.outcome}`, { outcome: input.outcome, reason_code: reasonCode, ...sanitizeTelemetry(input.correlation ?? {}) });
  } catch { /* Telemetry cannot change dispatch semantics */ }
}
