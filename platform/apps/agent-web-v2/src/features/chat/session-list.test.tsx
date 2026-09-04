import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ListSessionsResponse, SessionHistoryItem } from "@sage/app-contracts";
import { createApiClient, type ApiClient } from "@/lib/api";
import { I18nProvider } from "@/lib/i18n";
import { SessionList } from "./session-list";

/**
 * Session list behavior (spec §6.1): filter/archive switching reloads page one,
 * search only fires on submit, load-more appends, delete needs two steps, and
 * archive/remove actions drop the row with a success notice.
 */

interface RecordedRequest {
  url: string;
  method: string;
}

function item(sessionId: string, overrides: Partial<SessionHistoryItem> = {}): SessionHistoryItem {
  return {
    schemaVersion: "1",
    sessionId,
    status: "open",
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    retentionEligibleAt: new Date(0).toISOString(),
    ...overrides,
  };
}

function createMockClient(handlers: {
  list?: (url: string) => ListSessionsResponse;
  onRequest?: (request: RecordedRequest) => void;
}): ApiClient {
  const fetchImpl = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    handlers.onRequest?.({ url, method });
    if (url.startsWith("/v1/chat/sessions?") && method === "GET") {
      return Promise.resolve(
        new Response(JSON.stringify(handlers.list?.(url) ?? { schemaVersion: "1", items: [] }), { status: 200 }),
      );
    }
    if (/\/v1\/chat\/sessions\/[^/]+$/.test(url) && method === "DELETE") {
      return Promise.resolve(new Response(null, { status: 204 }));
    }
    if (/\/v1\/chat\/sessions\/[^/]+\/(archive|unarchive)$/.test(url) && method === "POST") {
      return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    }
    return Promise.resolve(
      new Response(JSON.stringify({ error: { code: "UNEXPECTED", message: `unexpected ${method} ${url}`, retryable: false } }), {
        status: 500,
      }),
    );
  };
  return createApiClient({ fetchImpl });
}

function renderList(client: ApiClient) {
  return render(
    <I18nProvider>
      <SessionList client={client} currentSession="s1" />
    </I18nProvider>,
  );
}

describe("SessionList", () => {
  let requests: RecordedRequest[];

  beforeEach(() => {
    requests = [];
    window.localStorage.clear();
    // Pin the locale so assertions don't depend on the jsdom navigator language.
    window.localStorage.setItem("sage.web.locale", "en");
  });

  afterEach(() => {
    cleanup();
  });

  it("loads the first page with limit/status/locale and marks the current session", async () => {
    const client = createMockClient({
      list: () => ({ schemaVersion: "1", items: [item("s1", { title: "Current" }), item("s2", { title: "Other" })] }),
      onRequest: (request) => requests.push(request),
    });
    renderList(client);

    expect(await screen.findByText("Current")).toBeInTheDocument();
    const listUrl = requests.find((request) => request.url.startsWith("/v1/chat/sessions?"))?.url ?? "";
    expect(listUrl).toContain("limit=30");
    expect(listUrl).toContain("status=all");
    expect(listUrl).toContain("locale=");
    const currentLink = screen.getByRole("link", { name: /Current/ });
    expect(currentLink).toHaveAttribute("aria-current", "page");
    expect(currentLink).toHaveAttribute("href", "?session=s1");
  });

  it("shows localized fallbacks for missing title and preview", async () => {
    const client = createMockClient({ list: () => ({ schemaVersion: "1", items: [item("s1")] }) });
    renderList(client);
    expect(await screen.findByText("Untitled Chat")).toBeInTheDocument();
    expect(screen.getByText("No persisted messages yet")).toBeInTheDocument();
  });

  it("reloads when the status filter or archive view changes", async () => {
    const client = createMockClient({
      list: () => ({ schemaVersion: "1", items: [item("s1", { title: "T" })] }),
      onRequest: (request) => requests.push(request),
    });
    const user = userEvent.setup();
    renderList(client);
    await screen.findByText("T");

    await user.click(screen.getByRole("button", { name: "Open" }));
    await waitFor(() => {
      expect(requests.filter((request) => request.url.includes("status=open")).length).toBeGreaterThan(0);
    });

    await user.click(screen.getByRole("button", { name: "Archive" }));
    await waitFor(() => {
      expect(requests.some((request) => request.url.includes("archived=true"))).toBe(true);
    });
  });

  it("does not search while typing; submits the trimmed query on form submit", async () => {
    const client = createMockClient({
      list: () => ({ schemaVersion: "1", items: [item("s1", { title: "T" })] }),
      onRequest: (request) => requests.push(request),
    });
    const user = userEvent.setup();
    renderList(client);
    await screen.findByText("T");
    const initialCount = requests.length;

    await user.type(screen.getByLabelText("Search conversation titles"), "  hello  ");
    expect(requests.length).toBe(initialCount);

    await user.click(screen.getByRole("button", { name: "Search" }));
    await waitFor(() => {
      expect(requests.some((request) => request.url.includes("q=hello"))).toBe(true);
    });
  });

  it("appends the next page via load more with the opaque cursor", async () => {
    const client = createMockClient({
      list: (url) =>
        url.includes("cursor=")
          ? { schemaVersion: "1", items: [item("s2", { title: "Page two" })] }
          : { schemaVersion: "1", items: [item("s1", { title: "Page one" })], nextCursor: "opaque1" },
    });
    const user = userEvent.setup();
    renderList(client);
    await screen.findByText("Page one");

    await user.click(screen.getByRole("button", { name: "Load more" }));
    expect(await screen.findByText("Page two")).toBeInTheDocument();
    expect(screen.getByText("Page one")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Load more" })).not.toBeInTheDocument();
  });

  it("requires two steps to delete and removes the row with a success notice", async () => {
    const client = createMockClient({
      list: () => ({ schemaVersion: "1", items: [item("s1", { title: "Doomed" })] }),
      onRequest: (request) => requests.push(request),
    });
    const user = userEvent.setup();
    renderList(client);
    await screen.findByText("Doomed");

    await user.click(screen.getByRole("button", { name: "Delete: Doomed" }));
    expect(requests.some((request) => request.method === "DELETE")).toBe(false);

    const confirmation = screen.getByRole("alert");
    expect(confirmation).toHaveTextContent("Delete conversation?");

    await user.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(() => {
      expect(screen.queryByText("Doomed")).not.toBeInTheDocument();
    });
    expect(requests.some((request) => request.method === "DELETE" && request.url.includes("/chat/sessions/s1"))).toBe(true);
    expect(await screen.findByText("Conversation deleted.")).toBeInTheDocument();
  });

  it("archives a conversation and removes it from the current list", async () => {
    const client = createMockClient({
      list: () => ({ schemaVersion: "1", items: [item("s1", { title: "Old" })] }),
      onRequest: (request) => requests.push(request),
    });
    const user = userEvent.setup();
    renderList(client);
    await screen.findByText("Old");

    await user.click(screen.getByRole("button", { name: "Archive: Old" }));
    await waitFor(() => {
      expect(screen.queryByText("Old")).not.toBeInTheDocument();
    });
    expect(requests.some((request) => request.method === "POST" && request.url.endsWith("/chat/sessions/s1/archive"))).toBe(true);
    expect(await screen.findByText("Conversation archived.")).toBeInTheDocument();
  });
});
