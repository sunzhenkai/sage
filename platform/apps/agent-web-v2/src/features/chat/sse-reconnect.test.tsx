import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import type { Session, TimelineEvent } from "@sage/app-contracts";
import { createApiClient, type ApiClient } from "@/lib/api";
import { useChatSession, type EventSourceFactory, type EventSourceLike } from "./use-chat-session";

/**
 * SSE reconnect behavior (spec §6.2.7, §13.8): on `onerror` the old connection
 * is closed and a brand-new EventSource is created 1s later with the latest
 * sequence cursor — the browser-native auto-reconnect is never used.
 */

class MockEventSource implements EventSourceLike {
  static instances: MockEventSource[] = [];
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  readonly url: string;
  private listeners = new Map<string, Array<(event: MessageEvent<string>) => void>>();

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: (event: MessageEvent<string>) => void): void {
    const list = this.listeners.get(type) ?? [];
    list.push(listener);
    this.listeners.set(type, list);
  }

  close(): void {
    this.closed = true;
  }

  emitTimeline(event: TimelineEvent): void {
    for (const listener of this.listeners.get("timeline") ?? []) {
      listener(new MessageEvent<string>("timeline", { data: JSON.stringify(event) }));
    }
  }
}

const session: Session = {
  schemaVersion: "1",
  sessionId: "s1",
  status: "open",
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
};

function timelineEvent(sequence: number): TimelineEvent {
  return {
    schemaVersion: "1",
    sessionId: "s1",
    runId: "r1",
    sequence,
    occurredAt: new Date(0).toISOString(),
    payload: { kind: "text", text: `event ${sequence}` },
  };
}

function createClient(): ApiClient {
  const fetchImpl = (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input);
    if (url.endsWith("/chat/sessions/s1")) {
      return Promise.resolve(new Response(JSON.stringify({ session }), { status: 200 }));
    }
    if (url.includes("/chat/sessions/s1/events")) {
      return Promise.resolve(new Response(JSON.stringify({ events: [timelineEvent(1)] }), { status: 200 }));
    }
    return Promise.resolve(new Response(JSON.stringify({ error: { code: "X", message: "no", retryable: false } }), { status: 404 }));
  };
  return createApiClient({ fetchImpl });
}

function Harness({ client, factory }: { client: ApiClient; factory: EventSourceFactory }) {
  const { restore, connection, events } = useChatSession({ client, sessionId: "s1", eventSourceFactory: factory });
  return (
    <div>
      <span data-testid="restore">{restore}</span>
      <span data-testid="connection">{connection}</span>
      <span data-testid="sequences">{events.map((event) => event.sequence).join(",")}</span>
    </div>
  );
}

async function flush(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
  });
}

describe("useChatSession SSE lifecycle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    MockEventSource.instances = [];
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("restores the snapshot, connects from the latest cursor, and rebuilds 1s after onerror with the advanced cursor", async () => {
    const factory: EventSourceFactory = (url) => new MockEventSource(url);
    render(<Harness client={createClient()} factory={factory} />);

    await flush();
    await flush();

    expect(screen.getByTestId("restore").textContent).toBe("ready");
    expect(screen.getByTestId("sequences").textContent).toBe("1");
    expect(MockEventSource.instances).toHaveLength(1);
    const first = MockEventSource.instances[0]!;
    expect(first.url).toBe("/v1/chat/sessions/s1/timeline?afterSequence=1");
    expect(screen.getByTestId("connection").textContent).toBe("connecting");

    act(() => {
      first.onopen?.();
    });
    expect(screen.getByTestId("connection").textContent).toBe("live");

    act(() => {
      first.emitTimeline(timelineEvent(2));
    });
    expect(screen.getByTestId("sequences").textContent).toBe("1,2");

    // Duplicate sequence is ignored.
    act(() => {
      first.emitTimeline(timelineEvent(2));
    });
    expect(screen.getByTestId("sequences").textContent).toBe("1,2");

    act(() => {
      first.onerror?.();
    });
    expect(first.closed).toBe(true);
    expect(screen.getByTestId("connection").textContent).toBe("offline");
    // No reconnect before the 1s delay.
    expect(MockEventSource.instances).toHaveLength(1);

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(MockEventSource.instances).toHaveLength(2);
    const second = MockEventSource.instances[1]!;
    expect(second.url).toBe("/v1/chat/sessions/s1/timeline?afterSequence=2");
  });

  it("stays offline but keeps the snapshot when EventSource is unsupported", async () => {
    render(<UnsupportedHarness client={createClient()} />);
    await flush();
    await flush();
    expect(screen.getByTestId("restore").textContent).toBe("ready");
    expect(screen.getByTestId("connection").textContent).toBe("offline");
    expect(screen.getByTestId("sequences").textContent).toBe("1");
  });

  it("marks a 404 detail response as not-found without opening a stream", async () => {
    const failing = createApiClient({
      fetchImpl: () =>
        Promise.resolve(
          new Response(JSON.stringify({ error: { code: "CHAT_SESSION_NOT_FOUND", message: "gone", retryable: false } }), {
            status: 404,
          }),
        ),
    });
    render(<Harness client={failing} factory={(url) => new MockEventSource(url)} />);
    await flush();
    await flush();
    expect(screen.getByTestId("restore").textContent).toBe("not-found");
    expect(MockEventSource.instances).toHaveLength(0);
  });
});

function UnsupportedHarness({ client }: { client: ApiClient }) {
  const { restore, connection, events } = useChatSession({ client, sessionId: "s1", eventSourceFactory: null });
  return (
    <div>
      <span data-testid="restore">{restore}</span>
      <span data-testid="connection">{connection}</span>
      <span data-testid="sequences">{events.map((event) => event.sequence).join(",")}</span>
    </div>
  );
}
