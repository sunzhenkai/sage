import { describe, expect, it } from "vitest";
import type { ModelCatalogItem, ProviderCatalogItem } from "@sage/app-contracts";
import {
  applyModelIdEdit,
  applyModelSelection,
  applyProviderSelection,
  buildConnectionPayload,
  connectionFormFromView,
  defaultAdapterForProvider,
  emptyConnectionForm,
  isPublicHttpsUrl,
  isSyncTerminal,
  mergeCatalogItems,
  syncRetryAfterSeconds,
  validateConnectionForm,
} from "./logic";
import type { WorkspaceProviderView } from "@/types/workspace";

function provider(providerId: string, name = providerId): ProviderCatalogItem {
  return { providerId, name };
}

function model(overrides: Partial<ModelCatalogItem> = {}): ModelCatalogItem {
  return {
    modelId: "claude-1",
    providerId: "anthropic",
    name: "Claude One",
    status: "active",
    capabilities: [],
    ...overrides,
  };
}

describe("mergeCatalogItems (spec §13.6)", () => {
  it("dedupes by key and keeps existing order", () => {
    const merged = mergeCatalogItems([provider("a"), provider("b")], [provider("b"), provider("c")], (p) => p.providerId);
    expect(merged.map((p) => p.providerId)).toEqual(["a", "b", "c"]);
  });
});

describe("catalog selection prefill (spec §8.3)", () => {
  it("defaults anthropic providers to the anthropic adapter", () => {
    expect(defaultAdapterForProvider(provider("anthropic"))).toBe("anthropic");
    expect(defaultAdapterForProvider(provider("openai"))).toBe("openai-compatible");
  });

  it("prefills adapter and name when untouched", () => {
    const next = applyProviderSelection(emptyConnectionForm(), provider("anthropic", "Anthropic"));
    expect(next.catalogProviderId).toBe("anthropic");
    expect(next.adapterKind).toBe("anthropic");
    expect(next.name).toBe("Anthropic");
    expect(next.providerName).toBe("Anthropic");
  });

  it("does not override fields the user edited", () => {
    const state = {
      ...emptyConnectionForm(),
      name: "My Name",
      nameTouched: true,
      adapterKind: "openai-compatible" as const,
      adapterTouched: true,
    };
    const next = applyProviderSelection(state, provider("anthropic", "Anthropic"));
    expect(next.name).toBe("My Name");
    expect(next.adapterKind).toBe("openai-compatible");
  });

  it("prefills modelId/modelName/baseUrl and composes the name when untouched", () => {
    const withProvider = applyProviderSelection(emptyConnectionForm(), provider("anthropic", "Anthropic"));
    const next = applyModelSelection(
      { ...withProvider, nameTouched: false, name: "" },
      "Anthropic",
      model({ effectiveBaseUrl: "https://api.anthropic.com" }),
    );
    expect(next.modelId).toBe("claude-1");
    expect(next.modelName).toBe("Claude One");
    expect(next.baseUrl).toBe("https://api.anthropic.com");
    expect(next.name).toBe("Anthropic · Claude One");
  });

  it("does not override a manually edited baseUrl or name", () => {
    const state = {
      ...emptyConnectionForm(),
      name: "Custom",
      nameTouched: true,
      baseUrl: "https://example.com",
      baseUrlTouched: true,
    };
    const next = applyModelSelection(state, "Anthropic", model({ effectiveBaseUrl: "https://api.anthropic.com" }));
    expect(next.baseUrl).toBe("https://example.com");
    expect(next.name).toBe("Custom");
  });

  it("clears modelName when modelId is edited manually", () => {
    const state = { ...emptyConnectionForm(), modelId: "claude-1", modelName: "Claude One" };
    expect(applyModelIdEdit(state, "claude-1").modelName).toBe("Claude One");
    expect(applyModelIdEdit(state, "gpt-5").modelName).toBe("");
  });
});

describe("buildConnectionPayload (spec §8.2)", () => {
  const base = {
    ...emptyConnectionForm(),
    name: " conn ",
    baseUrl: " https://api.example.com ",
    modelId: " m1 ",
    providerName: " P ",
    modelName: " M ",
  };

  it("create includes the apiKey and trims values", () => {
    expect(buildConnectionPayload({ ...base, apiKey: " k " }, "create")).toEqual({
      name: "conn",
      adapterKind: "openai-compatible",
      baseUrl: "https://api.example.com",
      modelId: "m1",
      apiKey: "k",
      providerName: "P",
      modelName: "M",
    });
  });

  it("edit omits apiKey when empty and includes it when typed", () => {
    const empty = buildConnectionPayload({ ...base, apiKey: "" }, "edit");
    expect("apiKey" in empty).toBe(false);
    expect(buildConnectionPayload({ ...base, apiKey: "new" }, "edit").apiKey).toBe("new");
  });
});

describe("validateConnectionForm", () => {
  it("mirrors the server constraints", () => {
    const valid = {
      ...emptyConnectionForm(),
      name: "n",
      baseUrl: "https://api.example.com",
      modelId: "m",
      apiKey: "k",
    };
    expect(validateConnectionForm(valid, "create")).toEqual([]);
    expect(validateConnectionForm({ ...valid, name: "" }, "create")).toContain("name");
    expect(validateConnectionForm({ ...valid, name: "x".repeat(129) }, "create")).toContain("name");
    expect(validateConnectionForm({ ...valid, baseUrl: "http://api.example.com" }, "create")).toContain("baseUrl");
    expect(validateConnectionForm({ ...valid, modelId: "" }, "create")).toContain("modelId");
    expect(validateConnectionForm({ ...valid, apiKey: "" }, "create")).toContain("apiKey");
    expect(validateConnectionForm({ ...valid, apiKey: "" }, "edit")).toEqual([]);
  });

  it("requires a public HTTPS baseUrl", () => {
    expect(isPublicHttpsUrl("https://api.example.com/v1")).toBe(true);
    expect(isPublicHttpsUrl("http://api.example.com")).toBe(false);
    expect(isPublicHttpsUrl("https://localhost")).toBe(false);
    expect(isPublicHttpsUrl("https://127.0.0.1")).toBe(false);
    expect(isPublicHttpsUrl("not a url")).toBe(false);
  });
});

describe("sync helpers (spec §8.3)", () => {
  it("knows the terminal statuses", () => {
    for (const status of ["succeeded", "not_modified", "failed", "cancelled"]) {
      expect(isSyncTerminal(status)).toBe(true);
    }
    expect(isSyncTerminal("running")).toBe(false);
    expect(isSyncTerminal("queued")).toBe(false);
  });

  it("prefers retryAfterSeconds and defaults to 60", () => {
    expect(syncRetryAfterSeconds(30)).toBe(30);
    expect(syncRetryAfterSeconds(undefined)).toBe(60);
  });
});

describe("connectionFormFromView", () => {
  it("prefills edit forms and treats existing values as user data", () => {
    const view: WorkspaceProviderView = {
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
    const form = connectionFormFromView(view);
    expect(form.name).toBe("Prod");
    expect(form.nameTouched).toBe(true);
    expect(form.adapterKind).toBe("anthropic");
    expect(form.apiKey).toBe("");
  });
});
