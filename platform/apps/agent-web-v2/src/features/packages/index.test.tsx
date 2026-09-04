import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createApiClient, type ApiClient } from "@/lib/api";
import { I18nProvider } from "@/lib/i18n";
import { PackagesView } from "./index";

/**
 * Packages workspace flows (spec §9): list mapping, create validation,
 * sample import idempotency and mutual exclusion, archive upload, run launch
 * form generation, and the two-step delete.
 */

interface RecordedRequest {
  url: string;
  method: string;
  body: unknown;
}

function ok(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function fail(status: number, code: string, message = code): Response {
  return new Response(JSON.stringify({ error: { code, message, retryable: false } }), { status });
}

const DETAIL = {
  appId: "demo-app",
  name: "Demo App",
  description: "demo",
  status: "active",
  createdAt: "2026-08-01T10:00:00Z",
  manifest: {
    id: "demo-app",
    version: "1.0.0",
    description: "demo manifest",
    entry: "prompts/system.md",
    modelRoute: { provider: "minimax-cn", model: "MiniMax-M3" },
    skillRefs: ["skill://repo-digest/v1"],
    capabilityRefs: ["capability://web-snapshot-reader/v1"],
    inputs: [
      { name: "topic", type: "string", required: true },
      { name: "limit", type: "number", default: 10 },
      { name: "lang", type: "enum", enum: ["zh", "en"], default: "zh" },
    ],
    dataSources: [{ name: "trending-snapshot", url: "https://example.com/snapshot" }],
    tasks: [
      { name: "task-a", entry: "prompts/system.md" },
      { name: "task-b", entry: "prompts/system.md" },
    ],
  },
  assets: [
    { relativePath: "prompts/system.md", kind: "prompt", bytes: 512, digest: "sha256:x", preview: "hello prompt" },
    { relativePath: "references/notes.md", kind: "reference", bytes: 2048, digest: "sha256:y" },
  ],
  releases: [
    {
      packageVersion: "1.0.0",
      releaseId: "rel-1",
      contentDigest: "sha256:content",
      compilerBuild: "local-dev",
      createdAt: "2026-09-01T10:00:00Z",
    },
  ],
};

function createMockClient(overrides: {
  apps?: unknown[];
  createAppStatus?: number;
  detail?: unknown;
  runResponse?: Response;
  /** When set, release POSTs wait on this promise (for in-flight guard tests). */
  pendingRelease?: Promise<Response>;
}): { client: ApiClient; requests: RecordedRequest[] } {
  const requests: RecordedRequest[] = [];
  const fetchImpl = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    requests.push({ url, method, body: init?.body });
    if (url === "/v1/apps" && method === "GET") {
      return Promise.resolve(ok({ schemaVersion: "AppList.v1", apps: overrides.apps ?? [] }));
    }
    if (url === "/v1/apps" && method === "POST") {
      const status = overrides.createAppStatus ?? 201;
      return Promise.resolve(
        status === 201
          ? ok({ schemaVersion: "App.v1", appId: "my-app" }, 201)
          : fail(status, "APP_ALREADY_EXISTS", "app already exists"),
      );
    }
    if (url === "/v1/apps/demo-app" && method === "GET") {
      return Promise.resolve(ok(overrides.detail ?? DETAIL));
    }
    if (url === "/v1/apps/demo-app" && method === "DELETE") {
      return Promise.resolve(ok({ schemaVersion: "AppDelete.v1", appId: "demo-app", status: "deleted" }));
    }
    if (method === "POST" && /^\/v1\/apps\/[^/]+\/releases$/.test(url)) {
      if (overrides.pendingRelease) return overrides.pendingRelease;
      const version = url.includes("demo-app") ? "1.1.0" : "2.0.0";
      return Promise.resolve(ok({ schemaVersion: "PackageReleaseResult.v1", status: "stored", packageVersion: version }, 201));
    }
    if (url === "/v1/releases/rel-1/runs" && method === "POST") {
      return Promise.resolve(
        overrides.runResponse ??
          ok(
            {
              schemaVersion: "PackageRunResult.v1",
              status: "admitted",
              taskId: "task-1",
              runId: "run-1",
              attemptId: "attempt-1",
              releaseRef: "release://demo-app/1.0.0",
              releaseId: "rel-1",
              specRef: "spec://1",
              specDigest: "sha256:spec",
              inputRef: "task-input://package/t/1",
            },
            202,
          ),
      );
    }
    return Promise.resolve(fail(500, "UNEXPECTED", `unexpected ${method} ${url}`));
  };
  return { client: createApiClient({ fetchImpl }), requests };
}

function renderView(ui: React.ReactElement) {
  return render(<I18nProvider>{ui}</I18nProvider>);
}

describe("PackagesView", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem("sage.web.locale", "en");
    window.history.replaceState(null, "", "/");
  });

  afterEach(() => cleanup());

  it("maps list fields: appId→packageId, missing latestVersion shows —, updatedAt falls back to createdAt", async () => {
    const { client } = createMockClient({
      apps: [
        {
          appId: "alpha",
          name: "Alpha",
          releaseCount: 2,
          latestVersion: "1.2.0",
          updatedAt: "2026-09-01T10:00:00Z",
          createdAt: "2026-08-01T10:00:00Z",
        },
        { appId: "beta", releaseCount: 0, createdAt: "2026-08-15T08:30:00Z" },
      ],
    });
    renderView(<PackagesView client={client} session="s1" />);

    const alpha = await screen.findByRole("link", { name: /Alpha/ });
    expect(alpha).toHaveAttribute("href", "?view=packages&package=alpha&session=s1");
    expect(alpha).toHaveTextContent("2 releases");
    expect(alpha).toHaveTextContent("1.2.0");

    const beta = screen.getByRole("link", { name: /beta/ });
    expect(beta).toHaveTextContent("Latest: —");
    // updatedAt missing → createdAt drives the row time (full time in title).
    const time = beta.querySelector("[title]");
    expect(time?.getAttribute("title")).toContain("2026");
  });

  it("validates the create form before submitting", async () => {
    const user = userEvent.setup();
    const { client, requests } = createMockClient({});
    renderView(<PackagesView client={client} />);
    await screen.findByText("No apps yet.");

    await user.click(screen.getByRole("button", { name: "Create app" }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText(/App ID is required/)).toBeInTheDocument();
    expect(screen.getByText(/App name is required/)).toBeInTheDocument();
    expect(requests.some((request) => request.method === "POST")).toBe(false);
  });

  it("creates an app, then refreshes and opens its detail", async () => {
    const user = userEvent.setup();
    const { client, requests } = createMockClient({});
    renderView(<PackagesView client={client} />);
    await screen.findByText("No apps yet.");

    await user.click(screen.getByRole("button", { name: "Create app" }));
    await user.type(screen.getByLabelText("App ID"), "my-app");
    await user.type(screen.getByLabelText("App name"), "My App");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(window.location.search).toContain("package=my-app"));
    const create = requests.find((request) => request.url === "/v1/apps" && request.method === "POST");
    expect(JSON.parse(String(create?.body))).toEqual({ appId: "my-app", name: "My App" });
  });

  it("imports a sample idempotently: 409 on create is not a failure", async () => {
    const user = userEvent.setup();
    const { client, requests } = createMockClient({ createAppStatus: 409 });
    renderView(<PackagesView client={client} />);
    await screen.findByText("No apps yet.");

    const githubRow = screen.getByText("GitHub Trending").closest("li");
    const importButton = githubRow?.querySelector("button");
    expect(importButton).not.toBeNull();
    await user.click(importButton as HTMLElement);

    await waitFor(() => expect(window.location.search).toContain("package=github-trending"));
    const release = requests.find((request) => request.url === "/v1/apps/github-trending/releases");
    expect(release).toBeDefined();
    const body = JSON.parse(String(release?.body)) as { files: Record<string, string> };
    expect(body.files["app.yaml"]).toContain("id: github-trending");
    expect(body.files["prompts/system.md"]).toBeTruthy();
  });

  it("blocks importing other samples while one import is in flight", async () => {
    const user = userEvent.setup();
    let releaseResolve: ((response: Response) => void) | undefined;
    const pendingRelease = new Promise<Response>((resolve) => {
      releaseResolve = resolve;
    });
    const { client, requests } = createMockClient({ pendingRelease });
    renderView(<PackagesView client={client} />);
    await screen.findByText("No apps yet.");

    const githubRow = screen.getByText("GitHub Trending").closest("li");
    await user.click(githubRow?.querySelector("button") as HTMLElement);

    // While the import is in flight every sample import button is disabled.
    await waitFor(() => {
      for (const button of screen.getAllByRole("button", { name: /Import/ })) {
        expect(button).toBeDisabled();
      }
    });
    // Clicking another sample is a no-op guarded client-side.
    const financeRow = screen.getByText("Finance Briefing").closest("li");
    await user.click(financeRow?.querySelector("button") as HTMLElement);
    expect(requests.filter((request) => request.method === "POST" && request.url === "/v1/apps")).toHaveLength(1);

    releaseResolve?.(ok({ schemaVersion: "PackageReleaseResult.v1", status: "stored", packageVersion: "2.0.0" }, 201));
    await waitFor(() => expect(window.location.search).toContain("package=github-trending"));
  });

  it("uploads an archive as multipart FormData after client-side validation", async () => {
    const user = userEvent.setup();
    const { client, requests } = createMockClient({});
    renderView(<PackagesView client={client} packageId="demo-app" />);
    await screen.findByText("Demo App");

    await user.click(screen.getByRole("button", { name: "Upload a new version" }));
    await user.click(screen.getByRole("button", { name: "Upload" }));
    expect(await screen.findByText("Choose a file first.")).toBeInTheDocument();

    await user.upload(
      screen.getByLabelText("Archive file"),
      new File(["archive"], "demo.tar", { type: "application/x-tar" }),
    );
    await user.click(screen.getByRole("button", { name: "Upload" }));

    expect(await screen.findByText(/Uploaded successfully, new version 1\.1\.0/)).toBeInTheDocument();
    const upload = requests.find((request) => request.url.endsWith("/releases") && request.method === "POST");
    expect(upload?.body).toBeInstanceOf(FormData);
    const sent = (upload?.body as FormData).get("file");
    expect(sent).toBeInstanceOf(File);
    expect((sent as File).name).toBe("demo.tar");
  });

  it("rejects an archive with a disallowed extension", async () => {
    const user = userEvent.setup();
    const { client, requests } = createMockClient({});
    renderView(<PackagesView client={client} packageId="demo-app" />);
    await screen.findByText("Demo App");

    await user.click(screen.getByRole("button", { name: "Upload a new version" }));
    // `user.upload` honors the accept filter, so set the file list directly
    // to exercise the client-side extension validation.
    fireEvent.change(screen.getByLabelText("Archive file"), { target: { files: [new File(["x"], "notes.txt")] } });
    await user.click(screen.getByRole("button", { name: "Upload" }));

    expect(await screen.findByText(/must end with/)).toBeInTheDocument();
    expect(requests.some((request) => request.method === "POST")).toBe(false);
  });

  it("generates the run form from the manifest and starts a run with converted params", async () => {
    const user = userEvent.setup();
    const { client, requests } = createMockClient({});
    renderView(<PackagesView client={client} packageId="demo-app" session="s1" />);
    await screen.findByText("Demo App");

    // Task select (two declared tasks) and the enum "use default" empty option.
    expect(screen.getByLabelText("Task")).toBeInTheDocument();
    const lang = screen.getByLabelText("lang");
    expect(lang).toHaveValue("");
    expect(screen.getByRole("option", { name: "Use default" })).toBeInTheDocument();

    // Non-finite number → param error, nothing submitted.
    await user.type(screen.getByLabelText(/limit/), "abc");
    await user.click(screen.getByRole("button", { name: "Start" }));
    expect(await screen.findByText("Parameter limit must be a finite number.")).toBeInTheDocument();
    expect(requests.some((request) => request.url.includes("/runs"))).toBe(false);

    // Blank fields are omitted; numbers convert; default task is the first.
    await user.clear(screen.getByLabelText(/limit/));
    await user.type(screen.getByLabelText(/limit/), "42");
    await user.type(screen.getByLabelText(/topic/), "ai");
    await user.click(screen.getByRole("button", { name: "Start" }));

    expect(await screen.findByText(/Run started/)).toBeInTheDocument();
    const run = requests.find((request) => request.url === "/v1/releases/rel-1/runs");
    expect(JSON.parse(String(run?.body))).toEqual({ task: "task-a", params: { limit: 42, topic: "ai" } });
    const link = screen.getByRole("link", { name: "View task" });
    expect(link).toHaveAttribute("href", "?view=tasks&task=task-1&session=s1");
  });

  it("explains PROVIDER_DEPENDENCY_MISSING failures", async () => {
    const user = userEvent.setup();
    const { client } = createMockClient({
      runResponse: fail(409, "PROVIDER_DEPENDENCY_MISSING", "no usable provider connection"),
    });
    renderView(<PackagesView client={client} packageId="demo-app" />);
    await screen.findByText("Demo App");

    await user.click(screen.getByRole("button", { name: "Start" }));
    expect(await screen.findByText(/No usable provider connection could be resolved/)).toBeInTheDocument();
    expect(screen.getByText(/no usable provider connection/)).toBeInTheDocument();
  });

  it("disables run launch until at least one release exists", async () => {
    const { client } = createMockClient({ detail: { ...DETAIL, releases: [], manifest: undefined, assets: undefined } });
    renderView(<PackagesView client={client} packageId="demo-app" />);
    await screen.findByText("Demo App");
    expect(screen.getByText(/Upload at least one release/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Start" })).not.toBeInTheDocument();
  });

  it("deletes an app behind a two-step confirmation and returns to the list", async () => {
    const user = userEvent.setup();
    const { client, requests } = createMockClient({});
    renderView(<PackagesView client={client} packageId="demo-app" />);
    await screen.findByText("Demo App");

    await user.click(screen.getByRole("button", { name: "Delete app" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Delete this app?");
    expect(requests.some((request) => request.method === "DELETE")).toBe(false);

    await user.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(window.location.search).toBe("?view=packages"));
    expect(requests.some((request) => request.url === "/v1/apps/demo-app" && request.method === "DELETE")).toBe(true);
  });
});
