import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createApiClient, type ApiClient } from "@/lib/api";
import { I18nProvider } from "@/lib/i18n";
import type { TaskViewModel } from "@/types/tasks";
import { TasksView } from "./index";

/**
 * Tasks workspace composition (spec §7.2.5, §7.3.2): without a `task` the
 * detail area stays an empty panel; a successful control refreshes the list
 * and the detail together.
 */

function task(overrides: Partial<TaskViewModel> = {}): TaskViewModel {
  return {
    taskId: "t1",
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

function ok(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 });
}

function createMockClient(onRequest?: (url: string, method: string) => void): ApiClient {
  const fetchImpl = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    onRequest?.(url, method);
    if (method === "POST") return Promise.resolve(ok({ accepted: true }));
    if (url === "/v1/tasks") return Promise.resolve(ok({ tasks: [task()] }));
    if (url.endsWith("/events")) return Promise.resolve(ok({ events: [] }));
    if (url.endsWith("/artifacts")) return Promise.resolve(ok({ artifacts: [] }));
    if (url.endsWith("/run-logs")) return Promise.resolve(ok({ attempts: [], events: [] }));
    if (url === "/v1/tasks/t1") return Promise.resolve(ok(task()));
    return Promise.resolve(
      new Response(JSON.stringify({ error: { code: "UNEXPECTED", message: `unexpected ${method} ${url}`, retryable: false } }), {
        status: 500,
      }),
    );
  };
  return createApiClient({ fetchImpl });
}

function renderView(client: ApiClient, taskId?: string) {
  return render(
    <I18nProvider>
      <TasksView client={client} task={taskId} session="s1" />
    </I18nProvider>,
  );
}

describe("TasksView", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem("sage.web.locale", "en");
  });

  afterEach(() => {
    cleanup();
  });

  it("keeps the detail area empty when the URL has no task (spec §7.2.5)", async () => {
    const client = createMockClient();
    renderView(client);
    expect(await screen.findByText("t1")).toBeInTheDocument();
    expect(screen.getByText("Select a task from the list to view details.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Task detail")).not.toBeInTheDocument();
  });

  it("refreshes both the list and the detail after a successful control", async () => {
    const requests: Array<{ url: string; method: string }> = [];
    const client = createMockClient((url, method) => requests.push({ url, method }));
    const user = userEvent.setup();
    renderView(client, "t1");
    await screen.findByText("wf-1");

    await user.click(screen.getByRole("button", { name: "Pause" }));
    await waitFor(() => {
      expect(requests.some((r) => r.method === "POST" && r.url === "/v1/tasks/t1/signals")).toBe(true);
      expect(requests.filter((r) => r.url === "/v1/tasks" && r.method === "GET").length).toBeGreaterThanOrEqual(2);
      expect(requests.filter((r) => r.url === "/v1/tasks/t1" && r.method === "GET").length).toBeGreaterThanOrEqual(2);
    });
  });
});
