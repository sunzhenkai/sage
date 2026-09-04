import type { MessageKey } from "@/lib/i18n";
import type { TaskArtifactView, TaskRunLogEventView, TaskViewModel } from "@/types/tasks";

/**
 * Pure Tasks-workspace logic (spec §7), kept free of React so it can be unit
 * tested directly: status filters, client-side search, the control
 * availability matrix, run-log event dedupe, payload summaries, event-type
 * semantics and artifact link/preview rules.
 */

export const TASK_STATUS_FILTERS = ["all", "running", "paused", "failed", "succeeded", "cancelled"] as const;
export type TaskStatusFilter = (typeof TASK_STATUS_FILTERS)[number];

/** `all` sends no `status` parameter (spec §7.1). */
export function buildTaskListPath(filter: TaskStatusFilter): string {
  return filter === "all" ? "/tasks" : `/tasks?status=${encodeURIComponent(filter)}`;
}

/** Case-insensitive substring match on taskId + taskType + targetSnapshot.targetId (spec §7.1). */
export function filterTasks(tasks: readonly TaskViewModel[], query: string): TaskViewModel[] {
  const needle = query.trim().toLowerCase();
  if (needle === "") return [...tasks];
  return tasks.filter((task) =>
    [task.taskId, task.taskType, task.targetSnapshot?.targetId ?? ""].some((field) =>
      field.toLowerCase().includes(needle),
    ),
  );
}

export function countRunning(tasks: readonly TaskViewModel[]): number {
  return tasks.filter((task) => task.status === "running").length;
}

const KNOWN_STATUS_KEYS: Readonly<Record<string, MessageKey>> = {
  running: "chat.taskStatus.running",
  paused: "chat.taskStatus.paused",
  failed: "chat.taskStatus.failed",
  succeeded: "chat.taskStatus.succeeded",
  cancelled: "chat.taskStatus.cancelled",
  effect_unknown: "chat.taskStatus.effect_unknown",
};

/** Known statuses localize; unknown statuses render verbatim plus a space (spec §7.1). */
export function taskStatusKey(status: string): MessageKey | null {
  return KNOWN_STATUS_KEYS[status] ?? null;
}

/** Control availability from the current projection (spec §7.3). */
export interface TaskControlAvailability {
  pause: boolean;
  resume: boolean;
  cancel: boolean;
  retry: boolean;
}

export function controlAvailability(status: string): TaskControlAvailability {
  return {
    pause: status === "running",
    resume: status === "paused",
    cancel: status !== "succeeded" && status !== "cancelled" && status !== "effect_unknown",
    retry: status === "failed",
  };
}

/** Append incoming events, deduped by `eventId` (spec §7.5 rule 1, §13.5). */
export function appendRunLogEvents(
  existing: readonly TaskRunLogEventView[],
  incoming: readonly TaskRunLogEventView[],
): TaskRunLogEventView[] {
  const seen = new Set(existing.map((event) => event.eventId));
  const fresh = incoming.filter((event) => !seen.has(event.eventId));
  return fresh.length === 0 ? [...existing] : [...existing, ...fresh];
}

/** Scalar-only payload summary for a run-log event row (spec §7.5 rule 5). */
export function payloadScalarSummary(payload: Readonly<Record<string, unknown>> | undefined): string {
  if (!payload) return "";
  const parts: string[] = [];
  for (const [key, value] of Object.entries(payload)) {
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean" || value === null) {
      parts.push(`${key}=${String(value)}`);
    }
  }
  return parts.join(", ");
}

/** Badge variant semantics for common run-log event types (spec §7.5 rule 6). */
export function runLogEventVariant(type: string): "success" | "destructive" | "warning" | "info" | "secondary" {
  if (type === "run.completed") return "success";
  if (type === "run.failed") return "destructive";
  if (type === "checkpoint.sealed") return "warning";
  if (type === "model.completed" || type === "tool.completed") return "info";
  return "secondary";
}

/** The `output.tar.gz` artifact is the package download (spec §7.6 rule 1). */
export const PACKAGE_ARTIFACT_NAME = "output.tar.gz";

export function isPackageArtifact(artifact: TaskArtifactView): boolean {
  return artifact.name === PACKAGE_ARTIFACT_NAME;
}

export function isTextMediaType(mediaType: string): boolean {
  return mediaType.startsWith("text/") || mediaType === "application/json";
}

/**
 * Artifact link (spec §7.6): the package artifact always downloads; other
 * text-like artifacts open inline, everything else downloads.
 */
export function artifactHref(apiBase: string, taskId: string, artifact: TaskArtifactView): string {
  const base = `${apiBase}/tasks/${encodeURIComponent(taskId)}/artifacts/${encodeURIComponent(artifact.artifactId)}`;
  if (isPackageArtifact(artifact) || !isTextMediaType(artifact.mediaType)) return `${base}?download=1`;
  return base;
}

/** First inline-previewable artifact of a succeeded task (spec §7.6). */
export function findPreviewableArtifact(artifacts: readonly TaskArtifactView[]): TaskArtifactView | undefined {
  return artifacts.find((artifact) => !isPackageArtifact(artifact) && isTextMediaType(artifact.mediaType));
}

/** Run-log request path for attempt switching / load-more (spec §7.5). */
export function buildRunLogsPath(
  taskId: string,
  selection?: { runId: string; attemptId: string },
  fromSequence?: number,
): string {
  const base = `/tasks/${encodeURIComponent(taskId)}/run-logs`;
  if (!selection) return base;
  const params = new URLSearchParams({ runId: selection.runId, attemptId: selection.attemptId });
  if (fromSequence !== undefined) params.set("fromSequence", String(fromSequence));
  return `${base}?${params.toString()}`;
}
