import { useCallback, useEffect, useState } from "react";
import type { ApiClient } from "@/lib/api";
import type { AppDetailResponse } from "@/types/packages";

/**
 * App detail loading (spec §9.3): fetch on mount and after mutations. The
 * request is aborted on unmount or app change, so navigating back to the
 * list leaves no detail state behind (§13.2-3).
 */
export function useAppDetail(client: ApiClient, appId: string) {
  const [detail, setDetail] = useState<AppDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    client
      .request<AppDetailResponse>(`/apps/${encodeURIComponent(appId)}`, { signal: controller.signal })
      .then((data) => {
        if (controller.signal.aborted) return;
        setDetail(data);
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
  }, [client, appId, reloadToken]);

  const reload = useCallback(() => setReloadToken((token) => token + 1), []);

  return { detail, loading, error, reload };
}
