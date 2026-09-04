import { useCallback, useEffect, useRef, useState } from "react";
import type { ApiClient } from "@/lib/api";
import type { ProviderConnectionsResponse, WorkspaceProviderView } from "@/types/workspace";

/**
 * Workspace provider connections (spec §8.2): list on mount, reload after
 * every successful mutation, and a re-entrancy guard on delete (spec §13.7).
 * API keys are write-only — they are never read back into this state.
 */
export function useProviderConnections(client: ApiClient) {
  const [connections, setConnections] = useState<WorkspaceProviderView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const deletingRef = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    client
      .request<ProviderConnectionsResponse>("/provider-connections", { signal: controller.signal })
      .then((data) => {
        if (controller.signal.aborted) return;
        setConnections(data.connections);
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

  const remove = useCallback(
    async (id: string): Promise<void> => {
      if (deletingRef.current) return;
      deletingRef.current = true;
      try {
        await client.request<void>(`/provider-connections/${encodeURIComponent(id)}`, { method: "DELETE" });
        reload();
      } finally {
        deletingRef.current = false;
      }
    },
    [client, reload],
  );

  return { connections, loading, error, reload, remove };
}
