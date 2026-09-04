import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createApiClient, type ApiClient } from "@/lib/api";
import { I18nProvider } from "@/lib/i18n";
import type { TaskListResponse, TaskViewModel } from "@/types/tasks";
import { TaskList } from "./task-list";

/**
 * Task list behavior (spec §7.1): status filter reloads, client-side search,
 * the running counter, and the empty state linking back to Chat with the
 * session preserved.
 */

interface RecordedRequest {
  url: string;
  method: string;
}

function task(overrides: Partial<TaskViewModel> = {}): TaskViewModel {
  return {
    taskId: "task-1",
    taskType: "sage.agent-task.v1",
    workflowId: "wf-1",
    targetId: "target-1",
    attempt: 1,
    status: "running",
    revision: 1,
    projectionUpdatedAt: new Date(0).toISOString(),
    freshness: "fresh",
    targetSnapshot: { targetId: "target-1", environment: "development", namespace: "ns", taskQueue: "queue" },
    ...overrides,
  };
}

function createMockClient(handlers: {
  list?: (url: string) => TaskListResponse;
  onRequest?: (request: RecordedRequest) => void;
}): ApiClient {
  const fetchImpl = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    handlers.onRequest?.({ url, method });
    if (url.startsWith("/v1/tasks") && method === "GET") {
      return Promise.resolve(new Response(JSON.stringify(handlers.list?.(url) ?? { tasks: [] }), { status: 200 }));
    }
    return Promise.resolve(
      new Response(JSON.stringify({ error: { code: "UNEXPECTED", message: `unexpected ${method} ${url}`, retryable: false } }), {
        status: 500,
      }),
    );
  };
  return createApiClient({ fetchImpl });
}

function renderList(client: ApiClient, props: { currentTask?: string; session?: string } = {}) {
  return render(
    <I18nProvider>
      <TaskList client={client} currentTask={props.currentTask} session={props.session} />
    </I18nProvider>,
  );
}

describe("TaskList", () => {
  let requests: RecordedRequest[];

  beforeEach(() => {
    requests = [];
    window.localStorage.clear();
    window.localStorage.setItem("sage.web.locale", "en");
    window.history.replaceState(null, "", "/");
  });

  afterEach(() => {
    cleanup();
  });

  it("loads without a status parameter for `all`, counts running tasks, marks the current row", async () => {
    const client = createMockClient({
      list: () => ({
        tasks: [
          task({ taskId: "t1", status: "running" }),
          task({ taskId: "t2", status: "running" }),
          task({ taskId: "t3", status: "failed" }),
        ],
      }),
      onRequest: (request) => requests.push(request),
    });
    renderList(client, { currentTask: "t2", session: "s1" });

    expect(await screen.findByText("t1")).toBeInTheDocument();
    expect(screen.getByText("2 running")).toBeInTheDocument();
    expect(requests.some((request) => request.url === "/v1/tasks")).toBe(true);
    expect(requests.some((request) => request.url.includes("status="))).toBe(false);

    const current = screen.getByRole("link", { name: /t2/ });
    expect(current).toHaveAttribute("aria-current", "page");
    expect(current).toHaveAttribute("href", "?view=tasks&task=t2&session=s1");
  });

  it("reloads with a status parameter when the filter changes", async () => {
    const client = createMockClient({
      list: () => ({ tasks: [task()] }),
      onRequest: (request) => requests.push(request),
    });
    const user = userEvent.setup();
    renderList(client);
    await screen.findByText("task-1");

    await user.click(screen.getByRole("button", { name: "Failed" }));
    await waitFor(() => {
      expect(requests.some((request) => request.url === "/v1/tasks?status=failed")).toBe(true);
    });
  });

  it("filters rows client-side by id/type/target, case-insensitively", async () => {
    const client = createMockClient({
      list: () => ({
        tasks: [
          task({ taskId: "Alpha-1", taskType: "sage.agent-task.v1" }),
          task({ taskId: "Beta-2", taskType: "sage.release.v1" }),
        ],
      }),
      onRequest: (request) => requests.push(request),
    });
    const user = userEvent.setup();
    renderList(client);
    await screen.findByText("Alpha-1");
    const loaded = requests.length;

    await user.type(screen.getByLabelText("Search tasks"), "release");
    expect(screen.queryByText("Alpha-1")).not.toBeInTheDocument();
    expect(screen.getByText("Beta-2")).toBeInTheDocument();
    // Client-side search never fires new requests (spec §7.1.2).
    expect(requests.length).toBe(loaded);

    await user.clear(screen.getByLabelText("Search tasks"));
    await user.type(screen.getByLabelText("Search tasks"), "nothing-matches");
    expect(await screen.findByText("No tasks match the search.")).toBeInTheDocument();
  });

  it("shows the empty state linking to Chat and keeps the session", async () => {
    const client = createMockClient({ list: () => ({ tasks: [] }) });
    const user = userEvent.setup();
    renderList(client, { session: "s1" });

    const jump = await screen.findByRole("button", { name: "Go to Chat" });
    expect(screen.getByText("Promote a message to a task from Chat first.")).toBeInTheDocument();
    await user.click(jump);
    expect(window.location.search).toBe("?session=s1");
  });

  it("renders unknown statuses verbatim (spec §7.1)", async () => {
    const client = createMockClient({ list: () => ({ tasks: [task({ status: "weird_state" })] }) });
    renderList(client);
    expect(await screen.findByText(/weird_state/)).toBeInTheDocument();
  });
});
