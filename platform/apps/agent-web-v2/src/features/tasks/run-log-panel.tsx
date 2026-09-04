import { useCallback, useEffect, useRef, useState } from "react";
import type { ApiClient } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { formatListTime } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { InlineNotice } from "@/components/feedback";
import type { TaskRunLogEventView, TaskRunLogsView } from "@/types/tasks";
import { appendRunLogEvents, buildRunLogsPath, payloadScalarSummary, runLogEventVariant } from "./logic";

/**
 * Run-log panel (spec §7.5): defaults to the first attempt, offers an attempt
 * selector when more than one exists (descending ordinals + last write time),
 * appends pages via `fromSequence` with eventId dedupe, and degrades to a
 * notice on failure without destroying already-loaded events.
 */

interface Selection {
  runId: string;
  attemptId: string;
}

function selectionOf(view: TaskRunLogsView): Selection | undefined {
  return view.selected ?? view.attempts[0];
}

export function RunLogPanel({
  client,
  taskId,
  initial,
  unavailable,
}: {
  client: ApiClient;
  taskId: string;
  initial: TaskRunLogsView | null;
  /** The latest detail-level run-log fetch failed (spec §7.2.2). */
  unavailable: boolean;
}) {
  const { t } = useI18n();
  const [events, setEvents] = useState<readonly TaskRunLogEventView[]>(initial?.events ?? []);
  const [attempts, setAttempts] = useState(initial?.attempts ?? []);
  const [selection, setSelection] = useState<Selection | undefined>(() =>
    initial ? selectionOf(initial) : undefined,
  );
  const [nextFromSequence, setNextFromSequence] = useState<number | undefined>(initial?.nextFromSequence);
  const [failed, setFailed] = useState(unavailable);
  const [loadingMore, setLoadingMore] = useState(false);
  // Monotonic token + AbortController: a stale or superseded incremental
  // response never overwrites newer panel state (spec §13).
  const incrementalTokenRef = useRef(0);
  const incrementalAbortRef = useRef<AbortController | null>(null);

  // Adopt the detail-level snapshot whenever it changes (spec §7.5 default).
  useEffect(() => {
    incrementalTokenRef.current += 1;
    incrementalAbortRef.current?.abort();
    setAttempts(initial?.attempts ?? []);
    setEvents(initial?.events ?? []);
    setSelection(initial ? selectionOf(initial) : undefined);
    setNextFromSequence(initial?.nextFromSequence);
    setFailed(unavailable);
  }, [initial, unavailable]);

  // Abort in-flight incremental requests on unmount / task switch (spec §13).
  useEffect(
    () => () => {
      incrementalTokenRef.current += 1;
      incrementalAbortRef.current?.abort();
    },
    [],
  );

  const fetchLogs = useCallback(
    (sel: Selection, fromSequence: number | undefined, mode: "replace" | "append") => {
      const token = ++incrementalTokenRef.current;
      incrementalAbortRef.current?.abort();
      const controller = new AbortController();
      incrementalAbortRef.current = controller;
      const isCurrent = () => token === incrementalTokenRef.current && !controller.signal.aborted;
      if (mode === "append") setLoadingMore(true);
      client
        .request<TaskRunLogsView>(buildRunLogsPath(taskId, sel, fromSequence), { signal: controller.signal })
        .then((view) => {
          if (!isCurrent()) return;
          setAttempts(view.attempts);
          setSelection(selectionOf(view) ?? sel);
          setEvents((prev) => (mode === "append" ? appendRunLogEvents(prev, view.events) : appendRunLogEvents([], view.events)));
          setNextFromSequence(view.nextFromSequence);
          setFailed(false);
        })
        .catch((error: unknown) => {
          if (!isCurrent()) return;
          if (error instanceof DOMException && error.name === "AbortError") return;
          // Keep already-loaded events; only degrade the panel (spec §7.5.3).
          setFailed(true);
        })
        .finally(() => {
          if (isCurrent() && mode === "append") setLoadingMore(false);
        });
    },
    [client, taskId],
  );

  const onSelectAttempt = (value: string) => {
    const target = attempts.find((attempt) => `${attempt.runId}/${attempt.attemptId}` === value);
    if (!target) return;
    if (selection && target.runId === selection.runId && target.attemptId === selection.attemptId) return;
    setSelection({ runId: target.runId, attemptId: target.attemptId });
    fetchLogs({ runId: target.runId, attemptId: target.attemptId }, undefined, "replace");
  };

  const onLoadMore = () => {
    if (selection === undefined || nextFromSequence === undefined) return;
    fetchLogs(selection, nextFromSequence, "append");
  };

  const orderedAttempts = attempts.map((attempt, index) => ({ attempt, ordinal: index + 1 })).reverse();

  return (
    <section aria-label={t("tasks.runLogsLabel")} className="space-y-2">
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-semibold">{t("tasks.runLogsLabel")}</h3>
        {orderedAttempts.length > 1 && selection ? (
          <select
            aria-label={t("tasks.attemptSelectLabel")}
            className="h-8 rounded-md border border-input bg-transparent px-2 text-xs shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
            value={`${selection.runId}/${selection.attemptId}`}
            onChange={(event) => onSelectAttempt(event.target.value)}
          >
            {orderedAttempts.map(({ attempt, ordinal }) => (
              <option key={`${attempt.runId}/${attempt.attemptId}`} value={`${attempt.runId}/${attempt.attemptId}`}>
                {t("tasks.attemptOption", { n: ordinal, time: formatListTime(attempt.lastWrittenAt) })}
              </option>
            ))}
          </select>
        ) : null}
      </div>

      {failed ? <InlineNotice variant="warning">{t("tasks.runLogsDegraded")}</InlineNotice> : null}

      {events.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t("tasks.noRunLogEvents")}</p>
      ) : (
        <ul className="space-y-1">
          {events.map((event) => {
            const summary = payloadScalarSummary(event.payload);
            return (
              <li key={event.eventId} className="flex flex-wrap items-center gap-2 rounded-md border px-2 py-1 text-xs">
                <span className="font-mono text-muted-foreground">#{event.sequence}</span>
                <Badge variant={runLogEventVariant(event.type)}>{event.type}</Badge>
                {summary ? <span className="min-w-0 flex-1 truncate">{summary}</span> : <span className="flex-1" />}
                <span className="text-muted-foreground">
                  {t("tasks.refsSummary", {
                    receipts: event.receiptRefs?.length ?? 0,
                    artifacts: event.artifactRefs?.length ?? 0,
                  })}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {nextFromSequence !== undefined ? (
        <Button variant="outline" size="sm" onClick={onLoadMore} disabled={loadingMore}>
          {loadingMore ? t("common.loadingMore") : t("common.loadMore")}
        </Button>
      ) : null}
    </section>
  );
}
