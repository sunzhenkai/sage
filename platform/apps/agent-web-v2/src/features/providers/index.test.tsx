import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createApiClient, type ApiClient } from "@/lib/api";
import { I18nProvider } from "@/lib/i18n";
import { ProvidersView } from "./index";

/**
 * Providers page composition (spec §4.1, §8): the page exposes the language
 * switcher, which updates React context and `<html lang>`.
 */

function ok(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 });
}

function createMockClient(): ApiClient {
  const fetchImpl = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    if (url === "/v1/run-agent/settings" && method === "GET") {
      return Promise.resolve(ok({ schemaVersion: "RunAgentSettings.v2", unset: true, providers: [] }));
    }
    if (url === "/v1/provider-connections" && method === "GET") {
      return Promise.resolve(ok({ schemaVersion: "ProviderConnections.v1", connections: [] }));
    }
    return Promise.resolve(
      new Response(JSON.stringify({ error: { code: "UNEXPECTED", message: `unexpected ${method} ${url}` } }), {
        status: 500,
      }),
    );
  };
  return createApiClient({ fetchImpl });
}

describe("ProvidersView", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem("sage.web.locale", "en");
  });

  afterEach(() => cleanup());

  it("renders the default model and connections sections", async () => {
    render(
      <I18nProvider>
        <ProvidersView client={createMockClient()} />
      </I18nProvider>,
    );
    expect(await screen.findByText("Run Agent default model")).toBeInTheDocument();
    expect(screen.getByText("Provider connections")).toBeInTheDocument();
  });

  it("switches the language and updates <html lang>", async () => {
    const user = userEvent.setup();
    render(
      <I18nProvider>
        <ProvidersView client={createMockClient()} />
      </I18nProvider>,
    );
    await screen.findByText("Run Agent default model");
    expect(document.documentElement.lang).toBe("en");

    await user.selectOptions(screen.getByLabelText("Language"), "zh-CN");
    expect(document.documentElement.lang).toBe("zh-CN");
    expect(await screen.findByText("模型提供方")).toBeInTheDocument();
    expect(window.localStorage.getItem("sage.web.locale")).toBe("zh-CN");
  });
});
