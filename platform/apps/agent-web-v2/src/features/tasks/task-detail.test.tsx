import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createApiClient, type ApiClient } from "@/lib/api";
import { I18nProvider } from "@/lib/i18n";
import type { TaskRunLogsView, TaskViewModel } from "@/types/tasks";
import { TaskDetail } from "./task-detail";

/**
 * Task detail behavior (spec §7.2/§7.3, §13): parallel loading where only the
 * detail/events/artifacts legs fail the whole view, control availability from
 * the projection, guarded submissions with list+detail refresh on success,
 * and stale responses never overwriting newer state.
 */

function task(overrides: Partial<TaskViewModel> = {}): TaskViewModel {
  return {
    taskId: "t1",
    taskType: "sage.agent-task.v1",
    workflowId: "wf-1",
    targetId: "target-1",
    attempt: 2,
    status: "running",
    revision: 3,
    projectionUpdatedAt: new Date(0).toISOString(),
    freshness: "fresh",
    targetSnapshot: { targetId: "target-1", environment: "development", namespace: "ns-1", taskQueue: "queue-1" },
    ...overrides,
  };
}

const EMPTY_LOGS: TaskRunLogsView = { attempts: [], events: [] };

interface DetailHandlers {
  task?: (taskId: string) => Promise<Response>;
  events?: (taskId: string) => Promise<Response>;
  artifacts?: (taskId: string) => Promise<Response>;
  runLogs?: (taskId: string) => Promise<Response>;
  control?: (url: string, body: unknown) => Promise<Response>;
  onRequest?: (url: string, method: string) => void;
}

function ok(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 });
}

function fail(status: number, code: string, message: string): Response {
  return new Response(JSON.stringify({ error: { code, message, retryable: false } }), { status });
}

function createDetailClient(handlers: DetailHandlers): ApiClient {
  const fetchImpl = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    handlers.onRequest?.(url, method);
    const detailMatch = /^\/v1\/tasks\/([^/]+)$/.exec(url);
    const eventsMatch = /^\/v1\/tasks\/([^/]+)\/events$/.exec(url);
    const artifactsMatch = /^\/v1\/tasks\/([^/]+)\/artifacts$/.exec(url);
    const runLogsMatch = /^\/v1\/tasks\/([^/]+)\/run-logs(\?.*)?$/.exec(url);
    if (method === "POST") {
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      return handlers.control?.(url, body) ?? Promise.resolve(ok({ accepted: true }));
    }
    if (detailMatch) return handlers.task?.(detailMatch[1] ?? "") ?? Promise.resolve(ok(task({ taskId: detailMatch[1] ?? "t1" })));
    if (eventsMatch) return handlers.events?.(eventsMatch[1] ?? "") ?? Promise.resolve(ok({ events: [] }));
    if (artifactsMatch) return handlers.artifacts?.(artifactsMatch[1] ?? "") ?? Promise.resolve(ok({ artifacts: [] }));
    if (runLogsMatch) return handlers.runLogs?.(runLogsMatch[1] ?? "") ?? Promise.resolve(ok(EMPTY_LOGS));
    return Promise.resolve(fail(500, "UNEXPECTED", `unexpected ${method} ${url}`));
  };
  return createApiClient({ fetchImpl });
}

function renderDetail(client: ApiClient, taskId = "t1", onChanged?: () => void) {
  return render(
    <I18nProvider>
      <TaskDetail client={client} taskId={taskId} onChanged={onChanged} />
    </I18nProvider>,
  );
}

describe("TaskDetail", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem("sage.web.locale", "en");
  });

  afterEach(() => {
    cleanup();
  });

  it("loads the four resources in parallel and shows the projection metadata", async () => {
    const requested: string[] = [];
    const client = createDetailClient({
      onRequest: (url) => requested.push(url),
      events: () => Promise.resolve(ok({ events: [] })),
    });
    renderDetail(client);

    expect(await screen.findByText("wf-1")).toBeInTheDocument();
    expect(screen.getByText("ns-1")).toBeInTheDocument();
    expect(screen.getByText("queue-1")).toBeInTheDocument();
    expect(screen.getByText("Fresh")).toBeInTheDocument();
    expect(screen.getByText("No projection events yet.")).toBeInTheDocument();
    for (const suffix of ["/v1/tasks/t1", "/v1/tasks/t1/events", "/v1/tasks/t1/artifacts", "/v1/tasks/t1/run-logs"]) {
      expect(requested).toContain(suffix);
    }
  });

  it("degrades only the run-log panel when run-logs fail (spec §7.2.2)", async () => {
    const client = createDetailClient({
      runLogs: () => Promise.resolve(fail(503, "RUN_LOG_STORE_UNAVAILABLE", "store down")),
    });
    renderDetail(client);

    expect(await screen.findByText("wf-1")).toBeInTheDocument();
    expect(screen.getByText("Run logs are temporarily unavailable.")).toBeInTheDocument();
    expect(screen.queryByText("Failed to load task details")).not.toBeInTheDocument();
  });

  it("shows the detail error when one of detail/events/artifacts fails", async () => {
    const client = createDetailClient({
      events: () => Promise.resolve(fail(500, "TASK_EVENTS_FAILED", "events exploded")),
    });
    renderDetail(client);

    expect(await screen.findByText("Failed to load task details")).toBeInTheDocument();
    expect(screen.getByText("events exploded")).toBeInTheDocument();
    expect(screen.queryByText("wf-1")).not.toBeInTheDocument();
  });

  it("enables controls from the projection: running → pause/cancel only", async () => {
    const client = createDetailClient({});
    renderDetail(client);
    await screen.findByText("wf-1");

    expect(screen.getByRole("button", { name: "Pause" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Cancel task" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Resume" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Retry task" })).toBeDisabled();
  });

  it("enables retry and shows failure details for a failed task", async () => {
    const client = createDetailClient({
      task: () => Promise.resolve(ok(task({ status: "failed", failureCode: "MODEL_TIMEOUT", failureDetail: "timed out" }))),
    });
    renderDetail(client);
    await screen.findByText("MODEL_TIMEOUT");

    expect(screen.getByRole("button", { name: "Retry task" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Pause" })).toBeDisabled();
    expect(screen.getByText("timed out")).toBeInTheDocument();
  });

  it("disables cancel and shows the effect_unknown disclosure (spec §7.2)", async () => {
    const client = createDetailClient({
      task: () => Promise.resolve(ok(task({ status: "effect_unknown" }))),
    });
    renderDetail(client);
    await screen.findByText("Effect unknown (effect_unknown)");

    expect(screen.getByRole("button", { name: "Cancel task" })).toBeDisabled();
    expect(screen.getByText(/effect resolution/)).toBeInTheDocument();
  });

  it("submits pause once, then refreshes the detail and notifies the list (spec §7.3)", async () => {
    const controlCalls: Array<{ url: string; body: unknown }> = [];
    let resolveControl: (() => void) | undefined;
    let detailGets = 0;
    const onChanged = vi.fn();
    const client = createDetailClient({
      task: () => {
        detailGets += 1;
        return Promise.resolve(ok(task()));
      },
      control: (url, body) => {
        controlCalls.push({ url, body });
        return new Promise<Response>((resolve) => {
          resolveControl = () => resolve(ok({ accepted: true }));
        });
      },
    });
    const user = userEvent.setup();
    renderDetail(client, "t1", onChanged);
    await screen.findByText("wf-1");

    const pause = screen.getByRole("button", { name: "Pause" });
    await user.click(pause);
    // While the control is in flight the guard blocks resubmission.
    await user.click(pause);
    expect(controlCalls).toEqual([{ url: "/v1/tasks/t1/signals", body: { kind: "pause" } }]);
    expect(onChanged).not.toHaveBeenCalled();

    resolveControl?.();
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(detailGets).toBe(2));
  });

  it("surfaces the server error when a control fails", async () => {
    const client = createDetailClient({
      control: () => Promise.resolve(fail(409, "TASK_CONTROL_NOT_APPLICABLE", "not applicable now")),
    });
    const user = userEvent.setup();
    renderDetail(client);
    await screen.findByText("wf-1");

    await user.click(screen.getByRole("button", { name: "Cancel task" }));
    expect(await screen.findByText("not applicable now")).toBeInTheDocument();
  });

  it("suggests refreshing when the timeline is stale and empty (spec §7.4)", async () => {
    const client = createDetailClient({
      task: () => Promise.resolve(ok(task({ freshness: "stale", staleReason: "age_threshold_exceeded" }))),
    });
    renderDetail(client);
    expect(await screen.findByText("The timeline may be stale; try refreshing.")).toBeInTheDocument();
    expect(screen.getByText("Stale")).toBeInTheDocument();
    expect(screen.getByText("age_threshold_exceeded")).toBeInTheDocument();
  });

  it("ignores a stale response after the task switches (spec §13)", async () => {
    let resolveOld: ((response: Response) => void) | undefined;
    const client = createDetailClient({
      task: (taskId) =>
        taskId === "t1"
          ? new Promise<Response>((resolve) => {
              resolveOld = resolve;
            })
          : Promise.resolve(ok(task({ taskId: "t2", workflowId: "wf-new" }))),
    });
    const { rerender } = render(
      <I18nProvider>
        <TaskDetail client={client} taskId="t1" />
      </I18nProvider>,
    );

    rerender(
      <I18nProvider>
        <TaskDetail client={client} taskId="t2" />
      </I18nProvider>,
    );
    expect(await screen.findByText("wf-new")).toBeInTheDocument();

    // The old detail resolves late; it must not overwrite the new state.
    resolveOld?.(ok(task({ taskId: "t1", workflowId: "wf-old" })));
    await waitFor(() => expect(screen.queryByText("wf-old")).not.toBeInTheDocument());
    expect(screen.getByText("wf-new")).toBeInTheDocument();
  });
});
