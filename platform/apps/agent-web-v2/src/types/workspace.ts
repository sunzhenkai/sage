/**
 * Workspace-level view types given by the functional spec but not exported by
 * `@sage/app-contracts` (spec §8.1, §8.2). The Providers phase reuses these.
 */

/** Spec §8.2 `WorkspaceProviderView`. */
export interface WorkspaceProviderView {
  id: string;
  name: string;
  source: "user" | "deployment-env";
  adapterKind: "openai-compatible" | "anthropic";
  baseUrl: string;
  modelId: string;
  providerName?: string;
  modelName?: string;
  enabled: boolean;
  credentialPresent: boolean;
}

/** `GET /v1/provider-connections` response (spec §8.2). */
export interface ProviderConnectionsResponse {
  schemaVersion: "ProviderConnections.v1";
  connections: WorkspaceProviderView[];
}

/** Spec §8.1 `GET /v1/run-agent/settings` response (`RunAgentSettings.v2`). */
export interface RunAgentSettings {
  schemaVersion: "RunAgentSettings.v2";
  unset: boolean;
  providerConnectionId?: string;
  providers: ReadonlyArray<{
    id: string;
    name: string;
    available: boolean;
    reason?: string;
  }>;
}
