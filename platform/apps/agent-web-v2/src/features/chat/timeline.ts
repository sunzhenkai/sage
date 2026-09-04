import type { ChatRunStatus, TimelineEvent } from "@sage/app-contracts";

/**
 * Timeline model (spec §6.5): pure functions that group the flat
 * `TimelineEvent` stream into conversation turns keyed by `runId`, and derive
 * the per-turn display state. `sequence` is the sole cursor and dedupe key
 * (spec §13.4).
 */

/** Merge incoming events into the existing list: dedupe by sequence, sort ascending. */
export function mergeTimelineEvents(existing: readonly TimelineEvent[], incoming: readonly TimelineEvent[]): TimelineEvent[] {
  if (incoming.length === 0) return [...existing];
  const seen = new Set(existing.map((event) => event.sequence));
  const merged = [...existing];
  for (const event of incoming) {
    if (!seen.has(event.sequence)) {
      seen.add(event.sequence);
      merged.push(event);
    }
  }
  merged.sort((a, b) => a.sequence - b.sequence);
  return merged;
}

/** The latest sequence in the stream, used as the incremental/SSE cursor. */
export function latestSequence(events: readonly TimelineEvent[]): number {
  let max = 0;
  for (const event of events) {
    if (event.sequence > max) max = event.sequence;
  }
  return max;
}

export interface TurnUserMessage {
  text: string;
  messageId?: string | undefined;
  promotionEligibility?: "explicit" | "none" | undefined;
  occurredAt: string;
}

export interface TurnRunState {
  status: ChatRunStatus;
  attempt: number;
}

export type TurnDisplayStatus = "active" | "paused" | "succeeded" | "failed" | "unknown";

export interface TimelineTurn {
  runId: string;
  /** First sequence of the turn, keeps turns ordered. */
  firstSequence: number;
  userMessage: TurnUserMessage | null;
  /**
   * Assistant-facing stream: assistant text plus every non-run activity
   * (tool / artifact / error / task), merged by sequence (spec §6.5.3).
   */
  items: TimelineEvent[];
  /** Last run payload decides status and attempt (spec §6.5.4). */
  run: TurnRunState | null;
  /** Derived display status: error fallback to failed included (§6.5.5). */
  status: TurnDisplayStatus;
  hasError: boolean;
  /** Error + missing or still active/paused last run renders as failed (§6.5.5). */
  failed: boolean;
  /** active/paused without any assistant text yet shows thinking pending (§6.5.6). */
  pending: boolean;
  attempt: number;
  /** Failed turns expose a retry entry unless an error item already carries one (§6.5.7). */
  showRetryEntry: boolean;
}

function isUserTextCandidate(event: TimelineEvent, firstRunSequence: number): boolean {
  if (event.payload.kind !== "text") return false;
  return event.payload.promotionEligibility === "explicit" || event.sequence < firstRunSequence;
}

/** Group a sequence-sorted event list into conversation turns (spec §6.5). */
export function buildTimelineTurns(events: readonly TimelineEvent[]): TimelineTurn[] {
  const sorted = [...events].sort((a, b) => a.sequence - b.sequence);
  const byRunId = new Map<string, TimelineEvent[]>();
  for (const event of sorted) {
    const group = byRunId.get(event.runId);
    if (group) group.push(event);
    else byRunId.set(event.runId, [event]);
  }

  const turns: TimelineTurn[] = [];
  for (const [runId, group] of byRunId) {
    let firstRunSequence = Number.POSITIVE_INFINITY;
    for (const event of group) {
      if (event.payload.kind === "run" && event.sequence < firstRunSequence) {
        firstRunSequence = event.sequence;
      }
    }

    let userMessage: TurnUserMessage | null = null;
    const items: TimelineEvent[] = [];
    let run: TurnRunState | null = null;
    let hasError = false;
    let assistantTextCount = 0;
    let errorCarriesRetry = false;

    for (const event of group) {
      const payload = event.payload;
      if (payload.kind === "run") {
        run = { status: payload.status, attempt: payload.attempt };
        continue;
      }
      if (payload.kind === "error") {
        hasError = true;
        if (payload.error.retryable === true) errorCarriesRetry = true;
      }
      if (payload.kind === "text" && userMessage === null && isUserTextCandidate(event, firstRunSequence)) {
        userMessage = {
          text: payload.text,
          messageId: payload.messageId,
          promotionEligibility: payload.promotionEligibility,
          occurredAt: event.occurredAt,
        };
        continue;
      }
      if (payload.kind === "text") assistantTextCount += 1;
      items.push(event);
    }

    const lastRunActive = run !== null && (run.status === "active" || run.status === "paused");
    const failed = hasError && (run === null || lastRunActive);
    const status: TurnDisplayStatus = failed ? "failed" : (run?.status ?? "unknown");
    const pending = !failed && lastRunActive && assistantTextCount === 0;

    turns.push({
      runId,
      firstSequence: group[0]?.sequence ?? 0,
      userMessage,
      items,
      run,
      status,
      hasError,
      failed,
      pending,
      attempt: run?.attempt ?? 1,
      showRetryEntry: failed && !errorCarriesRetry,
    });
  }

  turns.sort((a, b) => a.firstSequence - b.firstSequence);
  return turns;
}

/** Whether the stream contains at least one task payload (spec §6.7 header entry). */
export function hasTaskEvent(events: readonly TimelineEvent[]): boolean {
  return events.some((event) => event.payload.kind === "task");
}
