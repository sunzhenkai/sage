/**
 * Task workspace view types (spec §7). These mirror the workspace API
 * projections (`TaskProjectionView`, `TaskProjectionEvent`,
 * `TaskArtifactReference`, run-log attempts/events) as consumed by the Web;
 * they are not exported by `@sage/app-contracts`, so they live here next to
 * the other workspace view types.
 */

/** Known task statuses (spec §7.1); the API may still return unknown values. */
export type TaskStatus = "running" | "paused" | "failed" | "succeeded" | "cancelled" | "effect_unknown";

export type ProjectionFreshness = "fresh" | "stale" | "unavailable";

/** Spec §7.1 `TaskViewModel` (list rows and detail header). */
export interface TaskViewModel {
  taskId: string;
  taskType: string;
  workflowId: string;
  targetId: string;
  attempt: number;
  /** Known values are `TaskStatus`; unknown values are displayed verbatim. */
  status: string;
  revision: number;
  projectionUpdatedAt?: string | undefined;
  freshness: ProjectionFreshness;
  staleReason?: string | undefined;
  sessionId?: string | undefined;
  runId?: string | undefined;
  messageId?: string | undefined;
  targetSnapshot: {
    targetId: string;
    environment: string;
    namespace: string;
    taskQueue: string;
  };
  failureCode?: string | undefined;
  failureDetail?: string | undefined;
}

/** `GET /v1/tasks` response (spec §7.1). */
export interface TaskListResponse {
  tasks: TaskViewModel[];
}

/** Spec §7.4 `TaskEventView`. */
export interface TaskEventView {
  eventId: string;
  sequence: number;
  kind: "task" | "agent";
  type: string;
  occurredAt: string;
  payload: Readonly<Record<string, unknown>>;
}

/** `GET /v1/tasks/:id/events` response. */
export interface TaskEventsResponse {
  events: TaskEventView[];
}

/** Spec §7.6 `TaskArtifactView`. */
export interface TaskArtifactView {
  artifactId: string;
  artifactRef: string;
  name: string;
  mediaType: string;
}

/** `GET /v1/tasks/:id/artifacts` response. */
export interface TaskArtifactsResponse {
  artifacts: TaskArtifactView[];
}

/**
 * `GET /v1/tasks/:id/artifacts/:artifactId` — the resolved reference plus the
 * inline body when the store holds it. `encoding === "base64"` is binary and
 * must never be rendered as text (spec §7.6).
 */
export interface TaskArtifactContentView extends TaskArtifactView {
  content?: string | undefined;
  encoding?: "utf-8" | "base64" | undefined;
}

/** Run-log attempt summary; the `attempt` ordinal is its position in the list. */
export interface TaskRunLogAttemptView {
  runId: string;
  attemptId: string;
  eventCount: number;
  firstSequence: number;
  lastSequence: number;
  lastWrittenAt: string;
}

/** One run-log event (whitelisted `AgentEventV2` fields). */
export interface TaskRunLogEventView {
  eventId: string;
  sequence: number;
  type: string;
  payload?: Readonly<Record<string, unknown>> | undefined;
  receiptRefs?: readonly string[] | undefined;
  artifactRefs?: readonly string[] | undefined;
}

/** Spec §7.5 `TaskRunLogsView`. */
export interface TaskRunLogsView {
  attempts: readonly TaskRunLogAttemptView[];
  selected?: { runId: string; attemptId: string } | undefined;
  events: readonly TaskRunLogEventView[];
  nextFromSequence?: number | undefined;
}
