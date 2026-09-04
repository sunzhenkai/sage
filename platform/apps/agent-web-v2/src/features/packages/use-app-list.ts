import { useCallback, useEffect, useState } from "react";
import type { ApiClient } from "@/lib/api";
import type { AppListResponse, PackageSummaryView } from "@/types/packages";
import { toPackageSummary } from "./logic";

/**
 * App list loading (spec §9.1): fetch on mount, map to UI summaries, reload
 * after every successful mutation. In-flight requests are aborted on
 * unmount/reload so stale responses never overwrite newer state (§13.1-2).
 */
export function useAppList(client: ApiClient) {
  const [apps, setApps] = useState<PackageSummaryView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    client
      .request<AppListResponse>("/apps", { signal: controller.signal })
      .then((data) => {
        if (controller.signal.aborted) return;
        setApps(data.apps.map(toPackageSummary));
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

  return { apps, loading, error, reload };
}
