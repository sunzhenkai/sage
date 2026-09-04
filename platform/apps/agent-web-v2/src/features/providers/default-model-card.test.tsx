import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createApiClient, type ApiClient } from "@/lib/api";
import { I18nProvider } from "@/lib/i18n";
import type { RunAgentSettings } from "@/types/workspace";
import { DefaultModelCard } from "./default-model-card";
import { useRunAgentSettings } from "./use-run-agent-settings";

/**
 * Run Agent default model (spec §8.1): three display states, save-on-select,
 * no duplicate saves while saving, and no save for the empty (unset) value.
 */

function settings(overrides: Partial<RunAgentSettings> = {}): RunAgentSettings {
  return {
    schemaVersion: "RunAgentSettings.v2",
    unset: true,
    providers: [
      { id: "c1", name: "Prod", available: true },
      { id: "c2", name: "Broken", available: false, reason: "missing credential" },
    ],
    ...overrides,
  };
}

function ok(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 });
}

interface RecordedRequest {
  url: string;
  method: string;
  body?: unknown;
}

function createMockClient(options: {
  settings?: RunAgentSettings;
  hangPut?: boolean;
  requests?: RecordedRequest[];
}): ApiClient {
  const fetchImpl = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    options.requests?.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (url === "/v1/run-agent/settings" && method === "GET") {
      return Promise.resolve(ok(options.settings ?? settings()));
    }
    if (url === "/v1/run-agent/settings" && method === "PUT") {
      if (options.hangPut) return new Promise<Response>(() => {});
      const body = JSON.parse(String(init?.body)) as { providerConnectionId: string };
      return Promise.resolve(ok(settings({ unset: false, providerConnectionId: body.providerConnectionId })));
    }
    return Promise.resolve(new Response(JSON.stringify({ error: { code: "UNEXPECTED", message: `unexpected ${method} ${url}` } }), { status: 500 }));
  };
  return createApiClient({ fetchImpl });
}

function Harness({ client }: { client: ApiClient }) {
  const state = useRunAgentSettings(client);
  return <DefaultModelCard state={state} />;
}

describe("DefaultModelCard", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem("sage.web.locale", "en");
  });

  afterEach(() => cleanup());

  it("warns when the default model is unset", async () => {
    render(
      <I18nProvider>
        <Harness client={createMockClient({})} />
      </I18nProvider>,
    );
    expect(await screen.findByText("No default model is set; Run Agent cannot run.")).toBeInTheDocument();
    expect(screen.getByLabelText("Default model")).toHaveValue("");
  });

  it("shows ready when the current setting is available", async () => {
    const client = createMockClient({ settings: settings({ unset: false, providerConnectionId: "c1" }) });
    render(
      <I18nProvider>
        <Harness client={client} />
      </I18nProvider>,
    );
    expect(await screen.findByText("The default model is ready.")).toBeInTheDocument();
    expect(screen.getByLabelText("Default model")).toHaveValue("c1");
  });

  it("warns with the reason when the current setting is unavailable", async () => {
    const client = createMockClient({ settings: settings({ unset: false, providerConnectionId: "c2" }) });
    render(
      <I18nProvider>
        <Harness client={client} />
      </I18nProvider>,
    );
    expect(await screen.findByText(/The current default model is unavailable/)).toBeInTheDocument();
    expect(screen.getByText(/missing credential/)).toBeInTheDocument();
  });

  it("saves immediately when an available connection is selected", async () => {
    const requests: RecordedRequest[] = [];
    const client = createMockClient({ requests });
    const user = userEvent.setup();
    render(
      <I18nProvider>
        <Harness client={client} />
      </I18nProvider>,
    );
    const select = await screen.findByLabelText("Default model");
    await user.selectOptions(select, "c1");
    await screen.findByText("Default model saved.");
    const put = requests.find((r) => r.method === "PUT");
    expect(put?.body).toEqual({ providerConnectionId: "c1" });
  });

  it("blocks re-selection while a save is in flight", async () => {
    const requests: RecordedRequest[] = [];
    const client = createMockClient({ requests, hangPut: true });
    const user = userEvent.setup();
    render(
      <I18nProvider>
        <Harness client={client} />
      </I18nProvider>,
    );
    const select = await screen.findByLabelText("Default model");
    await user.selectOptions(select, "c1");
    await waitFor(() => expect(select).toBeDisabled());
    await user.selectOptions(select, "c1").catch(() => undefined);
    expect(requests.filter((r) => r.method === "PUT")).toHaveLength(1);
  });

  it("never saves for the empty (unset) value", async () => {
    const requests: RecordedRequest[] = [];
    const client = createMockClient({ requests, settings: settings({ unset: false, providerConnectionId: "c1" }) });
    const user = userEvent.setup();
    render(
      <I18nProvider>
        <Harness client={client} />
      </I18nProvider>,
    );
    const select = await screen.findByLabelText("Default model");
    await user.selectOptions(select, "");
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(requests.filter((r) => r.method === "PUT")).toHaveLength(0);
  });
});
