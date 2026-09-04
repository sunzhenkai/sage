import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createApiClient, type ApiClient } from "@/lib/api";
import { I18nProvider } from "@/lib/i18n";
import type { TaskRunLogAttemptView, TaskRunLogEventView, TaskRunLogsView } from "@/types/tasks";
import { RunLogPanel } from "./run-log-panel";

/**
 * Run-log panel behavior (spec §7.5, §13): default first attempt, attempt
 * switching with runId/attemptId params, load-more via fromSequence with
 * eventId dedupe, failure keeping existing events, and out-of-order attempt
 * responses never overwriting the newer selection.
 */

function attempt(runId: string, attemptId: string): TaskRunLogAttemptView {
  return {
    runId,
    attemptId,
    eventCount: 2,
    firstSequence: 1,
    lastSequence: 2,
    lastWrittenAt: new Date(0).toISOString(),
  };
}

function event(eventId: string, sequence: number, type = "model.completed"): TaskRunLogEventView {
  return {
    eventId,
    sequence,
    type,
    payload: { model: `m-${eventId}` },
    receiptRefs: [`receipt://${eventId}`],
    artifactRefs: [],
  };
}

function view(overrides: Partial<TaskRunLogsView> = {}): TaskRunLogsView {
  return { attempts: [attempt("r1", "a1")], events: [event("e1", 1)], ...overrides };
}

function ok(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 });
}

function createMockClient(handler: (url: string) => Promise<Response> | Response, onRequest?: (url: string) => void): ApiClient {
  const fetchImpl = (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input);
    onRequest?.(url);
    return Promise.resolve(handler(url));
  };
  return createApiClient({ fetchImpl });
}

function renderPanel(client: ApiClient, initial: TaskRunLogsView | null, unavailable = false) {
  return render(
    <I18nProvider>
      <RunLogPanel client={client} taskId="t1" initial={initial} unavailable={unavailable} />
    </I18nProvider>,
  );
}

describe("RunLogPanel", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem("sage.web.locale", "en");
  });

  afterEach(() => {
    cleanup();
  });

  it("renders sequence, type, payload summary and reference counts (spec §7.5.5)", () => {
    const client = createMockClient(() => ok(view()));
    renderPanel(client, view({ events: [event("e1", 5, "run.completed")] }));

    expect(screen.getByText("#5")).toBeInTheDocument();
    expect(screen.getByText("run.completed")).toBeInTheDocument();
    expect(screen.getByText("model=m-e1")).toBeInTheDocument();
    expect(screen.getByText("receipts 1 · artifacts 0")).toBeInTheDocument();
  });

  it("shows the attempt selector in descending order when multiple attempts exist", () => {
    const client = createMockClient(() => ok(view()));
    renderPanel(
      client,
      view({ attempts: [attempt("r1", "a1"), attempt("r1", "a2")], selected: { runId: "r1", attemptId: "a1" } }),
    );

    const options = screen.getByLabelText("Select attempt").querySelectorAll("option");
    expect(options).toHaveLength(2);
    expect(options[0]?.textContent).toContain("Attempt 2");
    expect(options[1]?.textContent).toContain("Attempt 1");
  });

  it("switches attempts with runId+attemptId and replaces events", async () => {
    const requested: string[] = [];
    const bothAttempts = [attempt("r1", "a1"), attempt("r1", "a2")];
    const client = createMockClient(
      (url) =>
        url.includes("attemptId=a2")
          ? ok(view({ attempts: bothAttempts, selected: { runId: "r1", attemptId: "a2" }, events: [event("e9", 1, "run.failed")] }))
          : ok(view()),
      (url) => requested.push(url),
    );
    const user = userEvent.setup();
    renderPanel(
      client,
      view({ attempts: bothAttempts, selected: { runId: "r1", attemptId: "a1" } }),
    );
    await screen.findByText("model=m-e1");

    await user.selectOptions(screen.getByLabelText("Select attempt"), "r1/a2");
    expect(await screen.findByText("model=m-e9")).toBeInTheDocument();
    expect(screen.queryByText("model=m-e1")).not.toBeInTheDocument();
    expect(requested.some((url) => url === "/v1/tasks/t1/run-logs?runId=r1&attemptId=a2")).toBe(true);
  });

  it("loads more via fromSequence and dedupes by eventId", async () => {
    const requested: string[] = [];
    const client = createMockClient(
      (url) =>
        url.includes("fromSequence=3")
          ? ok(view({ events: [event("e2", 2), event("e3", 3)], nextFromSequence: undefined }))
          : ok(view()),
      (url) => requested.push(url),
    );
    const user = userEvent.setup();
    renderPanel(client, view({ events: [event("e1", 1), event("e2", 2)], nextFromSequence: 3 }));

    await user.click(screen.getByRole("button", { name: "Load more" }));
    await waitFor(() => expect(screen.getByText("model=m-e3")).toBeInTheDocument());
    expect(requested.some((url) => url === "/v1/tasks/t1/run-logs?runId=r1&attemptId=a1&fromSequence=3")).toBe(true);
    // e2 arrived twice but stays once (spec §7.5.1).
    expect(screen.getAllByText("model=m-e2")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Load more" })).not.toBeInTheDocument();
  });

  it("disables load more while a page is in flight", async () => {
    let resolvePage: ((response: Response) => void) | undefined;
    const client = createMockClient((url) =>
      url.includes("fromSequence=")
        ? new Promise<Response>((resolve) => {
            resolvePage = resolve;
          })
        : ok(view()),
    );
    const user = userEvent.setup();
    renderPanel(client, view({ nextFromSequence: 2 }));

    const button = screen.getByRole("button", { name: "Load more" });
    await user.click(button);
    expect(screen.getByRole("button", { name: "Loading…" })).toBeDisabled();
    resolvePage?.(ok(view({ events: [event("e2", 2)] })));
    await waitFor(() => expect(screen.getByText("model=m-e2")).toBeInTheDocument());
  });

  it("keeps loaded events and degrades on failure (spec §7.5.3)", async () => {
    const client = createMockClient((url) =>
      url.includes("fromSequence=")
        ? new Response(JSON.stringify({ error: { code: "RUN_LOG_STORE_UNAVAILABLE", message: "down", retryable: true } }), {
            status: 503,
          })
        : ok(view()),
    );
    const user = userEvent.setup();
    renderPanel(client, view({ nextFromSequence: 2 }));

    await user.click(screen.getByRole("button", { name: "Load more" }));
    expect(await screen.findByText("Run logs are temporarily unavailable.")).toBeInTheDocument();
    expect(screen.getByText("model=m-e1")).toBeInTheDocument();
  });

  it("does not let a superseded attempt response overwrite the newer selection (spec §13)", async () => {
    let resolveSlow: ((response: Response) => void) | undefined;
    const client = createMockClient((url) => {
      if (url.includes("attemptId=a2")) {
        return new Promise<Response>((resolve) => {
          resolveSlow = resolve;
        });
      }
      if (url.includes("attemptId=a1")) return ok(view({ events: [event("e1", 1)] }));
      return ok(view());
    });
    const user = userEvent.setup();
    renderPanel(
      client,
      view({ attempts: [attempt("r1", "a1"), attempt("r1", "a2")], selected: { runId: "r1", attemptId: "a1" } }),
    );
    await screen.findByText("model=m-e1");

    const select = screen.getByLabelText("Select attempt");
    await user.selectOptions(select, "r1/a2");
    await user.selectOptions(select, "r1/a1");
    await screen.findByText("model=m-e1");

    resolveSlow?.(ok(view({ events: [event("e9", 9)] })));
    await waitFor(() => expect(screen.queryByText("model=m-e9")).not.toBeInTheDocument());
    expect(screen.getByText("model=m-e1")).toBeInTheDocument();
  });
});
