import type { ModelCatalogItem, ProviderCatalogItem } from "@sage/app-contracts";
import type { WorkspaceProviderView } from "@/types/workspace";

/**
 * Pure logic for the Providers view (spec §8). Everything here is
 * framework-free so it can be unit-tested without a DOM:
 * - catalog pagination dedupe merge (spec §13.6);
 * - catalog selection prefill rules that never override fields the user
 *   edited by hand (spec §8.3 "选择行为");
 * - create/edit payload building (edit omits `apiKey` unless typed);
 * - sync attempt terminal states (spec §8.3 "Catalog 刷新").
 */

export type AdapterKind = WorkspaceProviderView["adapterKind"];

/** Connection form state; `*Touched` marks fields the user edited manually. */
export interface ConnectionFormState {
  name: string;
  nameTouched: boolean;
  adapterKind: AdapterKind;
  adapterTouched: boolean;
  baseUrl: string;
  baseUrlTouched: boolean;
  modelId: string;
  modelName: string;
  providerName: string;
  apiKey: string;
  /** Catalog provider id once a provider was picked from the catalog. */
  catalogProviderId: string | null;
}

export function emptyConnectionForm(): ConnectionFormState {
  return {
    name: "",
    nameTouched: false,
    adapterKind: "openai-compatible",
    adapterTouched: false,
    baseUrl: "",
    baseUrlTouched: false,
    modelId: "",
    modelName: "",
    providerName: "",
    apiKey: "",
    catalogProviderId: null,
  };
}

/** Edit mode prefills from the connection; prefilled fields count as user data. */
export function connectionFormFromView(view: WorkspaceProviderView): ConnectionFormState {
  return {
    name: view.name,
    nameTouched: true,
    adapterKind: view.adapterKind,
    adapterTouched: true,
    baseUrl: view.baseUrl,
    baseUrlTouched: true,
    modelId: view.modelId,
    modelName: view.modelName ?? "",
    providerName: view.providerName ?? "",
    apiKey: "",
    catalogProviderId: null,
  };
}

/** `anthropic` catalog providers default to the anthropic adapter (spec §8.3). */
export function defaultAdapterForProvider(provider: ProviderCatalogItem): AdapterKind {
  return provider.providerId.toLowerCase().includes("anthropic") ? "anthropic" : "openai-compatible";
}

/**
 * Provider selection (spec §8.3): remember the catalog provider id; default the
 * adapter and prefill the name only when the user has not touched them.
 */
export function applyProviderSelection(state: ConnectionFormState, provider: ProviderCatalogItem): ConnectionFormState {
  return {
    ...state,
    catalogProviderId: provider.providerId,
    providerName: state.providerName || provider.name,
    adapterKind: state.adapterTouched ? state.adapterKind : defaultAdapterForProvider(provider),
    name: state.nameTouched ? state.name : provider.name,
  };
}

/**
 * Model selection (spec §8.3): always prefill modelId/modelName; prefill base
 * URL from `effectiveBaseUrl` and compose `<provider> · <model>` name only for
 * fields the user has not edited.
 */
export function applyModelSelection(
  state: ConnectionFormState,
  providerDisplayName: string,
  model: ModelCatalogItem,
): ConnectionFormState {
  const next: ConnectionFormState = { ...state, modelId: model.modelId, modelName: model.name };
  if (!state.baseUrlTouched && model.effectiveBaseUrl) next.baseUrl = model.effectiveBaseUrl;
  if (!state.nameTouched) next.name = `${providerDisplayName} · ${model.name}`;
  return next;
}

/** Manually editing modelId drops the stale catalog modelName (spec §8.3.4). */
export function applyModelIdEdit(state: ConnectionFormState, modelId: string): ConnectionFormState {
  return { ...state, modelId, modelName: modelId === state.modelId ? state.modelName : "" };
}

export interface ConnectionPayload {
  name: string;
  adapterKind: AdapterKind;
  baseUrl: string;
  modelId: string;
  apiKey?: string;
  providerName?: string;
  modelName?: string;
}

/** Edit omits `apiKey` unless the user typed a new one (spec §8.2). */
export function buildConnectionPayload(state: ConnectionFormState, mode: "create" | "edit"): ConnectionPayload {
  const payload: ConnectionPayload = {
    name: state.name.trim(),
    adapterKind: state.adapterKind,
    baseUrl: state.baseUrl.trim(),
    modelId: state.modelId.trim(),
  };
  const apiKey = state.apiKey.trim();
  if (mode === "create" || apiKey.length > 0) payload.apiKey = apiKey;
  if (state.providerName.trim()) payload.providerName = state.providerName.trim();
  if (state.modelName.trim()) payload.modelName = state.modelName.trim();
  return payload;
}

export type ConnectionFormError = "name" | "baseUrl" | "modelId" | "apiKey";

/** Client-side mirror of the server constraints (spec §8.2). */
export function validateConnectionForm(state: ConnectionFormState, mode: "create" | "edit"): ConnectionFormError[] {
  const errors: ConnectionFormError[] = [];
  const name = state.name.trim();
  if (name.length < 1 || name.length > 128) errors.push("name");
  if (!isPublicHttpsUrl(state.baseUrl.trim())) errors.push("baseUrl");
  const modelId = state.modelId.trim();
  if (modelId.length < 1 || modelId.length > 256) errors.push("modelId");
  if (mode === "create" && state.apiKey.trim().length === 0) errors.push("apiKey");
  return errors;
}

/** Public HTTPS check: https scheme and no local/private host. */
export function isPublicHttpsUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) return false;
  if (host === "127.0.0.1" || host === "::1" || host === "[::1]") return false;
  return true;
}

/** Merge catalog pages deduped by id, keeping existing order (spec §13.6). */
export function mergeCatalogItems<T>(existing: readonly T[], incoming: readonly T[], keyOf: (item: T) => string): T[] {
  const seen = new Set(existing.map(keyOf));
  const merged = [...existing];
  for (const item of incoming) {
    const key = keyOf(item);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(item);
  }
  return merged;
}

/** Terminal sync attempt statuses stop the polling loop (spec §8.3). */
export const SYNC_TERMINAL_STATUSES: ReadonlySet<string> = new Set(["succeeded", "not_modified", "failed", "cancelled"]);

export function isSyncTerminal(status: string): boolean {
  return SYNC_TERMINAL_STATUSES.has(status);
}

/** 429 rate limit: prefer server `retryAfterSeconds`, default 60 (spec §8.3). */
export function syncRetryAfterSeconds(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 1 ? value : 60;
}
