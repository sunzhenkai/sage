/**
 * Schedules types (spec §10): API payloads of the schedule plane endpoints.
 * The shape mirrors `ScheduleListResult.v1` / `ScheduleTriggerHistory.v1`;
 * only the fields the Web UI renders are modeled.
 */

/** Trigger rule (spec §10.1): cron with timezone, or a fixed interval. */
export type ScheduleTriggerRule =
  | { kind: "cron"; expression: string; timezone: string }
  | { kind: "interval"; everyMs: number };

/** Release binding (spec §10.1): a pinned release, or follow-latest. */
export type ScheduleReleaseBinding = { strategy: "FIXED"; releaseId: string } | { strategy: "FOLLOW" };

export type ScheduleState = "ACTIVE" | "PAUSED" | "DELETED";

/** Schedule definition subset rendered by the list (spec §10.1). */
export interface ScheduleDefinition {
  scheduleId: string;
  displayName?: string | undefined;
  trigger: ScheduleTriggerRule;
  releaseBinding: ScheduleReleaseBinding;
  invocation: { task: string; params?: Record<string, string | number> | undefined };
}

/** One schedule entry (`ScheduleView`) inside `ScheduleListResult.v1`. */
export interface ScheduleView {
  definition: ScheduleDefinition;
  state: ScheduleState;
  nextFireAtMs?: number | undefined;
}

/** `GET /v1/schedules` response (spec §10.1). */
export interface ScheduleListResult {
  schemaVersion: "ScheduleListResult.v1";
  schedules: ScheduleView[];
}

export type ScheduleTriggerKind = "SUCCEEDED" | "FAILED" | "SKIPPED" | "MISSED";

/** One trigger event inside `ScheduleTriggerHistory.v1` (spec §10.2). */
export interface ScheduleTriggerEvent {
  occurrenceId: string;
  kind: ScheduleTriggerKind;
  occurredAtMs: number;
  taskId?: string | undefined;
  errorCode?: string | undefined;
}

/** `GET /v1/schedules/:id/triggers` response (spec §10.2). */
export interface ScheduleTriggerHistory {
  schemaVersion: "ScheduleTriggerHistory.v1";
  scheduleId: string;
  events: ScheduleTriggerEvent[];
}
