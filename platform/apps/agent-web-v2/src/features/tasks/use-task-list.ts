import { useCallback, useEffect, useState } from "react";
import type { ApiClient } from "@/lib/api";
import type { TaskListResponse, TaskViewModel } from "@/types/tasks";
import { buildTaskListPath, type TaskStatusFilter } from "./logic";

/**
 * Task list loading (spec §7.1, §13): the status filter reloads the list,
 * in-flight requests are aborted when the filter changes or the view unmounts,
 * and `reload()` re-fetches the current filter (used after task controls).
 */

export interface TaskListState {
  loading: boolean;
  tasks: TaskViewModel[];
  error: unknown;
}

export function useTaskList({
  client,
  filter,
  reloadToken,
}: {
  client: ApiClient;
  filter: TaskStatusFilter;
  /** External reload trigger (e.g. after a successful task control). */
  reloadToken?: number | undefined;
}) {
  const [internalReload, setInternalReload] = useState(0);
  const [state, setState] = useState<TaskListState>({ loading: true, tasks: [], error: null });

  useEffect(() => {
    const controller = new AbortController();
    setState((prev) => ({ ...prev, loading: true, error: null }));
    client
      .request<TaskListResponse>(buildTaskListPath(filter), { signal: controller.signal })
      .then((response) => {
        if (controller.signal.aborted) return;
        setState({ loading: false, tasks: response.tasks, error: null });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setState({ loading: false, tasks: [], error });
      });
    return () => controller.abort();
  }, [client, filter, reloadToken, internalReload]);

  const reload = useCallback(() => setInternalReload((token) => token + 1), []);

  return { ...state, reload };
}
