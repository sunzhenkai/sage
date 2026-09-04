import { useCallback, useEffect, useState } from "react";
import type { ApiClient } from "@/lib/api";
import type { ScheduleListResult, ScheduleView } from "@/types/schedules";

/**
 * Schedule list (spec §10.1): load on mount, manual/after-mutation reload via
 * `reload`, in-flight requests aborted on unmount or superseding reload
 * (spec §13.2). Reload keeps the current rows on screen (no spinner flash).
 */
export function useSchedules(client: ApiClient) {
  const [schedules, setSchedules] = useState<ScheduleView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    client
      .request<ScheduleListResult>("/schedules", { signal: controller.signal })
      .then((data) => {
        if (controller.signal.aborted) return;
        setSchedules(data.schedules);
        setError(null);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setError(err);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [client, reloadToken]);

  const reload = useCallback(() => setReloadToken((token) => token + 1), []);

  return { schedules, loading, error, reload };
}
