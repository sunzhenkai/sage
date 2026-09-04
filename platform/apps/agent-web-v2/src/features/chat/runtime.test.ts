import { describe, expect, it } from "vitest";
import type { WorkspaceProviderView } from "@/types/workspace";
import { parseRuntimeSelection, resolveChatRuntime, runtimeConnectionId, usableConnections } from "./runtime";

function connection(id: string, overrides: Partial<WorkspaceProviderView> = {}): WorkspaceProviderView {
  return {
    id,
    name: id,
    source: "user",
    adapterKind: "openai-compatible",
    baseUrl: "https://example.com",
    modelId: "m",
    enabled: true,
    credentialPresent: true,
    ...overrides,
  };
}

describe("usableConnections", () => {
  it("keeps only enabled connections with a credential present", () => {
    const all = [
      connection("a"),
      connection("b", { enabled: false }),
      connection("c", { credentialPresent: false }),
    ];
    expect(usableConnections(all).map((entry) => entry.id)).toEqual(["a"]);
  });
});

describe("resolveChatRuntime", () => {
  it("uses the workspace default only when the key was never saved", () => {
    expect(
      resolveChatRuntime({ saved: null, usableConnectionIds: ["a", "b"], defaultConnectionId: "b" }),
    ).toBe("ws:b");
  });

  it("never overrides an explicit saved selection with the default", () => {
    expect(
      resolveChatRuntime({ saved: "ws:a", usableConnectionIds: ["a", "b"], defaultConnectionId: "b" }),
    ).toBe("ws:a");
  });

  it("keeps an explicit unconfigured choice even when a default exists", () => {
    expect(resolveChatRuntime({ saved: "", usableConnectionIds: ["a"], defaultConnectionId: "a" })).toBe("");
  });

  it("falls back to unconfigured when the saved connection is no longer usable", () => {
    expect(
      resolveChatRuntime({ saved: "ws:gone", usableConnectionIds: ["a"], defaultConnectionId: "a" }),
    ).toBe("");
  });

  it("returns unconfigured when no default is set or the default is unusable", () => {
    expect(resolveChatRuntime({ saved: null, usableConnectionIds: ["a"] })).toBe("");
    expect(resolveChatRuntime({ saved: null, usableConnectionIds: ["a"], defaultConnectionId: "gone" })).toBe("");
  });

  it("treats malformed saved values as unconfigured", () => {
    expect(resolveChatRuntime({ saved: "bogus", usableConnectionIds: ["a"], defaultConnectionId: "a" })).toBe("");
    expect(resolveChatRuntime({ saved: "ws:", usableConnectionIds: ["a"] })).toBe("");
  });
});

describe("runtime identifier helpers", () => {
  it("round-trips ws identifiers", () => {
    expect(parseRuntimeSelection("ws:abc")).toBe("abc");
    expect(parseRuntimeSelection("")).toBe("");
    expect(runtimeConnectionId("ws:abc")).toBe("abc");
    expect(runtimeConnectionId("")).toBeNull();
  });
});
