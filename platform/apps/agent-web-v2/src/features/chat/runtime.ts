import type { WorkspaceProviderView } from "@/types/workspace";

/**
 * Chat runtime selection (spec §6.4). The browser-local runtime identifier is
 * `""` (unconfigured) or `ws:<providerConnectionId>`, persisted under
 * `sage.chat-runtime.v2`.
 */

export const CHAT_RUNTIME_STORAGE_KEY = "sage.chat-runtime.v2";

/** Only enabled connections with a credential in place are usable by Chat (§6.4.1). */
export function usableConnections(connections: readonly WorkspaceProviderView[]): WorkspaceProviderView[] {
  return connections.filter((connection) => connection.enabled && connection.credentialPresent);
}

/** Parse a stored value into a connection id; `""` or invalid means unconfigured. */
export function parseRuntimeSelection(saved: string): string {
  if (!saved.startsWith("ws:")) return "";
  const id = saved.slice(3);
  return id.length > 0 ? id : "";
}

export interface ResolveRuntimeArgs {
  /** `null` means the browser never saved the key; `""` means explicitly unconfigured. */
  saved: string | null;
  usableConnectionIds: readonly string[];
  defaultConnectionId?: string | undefined;
}

/**
 * Resolve the effective selection (§6.4 rules 3-5):
 * - a saved explicit choice wins and is never silently overridden;
 * - a saved connection that is no longer usable falls back to unconfigured;
 * - only when the key was never saved does the workspace default become the
 *   initial selection.
 *
 * Returns the runtime identifier (`""` or `ws:<id>`).
 */
export function resolveChatRuntime({ saved, usableConnectionIds, defaultConnectionId }: ResolveRuntimeArgs): string {
  if (saved !== null) {
    const id = parseRuntimeSelection(saved);
    if (id === "") return "";
    return usableConnectionIds.includes(id) ? `ws:${id}` : "";
  }
  if (defaultConnectionId && usableConnectionIds.includes(defaultConnectionId)) {
    return `ws:${defaultConnectionId}`;
  }
  return "";
}

/** Extract the connection id from a runtime identifier; `null` when unconfigured. */
export function runtimeConnectionId(selection: string): string | null {
  const id = parseRuntimeSelection(selection);
  return id === "" ? null : id;
}
