import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createApiClient, type ApiClient } from "@/lib/api";
import { I18nProvider } from "@/lib/i18n";
import type { ScheduleTriggerHistory, ScheduleView } from "@/types/schedules";
import { SchedulesView } from "./index";

/**
 * Schedules view (spec §10): list field rendering, Pause / Resume / Delete
 * flows with global busy lockout and post-success refresh, trigger history
 * (task links, error codes, empty state), and the §10.3 authentication
 * configuration guidance for both the list and the history branch.
 */

interface RecordedRequest {
  url: string;
  method: string;
}

function ok(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function fail(status: number, code: string, message = code): Response {
  return new Response(JSON.stringify({ error: { code, message, retryable: false } }), { status });
}

function schedule(overrides: Partial<ScheduleView> = {}): ScheduleView {
  return {
    definition: {
      scheduleId: "sched-1",
      trigger: { kind: "cron", expression: "0 9 * * *", timezone: "Asia/Shanghai" },
      releaseBinding: { strategy: "FIXED", releaseId: "rel-1" },
      invocation: { task: "daily-report" },
    },
    state: "ACTIVE",
    nextFireAtMs: Date.UTC(2026, 8, 5, 1, 0, 0),
    ...overrides,
  };
}

const HISTORY: ScheduleTriggerHistory = {
  schemaVersion: "ScheduleTriggerHistory.v1",
  scheduleId: "sched-1",
  events: [
    { occurrenceId: "occ-1", kind: "SUCCEEDED", occurredAtMs: Date.UTC(2026, 8, 4, 1, 0, 0), taskId: "task-1" },
    {
      occurrenceId: "occ-2",
      kind: "FAILED",
      occurredAtMs: Date.UTC(2026, 8, 3, 1, 0, 0),
      errorCode: "SCHEDULE_DISPATCH_FAILED",
    },
  ],
};

function createMockClient(overrides: {
  schedules?: ScheduleView[];
  listResponse?: Response;
  historyResponse?: Response;
  history?: ScheduleTriggerHistory;
  /** When set, control requests wait on this promise (for busy-state tests). */
  pendingControl?: Promise<Response>;
}): { client: ApiClient; requests: RecordedRequest[] } {
  const requests: RecordedRequest[] = [];
  const fetchImpl = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    requests.push({ url, method });
    if (url === "/v1/schedules" && method === "GET") {
      return Promise.resolve(
        overrides.listResponse ?? ok({ schemaVersion: "ScheduleListResult.v1", schedules: overrides.schedules ?? [] }),
      );
    }
    const triggers = /^\/v1\/schedules\/[^/]+\/triggers$/.exec(url);
    if (triggers && method === "GET") {
      return Promise.resolve(overrides.historyResponse ?? ok(overrides.history ?? HISTORY));
    }
    const control = /^\/v1\/schedules\/[^/]+(\/(pause|resume))?$/.exec(url);
    if (control && method !== "GET") {
      if (overrides.pendingControl) return overrides.pendingControl;
      return Promise.resolve(ok({}, method === "DELETE" ? 200 : 200));
    }
    return Promise.resolve(fail(500, "UNEXPECTED", `unexpected ${method} ${url}`));
  };
  return { client: createApiClient({ fetchImpl }), requests };
}

function renderView(ui: React.ReactElement) {
  return render(<I18nProvider>{ui}</I18nProvider>);
}

function listRequests(requests: RecordedRequest[]): RecordedRequest[] {
  return requests.filter((request) => request.url === "/v1/schedules" && request.method === "GET");
}

function historyRequests(requests: RecordedRequest[]): RecordedRequest[] {
  return requests.filter((request) => request.url.endsWith("/triggers"));
}

describe("SchedulesView", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem("sage.web.locale", "en");
    window.history.replaceState(null, "", "/");
  });

  afterEach(() => cleanup());

  it("renders list fields: cron trigger, FIXED binding, ISO next fire, state badge", async () => {
    const { client } = createMockClient({ schedules: [schedule()] });
    renderView(<SchedulesView client={client} />);

    expect(await screen.findByText("sched-1")).toBeInTheDocument();
    expect(screen.getByText("daily-report")).toBeInTheDocument();
    expect(screen.getByText("0 9 * * * (Asia/Shanghai)")).toBeInTheDocument();
    expect(screen.getByText("FIXED rel-1")).toBeInTheDocument();
    expect(screen.getByText("2026-09-05T01:00:00.000Z")).toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
  });

  it("renders interval trigger in minutes, FOLLOW binding, and None for a missing next fire", async () => {
    const { client } = createMockClient({
      schedules: [
        schedule({
          definition: {
            scheduleId: "sched-2",
            trigger: { kind: "interval", everyMs: 30 * 60_000 },
            releaseBinding: { strategy: "FOLLOW" },
            invocation: { task: "poll-feed" },
          },
          state: "PAUSED",
          nextFireAtMs: undefined,
        }),
      ],
    });
    renderView(<SchedulesView client={client} />);

    expect(await screen.findByText("sched-2")).toBeInTheDocument();
    expect(screen.getByText("every 30 minutes")).toBeInTheDocument();
    expect(screen.getByText("FOLLOW")).toBeInTheDocument();
    expect(screen.getByText("None")).toBeInTheDocument();
    expect(screen.getByText("Paused")).toBeInTheDocument();
  });

  it("pauses an ACTIVE schedule: POST pause, then the list refreshes", async () => {
    const user = userEvent.setup();
    const { client, requests } = createMockClient({ schedules: [schedule()] });
    renderView(<SchedulesView client={client} />);
    await screen.findByText("sched-1");

    await user.click(screen.getByRole("button", { name: "Pause: sched-1" }));

    await waitFor(() => expect(requests.some((r) => r.url === "/v1/schedules/sched-1/pause" && r.method === "POST")).toBe(true));
    await waitFor(() => expect(listRequests(requests).length).toBeGreaterThanOrEqual(2));
  });

  it("resumes a non-ACTIVE schedule", async () => {
    const user = userEvent.setup();
    const { client, requests } = createMockClient({ schedules: [schedule({ state: "PAUSED" })] });
    renderView(<SchedulesView client={client} />);
    await screen.findByText("sched-1");

    expect(screen.queryByRole("button", { name: /Pause:/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Resume: sched-1" }));

    await waitFor(() =>
      expect(requests.some((r) => r.url === "/v1/schedules/sched-1/resume" && r.method === "POST")).toBe(true),
    );
  });

  it("locks every schedule action while an operation is in flight", async () => {
    let release!: () => void;
    const pendingControl = new Promise<Response>((resolve) => {
      release = () => resolve(ok({}));
    });
    const user = userEvent.setup();
    const { client } = createMockClient({
      schedules: [schedule(), schedule({ definition: { ...schedule().definition, scheduleId: "sched-2" } })],
      pendingControl,
    });
    renderView(<SchedulesView client={client} />);
    await screen.findByText("sched-2");

    await user.click(screen.getByRole("button", { name: "Pause: sched-1" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Pause: sched-2" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "Delete: sched-2" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "Refresh" })).toBeDisabled();
    });

    release();
    await waitFor(() => expect(screen.getByRole("button", { name: "Pause: sched-2" })).toBeEnabled());
  });

  it("deletes with a two-step confirmation and refreshes the list", async () => {
    const user = userEvent.setup();
    const { client, requests } = createMockClient({ schedules: [schedule()] });
    renderView(<SchedulesView client={client} />);
    await screen.findByText("sched-1");

    await user.click(screen.getByRole("button", { name: "Delete: sched-1" }));
    expect(requests.some((r) => r.method === "DELETE")).toBe(false);
    expect(screen.getByRole("alert")).toHaveTextContent("Delete this schedule?");

    await user.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(() =>
      expect(requests.some((r) => r.url === "/v1/schedules/sched-1" && r.method === "DELETE")).toBe(true),
    );
    await waitFor(() => expect(listRequests(requests).length).toBeGreaterThanOrEqual(2));
  });

  it("keeps the list intact and shows a local error when a control operation fails", async () => {
    const user = userEvent.setup();
    const fetchImpl = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      if (url === "/v1/schedules" && method === "GET") {
        return Promise.resolve(ok({ schemaVersion: "ScheduleListResult.v1", schedules: [schedule()] }));
      }
      if (url.endsWith("/pause")) {
        return Promise.resolve(fail(409, "SCHEDULE_STATE_CONFLICT", "schedule state conflict"));
      }
      return Promise.resolve(fail(500, "UNEXPECTED"));
    };
    renderView(<SchedulesView client={createApiClient({ fetchImpl })} />);
    await screen.findByText("sched-1");

    await user.click(screen.getByRole("button", { name: "Pause: sched-1" }));

    expect(await screen.findByText(/Schedule operation failed: schedule state conflict/)).toBeInTheDocument();
    expect(screen.getByText("sched-1")).toBeInTheDocument();
  });

  it("loads trigger history with task links, kind badges and error codes", async () => {
    const user = userEvent.setup();
    const { client, requests } = createMockClient({ schedules: [schedule()] });
    renderView(<SchedulesView client={client} session="s1" />);
    await screen.findByText("sched-1");

    await user.click(screen.getByRole("button", { name: "Trigger history: sched-1" }));

    expect(await screen.findByText("occ-1")).toBeInTheDocument();
    expect(screen.getByText("Succeeded")).toBeInTheDocument();
    expect(screen.getByText("Failed")).toBeInTheDocument();
    expect(screen.getByText(/SCHEDULE_DISPATCH_FAILED/)).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /task-1/ });
    expect(link).toHaveAttribute("href", "?view=tasks&task=task-1&session=s1");
    expect(historyRequests(requests)).toHaveLength(1);
  });

  it("shows the empty state when there are no trigger events", async () => {
    const user = userEvent.setup();
    const { client } = createMockClient({
      schedules: [schedule()],
      history: { schemaVersion: "ScheduleTriggerHistory.v1", scheduleId: "sched-1", events: [] },
    });
    renderView(<SchedulesView client={client} />);
    await screen.findByText("sched-1");

    await user.click(screen.getByRole("button", { name: "Trigger history: sched-1" }));

    expect(await screen.findByText("No trigger events.")).toBeInTheDocument();
  });

  it("refreshes the expanded trigger history after a successful control operation", async () => {
    const user = userEvent.setup();
    const { client, requests } = createMockClient({ schedules: [schedule()] });
    renderView(<SchedulesView client={client} />);
    await screen.findByText("sched-1");
    await user.click(screen.getByRole("button", { name: "Trigger history: sched-1" }));
    await screen.findByText("occ-1");

    await user.click(screen.getByRole("button", { name: "Pause: sched-1" }));

    await waitFor(() => expect(historyRequests(requests).length).toBeGreaterThanOrEqual(2));
    await waitFor(() => expect(listRequests(requests).length).toBeGreaterThanOrEqual(2));
  });

  it("closes the expanded history instead of refreshing it when the schedule is deleted", async () => {
    const user = userEvent.setup();
    const { client, requests } = createMockClient({ schedules: [schedule()] });
    renderView(<SchedulesView client={client} />);
    await screen.findByText("sched-1");
    await user.click(screen.getByRole("button", { name: "Trigger history: sched-1" }));
    await screen.findByText("occ-1");

    await user.click(screen.getByRole("button", { name: "Delete: sched-1" }));
    await user.click(screen.getByRole("button", { name: "Confirm" }));

    await waitFor(() => expect(listRequests(requests).length).toBeGreaterThanOrEqual(2));
    expect(screen.queryByText("occ-1")).not.toBeInTheDocument();
    expect(historyRequests(requests)).toHaveLength(1);
  });

  it("shows the configuration guidance when the list returns 401", async () => {
    const { client } = createMockClient({ listResponse: fail(401, "UNAUTHENTICATED", "missing token") });
    renderView(<SchedulesView client={client} />);

    expect(await screen.findByText("Schedule service authentication required")).toBeInTheDocument();
    expect(screen.getByText(/SAGE_SERVICE_TOKEN/)).toBeInTheDocument();
    expect(screen.queryByText(/missing token/)).not.toBeInTheDocument();
  });

  it("shows the configuration guidance when the list returns SCHEDULE_AUTHENTICATION_REQUIRED", async () => {
    const { client } = createMockClient({
      listResponse: fail(403, "SCHEDULE_AUTHENTICATION_REQUIRED", "service token not configured"),
    });
    renderView(<SchedulesView client={client} />);

    expect(await screen.findByText("Schedule service authentication required")).toBeInTheDocument();
    expect(screen.queryByText(/service token not configured/)).not.toBeInTheDocument();
  });

  it("shows the configuration guidance inside the history panel on 401", async () => {
    const user = userEvent.setup();
    const { client } = createMockClient({
      schedules: [schedule()],
      historyResponse: fail(401, "SCHEDULE_AUTHENTICATION_REQUIRED", "missing token"),
    });
    renderView(<SchedulesView client={client} />);
    await screen.findByText("sched-1");

    await user.click(screen.getByRole("button", { name: "Trigger history: sched-1" }));

    expect(await screen.findByText("Schedule service authentication required")).toBeInTheDocument();
    expect(screen.queryByText(/missing token/)).not.toBeInTheDocument();
  });

  it("shows the raw error for non-authentication list failures", async () => {
    const { client } = createMockClient({ listResponse: fail(500, "SCHEDULE_UNAVAILABLE", "schedule store down") });
    renderView(<SchedulesView client={client} />);

    expect(await screen.findByText("Failed to load the schedule list")).toBeInTheDocument();
    expect(screen.getByText(/schedule store down/)).toBeInTheDocument();
  });
});
