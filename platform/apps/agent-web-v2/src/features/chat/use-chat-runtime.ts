import { useCallback, useEffect, useState } from "react";
import type { ApiClient } from "@/lib/api";
import { readStorage, writeStorage } from "@/lib/storage";
import type { ProviderConnectionsResponse, RunAgentSettings, WorkspaceProviderView } from "@/types/workspace";
import { CHAT_RUNTIME_STORAGE_KEY, resolveChatRuntime, runtimeConnectionId, usableConnections } from "./runtime";

/**
 * Chat runtime selection hook (spec §6.4): loads usable provider connections
 * and the workspace default, resolves the effective selection without ever
 * overriding an explicit user choice, and persists manual selections.
 */
export interface ChatRuntimeState {
  status: "loading" | "ready" | "error";
  /** Usable connections only (`enabled && credentialPresent`). */
  connections: WorkspaceProviderView[];
  /** Runtime identifier: `""` or `ws:<connectionId>`. */
  selection: string;
  /** Selected connection id; `null` when unconfigured or invalid. */
  connectionId: string | null;
  /** Manual selection; persisted to localStorage (§6.4.4). */
  select: (connectionId: string) => void;
}

export function useChatRuntime(client: ApiClient): ChatRuntimeState {
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [connections, setConnections] = useState<WorkspaceProviderView[]>([]);
  const [selection, setSelection] = useState("");

  useEffect(() => {
    let disposed = false;
    const controller = new AbortController();
    setStatus("loading");
    (async () => {
      try {
        const [connectionsResponse, settings] = await Promise.all([
          client.request<ProviderConnectionsResponse>("/provider-connections", { signal: controller.signal }),
          client.request<RunAgentSettings>("/run-agent/settings", { signal: controller.signal }),
        ]);
        if (disposed) return;
        const usable = usableConnections(connectionsResponse.connections);
        setConnections(usable);
        setSelection(
          resolveChatRuntime({
            saved: readStorage(CHAT_RUNTIME_STORAGE_KEY),
            usableConnectionIds: usable.map((connection) => connection.id),
            defaultConnectionId: settings.providerConnectionId,
          }),
        );
        setStatus("ready");
      } catch (error) {
        if (disposed || (error instanceof DOMException && error.name === "AbortError")) return;
        // Fail closed (spec §12.6): no usable runtime, sending stays disabled.
        setStatus("error");
      }
    })();
    return () => {
      disposed = true;
      controller.abort();
    };
  }, [client]);

  const select = useCallback((connectionId: string) => {
    const next = connectionId === "" ? "" : `ws:${connectionId}`;
    writeStorage(CHAT_RUNTIME_STORAGE_KEY, next);
    setSelection(next);
  }, []);

  return { status, connections, selection, connectionId: runtimeConnectionId(selection), select };
}
