import { useCallback, useEffect, useRef, useState } from "react";
import type { ApiClient } from "@/lib/api";
import type {
  TaskArtifactsResponse,
  TaskArtifactView,
  TaskEventsResponse,
  TaskEventView,
  TaskRunLogsView,
  TaskViewModel,
} from "@/types/tasks";

/**
 * Task detail loading (spec §7.2, §13): the detail, timeline, artifacts and
 * run logs load in parallel. A failure of detail/events/artifacts fails the
 * whole detail; a run-logs failure only degrades that panel. A monotonic
 * request token plus AbortController ensures stale or aborted responses never
 * overwrite newer state.
 */

export type TaskDetailStatus = "loading" | "ready" | "error";

export interface TaskDetailState {
  status: TaskDetailStatus;
  /** True while a manual/control-triggered refresh is in flight. */
  refreshing: boolean;
  task: TaskViewModel | null;
  events: TaskEventView[];
  artifacts: TaskArtifactView[];
  runLogs: TaskRunLogsView | null;
  /** The latest run-log fetch failed; previous events are kept (spec §7.2.2). */
  runLogsUnavailable: boolean;
  error: unknown;
}

const INITIAL_STATE: TaskDetailState = {
  status: "loading",
  refreshing: false,
  task: null,
  events: [],
  artifacts: [],
  runLogs: null,
  runLogsUnavailable: false,
  error: null,
};

export function useTaskDetail({ client, taskId }: { client: ApiClient; taskId: string }) {
  const tokenRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const [state, setState] = useState<TaskDetailState>(INITIAL_STATE);

  const load = useCallback(
    async (initial: boolean) => {
      const token = ++tokenRef.current;
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      const isCurrent = () => token === tokenRef.current && !controller.signal.aborted;

      setState((prev) =>
        initial
          ? { ...INITIAL_STATE, runLogs: prev.runLogs }
          : { ...prev, refreshing: true, runLogsUnavailable: false, error: null },
      );

      const base = `/tasks/${encodeURIComponent(taskId)}`;
      const results = await Promise.allSettled([
        client.request<TaskViewModel>(base, { signal: controller.signal }),
        client.request<TaskEventsResponse>(`${base}/events`, { signal: controller.signal }),
        client.request<TaskArtifactsResponse>(`${base}/artifacts`, { signal: controller.signal }),
        client.request<TaskRunLogsView>(`${base}/run-logs`, { signal: controller.signal }),
      ]);
      if (!isCurrent()) return;

      const [detail, events, artifacts, runLogs] = results;
      if (detail.status === "rejected" || events.status === "rejected" || artifacts.status === "rejected") {
        const failure = [detail, events, artifacts].find((result) => result.status === "rejected");
        setState({
          ...INITIAL_STATE,
          status: "error",
          error: failure?.status === "rejected" ? failure.reason : null,
        });
        return;
      }

      setState((prev) => ({
        status: "ready",
        refreshing: false,
        task: detail.value,
        events: events.value.events,
        artifacts: artifacts.value.artifacts,
        runLogs: runLogs.status === "fulfilled" ? runLogs.value : prev.runLogs,
        runLogsUnavailable: runLogs.status === "rejected",
        error: null,
      }));
    },
    [client, taskId],
  );

  useEffect(() => {
    void load(true);
    return () => {
      // Invalidate the token so a late response cannot write after unmount.
      tokenRef.current += 1;
      abortRef.current?.abort();
    };
  }, [load]);

  const refresh = useCallback(() => void load(false), [load]);

  return { ...state, refresh };
}
