import { useCallback, useEffect, useRef, useState } from "react";
import { isTimelineEvent, type Session, type TimelineEvent } from "@sage/app-contracts";
import { ApiError, type ApiClient } from "@/lib/api";
import { mergeTimelineEvents } from "./timeline";
import type { SessionDetailResponse, SessionEventsResponse } from "./types";

/**
 * Chat session restore + realtime stream (spec §6.2, §13):
 * detail → full snapshot → SSE from the latest sequence cursor. SSE `onerror`
 * closes the old connection and rebuilds after 1s with the latest cursor —
 * the browser-native auto-reconnect is never relied on, so a stale URL cursor
 * cannot replay an old range.
 */

export type ConnectionState = "connecting" | "live" | "offline";
export type RestoreState = "loading" | "ready" | "not-found" | "error";

export interface EventSourceLike {
  onopen: (() => void) | null;
  onerror: (() => void) | null;
  addEventListener(type: string, listener: (event: MessageEvent<string>) => void): void;
  close(): void;
}

export type EventSourceFactory = (url: string) => EventSourceLike;

function defaultEventSourceFactory(): EventSourceFactory | null {
  if (typeof EventSource === "undefined") return null;
  return (url) => new EventSource(url) as unknown as EventSourceLike;
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

export interface UseChatSessionOptions {
  client: ApiClient;
  sessionId: string;
  /** Base path for the SSE endpoint; defaults to "/v1". */
  apiBase?: string;
  /** Injectable for tests; `null` forces the offline state. */
  eventSourceFactory?: EventSourceFactory | null;
}

export interface ChatSessionState {
  restore: RestoreState;
  session: Session | null;
  events: TimelineEvent[];
  connection: ConnectionState;
  error: string | null;
}

export function useChatSession({ client, sessionId, apiBase = "/v1", eventSourceFactory }: UseChatSessionOptions) {
  const [state, setState] = useState<ChatSessionState>({
    restore: "loading",
    session: null,
    events: [],
    connection: "connecting",
    error: null,
  });
  const cursorRef = useRef(0);
  const seenRef = useRef(new Set<number>());
  const catchupAbortRef = useRef<AbortController | null>(null);

  const addEvents = useCallback((incoming: readonly TimelineEvent[]) => {
    const fresh = incoming.filter((event) => !seenRef.current.has(event.sequence));
    if (fresh.length === 0) return;
    for (const event of fresh) {
      seenRef.current.add(event.sequence);
      if (event.sequence > cursorRef.current) cursorRef.current = event.sequence;
    }
    setState((prev) => ({ ...prev, events: mergeTimelineEvents(prev.events, fresh) }));
  }, []);

  useEffect(() => {
    let disposed = false;
    const controller = new AbortController();
    let source: EventSourceLike | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    // Reset cursors so StrictMode double-invocation never drops events.
    seenRef.current = new Set();
    cursorRef.current = 0;

    const factory = eventSourceFactory !== undefined ? eventSourceFactory : defaultEventSourceFactory();

    const connect = () => {
      if (disposed) return;
      if (!factory) {
        setState((prev) => ({ ...prev, connection: "offline" }));
        return;
      }
      const url = `${apiBase}/chat/sessions/${encodeURIComponent(sessionId)}/timeline?afterSequence=${cursorRef.current}`;
      source = factory(url);
      source.onopen = () => {
        if (!disposed) setState((prev) => ({ ...prev, connection: "live" }));
      };
      source.addEventListener("timeline", (event) => {
        if (disposed) return;
        try {
          const parsed: unknown = JSON.parse(event.data);
          if (isTimelineEvent(parsed)) addEvents([parsed]);
        } catch {
          // ignore malformed frames; comment frames never reach this listener
        }
      });
      source.onerror = () => {
        if (disposed) return;
        source?.close();
        source = null;
        setState((prev) => ({ ...prev, connection: "offline" }));
        // Rebuild with the latest cursor after 1s (spec §6.2.7, §13.8).
        reconnectTimer = setTimeout(connect, 1000);
      };
    };

    setState({
      restore: "loading",
      session: null,
      events: [],
      connection: factory ? "connecting" : "offline",
      error: null,
    });

    (async () => {
      const path = `/chat/sessions/${encodeURIComponent(sessionId)}`;
      try {
        const detail = await client.request<SessionDetailResponse>(path, { signal: controller.signal });
        if (disposed) return;
        setState((prev) => ({ ...prev, session: detail.session }));
        const snapshot = await client.request<SessionEventsResponse>(`${path}/events?afterSequence=0`, {
          signal: controller.signal,
        });
        if (disposed) return;
        addEvents(snapshot.events);
        setState((prev) => ({ ...prev, restore: "ready" }));
        connect();
      } catch (error) {
        if (disposed || isAbortError(error)) return;
        if (error instanceof ApiError && error.status === 404) {
          setState((prev) => ({ ...prev, restore: "not-found" }));
        } else {
          setState((prev) => ({
            ...prev,
            restore: "error",
            error: error instanceof Error ? error.message : String(error),
          }));
        }
      }
    })();

    return () => {
      disposed = true;
      controller.abort();
      catchupAbortRef.current?.abort();
      source?.close();
      if (reconnectTimer !== null) clearTimeout(reconnectTimer);
    };
  }, [client, sessionId, apiBase, eventSourceFactory, addEvents]);

  /** Incremental catch-up after a successful submit/retry/promote (§6.2); failures are silent. */
  const refresh = useCallback(async () => {
    catchupAbortRef.current?.abort();
    const controller = new AbortController();
    catchupAbortRef.current = controller;
    try {
      const path = `/chat/sessions/${encodeURIComponent(sessionId)}/events?afterSequence=${cursorRef.current}`;
      const response = await client.request<SessionEventsResponse>(path, { signal: controller.signal });
      addEvents(response.events);
    } catch {
      // silent by design (spec §6.2)
    }
  }, [client, sessionId, addEvents]);

  return { ...state, refresh };
}
