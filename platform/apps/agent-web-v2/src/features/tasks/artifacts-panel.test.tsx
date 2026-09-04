import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { createApiClient, type ApiClient } from "@/lib/api";
import { I18nProvider } from "@/lib/i18n";
import type { TaskArtifactView } from "@/types/tasks";
import { ArtifactsPanel } from "./artifacts-panel";

/**
 * Artifacts behavior (spec §7.6): package download link, media-type link
 * rules, and the inline preview of a succeeded task — text renders through
 * splitThinking + Markdown, base64 never renders as text, failures degrade to
 * a notice.
 */

function artifact(overrides: Partial<TaskArtifactView> = {}): TaskArtifactView {
  return { artifactId: "a1", artifactRef: "artifact://a1", name: "output.md", mediaType: "text/markdown", ...overrides };
}

function createMockClient(handler: (url: string) => Response, onRequest?: (url: string) => void): ApiClient {
  const fetchImpl = (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input);
    onRequest?.(url);
    return Promise.resolve(handler(url));
  };
  return createApiClient({ fetchImpl });
}

function renderPanel(client: ApiClient, artifacts: TaskArtifactView[], taskStatus = "succeeded") {
  return render(
    <I18nProvider>
      <ArtifactsPanel client={client} apiBase="/v1" taskId="t1" artifacts={artifacts} taskStatus={taskStatus} />
    </I18nProvider>,
  );
}

function contentResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

describe("ArtifactsPanel", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem("sage.web.locale", "en");
  });

  afterEach(() => {
    cleanup();
  });

  it("links the package artifact with ?download=1 and text artifacts plainly", () => {
    const client = createMockClient(() => contentResponse({}));
    renderPanel(client, [
      artifact({ artifactId: "pkg", name: "output.tar.gz", mediaType: "application/gzip" }),
      artifact({ artifactId: "txt", name: "notes.txt", mediaType: "text/plain" }),
      artifact({ artifactId: "img", name: "plot.png", mediaType: "image/png" }),
    ]);

    expect(screen.getByRole("link", { name: "Download package" })).toHaveAttribute(
      "href",
      "/v1/tasks/t1/artifacts/pkg?download=1",
    );
    expect(screen.getByRole("link", { name: "notes.txt" })).toHaveAttribute("href", "/v1/tasks/t1/artifacts/txt");
    expect(screen.getByRole("link", { name: "plot.png" })).toHaveAttribute(
      "href",
      "/v1/tasks/t1/artifacts/img?download=1",
    );
  });

  it("previews the first text artifact of a succeeded task via Markdown", async () => {
    const requested: string[] = [];
    const client = createMockClient(
      () => contentResponse({ ...artifact(), content: "# Result\n\n**done**", encoding: "utf-8" }),
      (url) => requested.push(url),
    );
    renderPanel(client, [artifact()]);

    expect(await screen.findByRole("heading", { name: "Result" })).toBeInTheDocument();
    expect(screen.getByText("done").tagName).toBe("STRONG");
    expect(requested).toContain("/v1/tasks/t1/artifacts/a1");
  });

  it("splits <think> segments before rendering (spec §7.6.2)", async () => {
    const client = createMockClient(() =>
      contentResponse({ ...artifact(), content: "<think>secret plan</think>Visible answer" }),
    );
    renderPanel(client, [artifact()]);

    expect(await screen.findByText("Visible answer")).toBeInTheDocument();
    expect(screen.getByText("secret plan")).toBeInTheDocument();
  });

  it("never renders base64 content as text", async () => {
    const client = createMockClient(() => contentResponse({ ...artifact(), content: "aGVsbG8=", encoding: "base64" }));
    renderPanel(client, [artifact()]);

    expect(await screen.findByText("This artifact is binary and cannot be previewed as text.")).toBeInTheDocument();
    expect(screen.queryByText("aGVsbG8=")).not.toBeInTheDocument();
  });

  it("shows a notice when the preview request fails", async () => {
    const client = createMockClient(() =>
      contentResponse({ error: { code: "ARTIFACT_STORE_UNAVAILABLE", message: "down", retryable: true } }, 503),
    );
    renderPanel(client, [artifact()]);

    expect(await screen.findByText("Output preview unavailable.")).toBeInTheDocument();
  });

  it("skips the preview entirely for a non-succeeded task", async () => {
    const requested: string[] = [];
    const client = createMockClient(() => contentResponse({}), (url) => requested.push(url));
    renderPanel(client, [artifact()], "failed");

    expect(screen.queryByLabelText("Output preview")).not.toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(requested.some((url) => url.includes("/artifacts/a1"))).toBe(false);
  });
});
