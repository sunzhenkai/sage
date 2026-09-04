import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ApiError } from "@/lib/api";
import { I18nProvider } from "@/lib/i18n";
import type { WorkspaceProviderView } from "@/types/workspace";
import { ConnectionList } from "./connection-list";

/**
 * Workspace provider connections (spec §8.2): deployment-env connections are
 * read-only, user connections delete with a two-step confirmation, deleting
 * the current default model warns, and a 409 from the server is surfaced.
 */

function connection(overrides: Partial<WorkspaceProviderView> = {}): WorkspaceProviderView {
  return {
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
    ...overrides,
  };
}

function renderList(props: Partial<Parameters<typeof ConnectionList>[0]> = {}) {
  return render(
    <I18nProvider>
      <ConnectionList
        connections={[connection()]}
        loading={false}
        error={null}
        onAdd={() => {}}
        onEdit={() => {}}
        onDelete={() => Promise.resolve()}
        onDeleted={() => {}}
        {...props}
      />
    </I18nProvider>,
  );
}

describe("ConnectionList", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem("sage.web.locale", "en");
  });

  afterEach(() => cleanup());

  it("shows name, display names, source and credential state — never the key", () => {
    renderList();
    expect(screen.getByText("Prod")).toBeInTheDocument();
    expect(screen.getByText("Anthropic · Claude One")).toBeInTheDocument();
    expect(screen.getByText("User")).toBeInTheDocument();
    expect(screen.getByText("Credential configured")).toBeInTheDocument();
  });

  it("keeps deployment-env connections read-only", () => {
    renderList({ connections: [connection({ id: "env1", name: "Env", source: "deployment-env" })] });
    expect(screen.getByText("Deployment env")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Edit:/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Delete:/ })).not.toBeInTheDocument();
  });

  it("deletes with a two-step confirmation and notifies", async () => {
    const onDelete = vi.fn(() => Promise.resolve());
    const onDeleted = vi.fn();
    const user = userEvent.setup();
    renderList({ onDelete, onDeleted });

    await user.click(screen.getByRole("button", { name: "Delete: Prod" }));
    expect(onDelete).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("Delete this connection?");

    await user.click(screen.getByRole("button", { name: "Confirm" }));
    expect(onDelete).toHaveBeenCalledWith("c1");
    expect(onDeleted).toHaveBeenCalled();
  });

  it("warns when deleting the current default model", async () => {
    const user = userEvent.setup();
    renderList({ defaultConnectionId: "c1" });
    await user.click(screen.getByRole("button", { name: "Delete: Prod" }));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "This connection is the current default model; deleting it affects the default model.",
    );
  });

  it("surfaces the server error on 409 PROVIDER_CONNECTION_IN_USE", async () => {
    const onDelete = vi.fn(() =>
      Promise.reject(
        new ApiError(409, { code: "PROVIDER_CONNECTION_IN_USE", message: "connection is in use", retryable: false }),
      ),
    );
    const user = userEvent.setup();
    renderList({ onDelete });
    await user.click(screen.getByRole("button", { name: "Delete: Prod" }));
    await user.click(screen.getByRole("button", { name: "Confirm" }));
    expect(await screen.findByText(/connection is in use/)).toBeInTheDocument();
  });
});
