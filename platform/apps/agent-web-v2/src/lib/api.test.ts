import { describe, expect, it, vi } from "vitest";
import { ApiError, createApiClient } from "./api";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("createApiClient", () => {
  it("uses same-origin /v1 base and include credentials", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true }));
    const client = createApiClient({ fetchImpl });
    await client.request("/chat/sessions");
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/v1/chat/sessions");
    expect(init.credentials).toBe("include");
    expect(new Headers(init.headers).has("content-type")).toBe(false);
  });

  it("sets JSON content-type for non-GET with body", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, {}));
    const client = createApiClient({ fetchImpl });
    await client.request("/chat/sessions", { method: "POST", body: {} });
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(new Headers(init.headers).get("content-type")).toBe("application/json");
    expect(init.body).toBe("{}");
  });

  it("does not set content-type for FormData", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, {}));
    const client = createApiClient({ fetchImpl });
    await client.request("/apps/x/releases", { method: "POST", body: new FormData() });
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(new Headers(init.headers).has("content-type")).toBe(false);
    expect(init.body).toBeInstanceOf(FormData);
  });

  it("parses the error contract preferring message, then code, then status", async () => {
    const withMessage = createApiClient({
      fetchImpl: vi.fn().mockResolvedValue(jsonResponse(400, { error: { code: "BAD", message: "nope", retryable: false } })),
    });
    const err1 = await withMessage.request("/x").catch((e: unknown) => e);
    expect(err1).toBeInstanceOf(ApiError);
    expect((err1 as ApiError).message).toBe("nope");
    expect((err1 as ApiError).code).toBe("BAD");

    const withCodeOnly = createApiClient({
      fetchImpl: vi.fn().mockResolvedValue(jsonResponse(409, { error: { code: "CONFLICT" } })),
    });
    const err2 = await withCodeOnly.request("/x").catch((e: unknown) => e);
    expect((err2 as ApiError).message).toBe("CONFLICT");

    const withoutBody = createApiClient({ fetchImpl: vi.fn().mockResolvedValue(new Response(null, { status: 500 })) });
    const err3 = await withoutBody.request("/x").catch((e: unknown) => e);
    expect((err3 as ApiError).message).toBe("HTTP 500");
  });

  it("returns undefined for 204 and parses JSON otherwise", async () => {
    const noContent = createApiClient({ fetchImpl: vi.fn().mockResolvedValue(new Response(null, { status: 204 })) });
    await expect(noContent.request("/x", { method: "DELETE" })).resolves.toBeUndefined();

    const ok = createApiClient({ fetchImpl: vi.fn().mockResolvedValue(jsonResponse(200, { a: 1 })) });
    await expect(ok.request("/x")).resolves.toEqual({ a: 1 });
  });

  it("honors a custom apiBase", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, {}));
    const client = createApiClient({ apiBase: "https://api.example.test/v1", fetchImpl });
    await client.request("/ping");
    expect((fetchImpl.mock.calls[0] as [string])[0]).toBe("https://api.example.test/v1/ping");
  });
});
