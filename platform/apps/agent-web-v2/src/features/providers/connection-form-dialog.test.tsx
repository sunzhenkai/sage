import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createApiClient, type ApiClient } from "@/lib/api";
import { I18nProvider } from "@/lib/i18n";
import type { WorkspaceProviderView } from "@/types/workspace";
import { ConnectionFormDialog } from "./connection-form-dialog";

/**
 * Connection create/edit dialog (spec §8.2): create submits the full payload
 * including the API key; edit omits `apiKey` unless the user typed a new one;
 * client-side validation mirrors the server constraints.
 */

interface RecordedRequest {
  url: string;
  method: string;
  body?: Record<string, unknown> | undefined;
}

function createMockClient(requests: RecordedRequest[]): ApiClient {
  const fetchImpl = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    requests.push({ url, method, body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined });
    if (url.startsWith("/v1/provider-catalog/")) {
      return Promise.resolve(new Response(JSON.stringify({ items: [] }), { status: 200 }));
    }
    return Promise.resolve(
      new Response(JSON.stringify({ id: "c1", name: "Prod" }), { status: 200 }),
    );
  };
  return createApiClient({ fetchImpl });
}

const editingConnection: WorkspaceProviderView = {
  id: "c1",
  name: "Prod",
  source: "user",
  adapterKind: "anthropic",
  baseUrl: "https://api.anthropic.com",
  modelId: "claude-1",
  providerName: "Anthropic",
  modelName: "Claude One",
  enabled: true,
  credentialPresent: true,
};

function renderDialog(mode: Parameters<typeof ConnectionFormDialog>[0]["mode"], requests: RecordedRequest[], onSaved = vi.fn()) {
  render(
    <I18nProvider>
      <ConnectionFormDialog client={createMockClient(requests)} mode={mode} onClose={() => {}} onSaved={onSaved} />
    </I18nProvider>,
  );
  return onSaved;
}

describe("ConnectionFormDialog", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem("sage.web.locale", "en");
  });

  afterEach(() => cleanup());

  it("creates a connection with the full payload", async () => {
    const requests: RecordedRequest[] = [];
    const onSaved = renderDialog({ kind: "create" }, requests);
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText("Name"), "My Conn");
    await user.type(screen.getByLabelText("Base URL"), "https://api.example.com");
    await user.type(screen.getByLabelText("Model ID"), "m1");
    await user.type(screen.getByLabelText("API key"), "secret");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await vi.waitFor(() => expect(onSaved).toHaveBeenCalled());
    const post = requests.find((r) => r.method === "POST" && r.url === "/v1/provider-connections");
    expect(post?.body).toEqual({
      name: "My Conn",
      adapterKind: "openai-compatible",
      baseUrl: "https://api.example.com",
      modelId: "m1",
      apiKey: "secret",
    });
  });

  it("omits apiKey on edit when left empty, includes it when typed", async () => {
    const requests: RecordedRequest[] = [];
    const onSaved = renderDialog({ kind: "edit", connection: editingConnection }, requests);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Save" }));
    await vi.waitFor(() => expect(onSaved).toHaveBeenCalled());
    const put = requests.find((r) => r.method === "PUT" && r.url === "/v1/provider-connections/c1");
    expect(put?.body).toBeDefined();
    expect(put?.body && "apiKey" in put.body).toBe(false);
    expect(put?.body?.name).toBe("Prod");
    expect(put?.body?.modelName).toBe("Claude One");
  });

  it("includes apiKey on edit only when the user typed a new one", async () => {
    const requests: RecordedRequest[] = [];
    const onSaved = renderDialog({ kind: "edit", connection: editingConnection }, requests);
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText("API key"), "rotated");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await vi.waitFor(() => expect(onSaved).toHaveBeenCalled());
    const put = requests.find((r) => r.method === "PUT");
    expect(put?.body?.apiKey).toBe("rotated");
  });

  it("validates required fields before submitting", async () => {
    const requests: RecordedRequest[] = [];
    renderDialog({ kind: "create" }, requests);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Save" }));
    expect(await screen.findByText("Name is required (1–128 characters).")).toBeInTheDocument();
    expect(screen.getByText("Base URL must be a public HTTPS URL.")).toBeInTheDocument();
    expect(screen.getByText("Model ID is required (1–256 characters).")).toBeInTheDocument();
    expect(screen.getByText("An API key is required to create a connection.")).toBeInTheDocument();
    expect(requests.filter((r) => r.method === "POST")).toHaveLength(0);
  });
});
