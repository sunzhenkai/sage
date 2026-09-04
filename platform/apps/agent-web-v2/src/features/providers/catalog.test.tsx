import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createApiClient, type ApiClient } from "@/lib/api";
import { I18nProvider } from "@/lib/i18n";
import { ConnectionFormDialog } from "./connection-form-dialog";

/**
 * Provider catalog assist (spec §8.3): debounced search, cursor pagination
 * with id-dedupe, prefill that never overrides manual edits, snapshot-changed
 * reload, sync polling with 429/403 handling, and combobox keyboard semantics.
 */

interface RecordedRequest {
  url: string;
  method: string;
}

const providersPage1 = {
  items: [
    { providerId: "anthropic", name: "Anthropic" },
    { providerId: "openai", name: "OpenAI" },
  ],
  nextCursor: "p2",
};
const providersPage2 = {
  items: [
    { providerId: "openai", name: "OpenAI" },
    { providerId: "groq", name: "Groq" },
  ],
};
const modelsPage = {
  items: [
    {
      modelId: "claude-1",
      providerId: "anthropic",
      name: "Claude One",
      status: "active",
      capabilities: [],
      effectiveBaseUrl: "https://api.anthropic.com",
    },
  ],
};

function ok(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 });
}

function error(status: number, code: string, extra: Record<string, unknown> = {}): Response {
  return new Response(JSON.stringify({ error: { code, message: code, retryable: false, ...extra } }), { status });
}

interface CatalogHandlers {
  providers?: (url: string, callCount: number) => Response;
  models?: (url: string) => Response;
  syncStart?: () => Response;
  syncAttempt?: (callCount: number) => Response;
}

function createCatalogClient(handlers: CatalogHandlers, requests: RecordedRequest[]): ApiClient {
  let providerCalls = 0;
  let attemptCalls = 0;
  const fetchImpl = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    requests.push({ url, method });
    if (url.startsWith("/v1/provider-catalog/providers")) {
      providerCalls += 1;
      if (handlers.providers) return Promise.resolve(handlers.providers(url, providerCalls));
      return Promise.resolve(ok(url.includes("cursor=p2") ? providersPage2 : providersPage1));
    }
    if (url.startsWith("/v1/provider-catalog/models")) {
      return Promise.resolve(handlers.models ? handlers.models(url) : ok(modelsPage));
    }
    if (url === "/v1/provider-catalog/sync" && method === "POST") {
      return Promise.resolve(
        handlers.syncStart
          ? handlers.syncStart()
          : ok({ attemptId: "a1", trigger: "manual", status: "running", queuedAt: new Date(0).toISOString() }),
      );
    }
    if (url.startsWith("/v1/provider-catalog/sync/")) {
      attemptCalls += 1;
      return Promise.resolve(
        handlers.syncAttempt
          ? handlers.syncAttempt(attemptCalls)
          : ok({ attemptId: "a1", trigger: "manual", status: "running", queuedAt: new Date(0).toISOString() }),
      );
    }
    return Promise.resolve(error(500, "UNEXPECTED"));
  };
  return createApiClient({ fetchImpl });
}

function renderCreateDialog(client: ApiClient) {
  return render(
    <I18nProvider>
      <ConnectionFormDialog client={client} mode={{ kind: "create" }} onClose={() => {}} onSaved={() => {}} />
    </I18nProvider>,
  );
}

/** Scope option queries to a combobox listbox (native <option>s of the adapter select also carry role="option"). */
function comboboxListbox(name: string) {
  return within(screen.getByRole("listbox", { name }));
}

const PROVIDER_LISTBOX = "Pick a provider from the catalog";
const MODEL_LISTBOX = "Pick a model from the catalog";

describe("catalog search", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem("sage.web.locale", "en");
  });

  afterEach(() => cleanup());

  it("debounces the provider query by 250ms", async () => {
    const requests: RecordedRequest[] = [];
    renderCreateDialog(createCatalogClient({}, requests));
    const user = userEvent.setup();

    const input = await screen.findByRole("combobox", { name: "Pick a provider from the catalog" });
    await user.type(input, "ant");
    expect(requests.some((r) => r.url.includes("q=ant"))).toBe(false);
    await waitFor(() => expect(requests.some((r) => r.url.includes("q=ant"))).toBe(true));
  });

  it("merges appended pages deduped by providerId", async () => {
    const requests: RecordedRequest[] = [];
    renderCreateDialog(createCatalogClient({}, requests));
    const user = userEvent.setup();

    const input = await screen.findByRole("combobox", { name: "Pick a provider from the catalog" });
    await user.click(input);
    await comboboxListbox(PROVIDER_LISTBOX).findByRole("option", { name: "Anthropic" });
    await user.click(screen.getByRole("button", { name: "Load more" }));
    await comboboxListbox(PROVIDER_LISTBOX).findByRole("option", { name: "Groq" });

    expect(comboboxListbox(PROVIDER_LISTBOX).getAllByRole("option").map((option) => option.textContent)).toEqual([
      "Anthropic",
      "OpenAI",
      "Groq",
    ]);
    expect(requests.some((r) => r.url.includes("cursor=p2"))).toBe(true);
  });

  it("requires a provider before model search", async () => {
    const requests: RecordedRequest[] = [];
    renderCreateDialog(createCatalogClient({}, requests));
    expect(await screen.findByText("Select a provider above first.")).toBeInTheDocument();
    expect(requests.some((r) => r.url.startsWith("/v1/provider-catalog/models"))).toBe(false);
  });

  it("prefills the form from catalog selections", async () => {
    const requests: RecordedRequest[] = [];
    renderCreateDialog(createCatalogClient({}, requests));
    const user = userEvent.setup();

    const providerInput = await screen.findByRole("combobox", { name: "Pick a provider from the catalog" });
    await user.click(providerInput);
    await user.click(await comboboxListbox(PROVIDER_LISTBOX).findByRole("option", { name: "Anthropic" }));

    expect(screen.getByLabelText("Adapter kind")).toHaveValue("anthropic");
    expect(screen.getByLabelText("Name")).toHaveValue("Anthropic");
    expect(requests.some((r) => r.url.includes("providerId=anthropic") && r.url.includes("status=all"))).toBe(true);

    const modelInput = await screen.findByRole("combobox", { name: "Pick a model from the catalog" });
    await user.click(modelInput);
    await user.click(await comboboxListbox(MODEL_LISTBOX).findByRole("option", { name: "Claude One" }));

    expect(screen.getByLabelText("Model ID")).toHaveValue("claude-1");
    expect(screen.getByLabelText("Model display name (optional)")).toHaveValue("Claude One");
    expect(screen.getByLabelText("Base URL")).toHaveValue("https://api.anthropic.com");
    expect(screen.getByLabelText("Name")).toHaveValue("Anthropic · Claude One");
  });

  it("never overrides fields the user edited manually", async () => {
    const requests: RecordedRequest[] = [];
    renderCreateDialog(createCatalogClient({}, requests));
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText("Name"), "My Name");
    await user.type(screen.getByLabelText("Base URL"), "https://custom.example.com");

    const providerInput = screen.getByRole("combobox", { name: "Pick a provider from the catalog" });
    await user.click(providerInput);
    await user.click(await comboboxListbox(PROVIDER_LISTBOX).findByRole("option", { name: "Anthropic" }));
    expect(screen.getByLabelText("Name")).toHaveValue("My Name");

    const modelInput = await screen.findByRole("combobox", { name: "Pick a model from the catalog" });
    await user.click(modelInput);
    await user.click(await comboboxListbox(MODEL_LISTBOX).findByRole("option", { name: "Claude One" }));

    expect(screen.getByLabelText("Name")).toHaveValue("My Name");
    expect(screen.getByLabelText("Base URL")).toHaveValue("https://custom.example.com");
    expect(screen.getByLabelText("Model ID")).toHaveValue("claude-1");
  });

  it("clears modelName when modelId is edited manually", async () => {
    const requests: RecordedRequest[] = [];
    renderCreateDialog(createCatalogClient({}, requests));
    const user = userEvent.setup();

    const providerInput = await screen.findByRole("combobox", { name: "Pick a provider from the catalog" });
    await user.click(providerInput);
    await user.click(await comboboxListbox(PROVIDER_LISTBOX).findByRole("option", { name: "Anthropic" }));
    const modelInput = await screen.findByRole("combobox", { name: "Pick a model from the catalog" });
    await user.click(modelInput);
    await user.click(await comboboxListbox(MODEL_LISTBOX).findByRole("option", { name: "Claude One" }));
    expect(screen.getByLabelText("Model display name (optional)")).toHaveValue("Claude One");

    const modelIdInput = screen.getByLabelText("Model ID");
    await user.clear(modelIdInput);
    await user.type(modelIdInput, "other-model");
    expect(screen.getByLabelText("Model display name (optional)")).toHaveValue("");
  });

  it("treats 409 as snapshot-changed: notice plus first-page reload, not fatal", async () => {
    const requests: RecordedRequest[] = [];
    let providerCalls = 0;
    const client = createCatalogClient(
      {
        providers: () => {
          providerCalls += 1;
          return providerCalls === 1 ? error(409, "CATALOG_CURSOR_SNAPSHOT_CHANGED") : ok(providersPage1);
        },
      },
      requests,
    );
    renderCreateDialog(client);
    const user = userEvent.setup();

    expect(await screen.findByText("The catalog changed; the latest results were loaded.")).toBeInTheDocument();
    const input = screen.getByRole("combobox", { name: "Pick a provider from the catalog" });
    await user.click(input);
    expect(await comboboxListbox(PROVIDER_LISTBOX).findByRole("option", { name: "Anthropic" })).toBeInTheDocument();
    expect(providerCalls).toBe(2);
  });

  it("supports ArrowDown/ArrowUp/Enter/Escape", async () => {
    const requests: RecordedRequest[] = [];
    renderCreateDialog(createCatalogClient({}, requests));
    const user = userEvent.setup();

    const input = await screen.findByRole("combobox", { name: "Pick a provider from the catalog" });
    await user.click(input);
    await comboboxListbox(PROVIDER_LISTBOX).findByRole("option", { name: "Anthropic" });

    let options = comboboxListbox(PROVIDER_LISTBOX).getAllByRole("option");
    expect(options[0]).toHaveAttribute("aria-selected", "true");
    await user.keyboard("{ArrowDown}");
    options = comboboxListbox(PROVIDER_LISTBOX).getAllByRole("option");
    expect(options[1]).toHaveAttribute("aria-selected", "true");
    await user.keyboard("{ArrowUp}");
    options = comboboxListbox(PROVIDER_LISTBOX).getAllByRole("option");
    expect(options[0]).toHaveAttribute("aria-selected", "true");

    await user.keyboard("{Enter}");
    expect(screen.getByLabelText("Name")).toHaveValue("Anthropic");
    // The provider list closed; the model combobox auto-opened (spec §8.3).
    expect(screen.queryByRole("listbox", { name: PROVIDER_LISTBOX })).not.toBeInTheDocument();

    await user.click(input);
    await comboboxListbox(PROVIDER_LISTBOX).findByRole("option", { name: "Anthropic" });
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("listbox", { name: PROVIDER_LISTBOX })).not.toBeInTheDocument();
    // Escape closes the list, not the dialog.
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});

describe("catalog sync", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem("sage.web.locale", "en");
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  async function flush(ms = 0) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  }

  function clickRefresh() {
    // fireEvent (not userEvent) so no real timers are needed under fake timers.
    fireEvent.click(screen.getByRole("button", { name: "Refresh catalog" }));
  }

  it("polls once per second until a terminal status, then reloads providers", async () => {
    const requests: RecordedRequest[] = [];
    let attemptCalls = 0;
    const client = createCatalogClient(
      {
        syncAttempt: (n) => {
          attemptCalls = n;
          return ok({
            attemptId: "a1",
            trigger: "manual",
            status: n < 2 ? "running" : "succeeded",
            queuedAt: new Date(0).toISOString(),
          });
        },
      },
      requests,
    );
    renderCreateDialog(client);
    await flush();

    clickRefresh();
    await flush();
    expect(screen.getByRole("button", { name: "Refreshing catalog…" })).toBeDisabled();

    await flush(1000);
    expect(attemptCalls).toBe(1);
    await flush(1000);
    expect(attemptCalls).toBe(2);
    await flush();

    // Reloaded the provider first page: initial load + post-sync reload.
    const providerGets = requests.filter((r) => r.url.startsWith("/v1/provider-catalog/providers"));
    expect(providerGets.length).toBe(2);
    expect(screen.getByRole("button", { name: "Refresh catalog" })).toBeEnabled();

    await flush(5000);
    expect(attemptCalls).toBe(2);
  });

  it("stops after at most 10 polls", async () => {
    const requests: RecordedRequest[] = [];
    let attemptCalls = 0;
    const client = createCatalogClient(
      {
        syncAttempt: (n) => {
          attemptCalls = n;
          return ok({ attemptId: "a1", trigger: "manual", status: "running", queuedAt: new Date(0).toISOString() });
        },
      },
      requests,
    );
    renderCreateDialog(client);
    await flush();

    clickRefresh();
    await flush();
    for (let i = 0; i < 10; i += 1) {
      await flush(1000);
    }
    expect(attemptCalls).toBe(10);
    await flush(5000);
    expect(attemptCalls).toBe(10);
    expect(screen.getByRole("button", { name: "Refresh catalog" })).toBeEnabled();
  });

  it("shows the server retryAfterSeconds on 429", async () => {
    const requests: RecordedRequest[] = [];
    const client = createCatalogClient(
      { syncStart: () => error(429, "CATALOG_SYNC_RATE_LIMITED", { retryAfterSeconds: 30 }) },
      requests,
    );
    renderCreateDialog(client);
    await flush();

    clickRefresh();
    await flush();
    expect(screen.getByText("Refreshed too often; retry in 30 seconds.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Refresh catalog" })).toBeEnabled();
  });

  it("defaults to 60 seconds when 429 has no retryAfterSeconds", async () => {
    const requests: RecordedRequest[] = [];
    const client = createCatalogClient({ syncStart: () => error(429, "CATALOG_SYNC_RATE_LIMITED") }, requests);
    renderCreateDialog(client);
    await flush();

    clickRefresh();
    await flush();
    expect(screen.getByText("Refreshed too often; retry in 60 seconds.")).toBeInTheDocument();
  });

  it("shows forbidden on 403", async () => {
    const requests: RecordedRequest[] = [];
    const client = createCatalogClient({ syncStart: () => error(403, "CATALOG_SYNC_FORBIDDEN") }, requests);
    renderCreateDialog(client);
    await flush();

    clickRefresh();
    await flush();
    expect(screen.getByText("You are not allowed to refresh the catalog.")).toBeInTheDocument();
  });
});
