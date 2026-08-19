import { LocalAgentClient } from '@sage/agent-client';
import { createExplicitLegacyPiHarness, LiveProviderHarness, type LiveProviderRoute, type LiveProviderTurnMessage } from '@sage/harness-pi';

export function createLocalAgentClient(): LocalAgentClient {
  return new LocalAgentClient({ harness: createExplicitLegacyPiHarness() });
}

/**
 * Chat-only composition for provider-routed runs. The route and transcript stay
 * request-scoped; this keeps the Pi SDK boundary inside harness-pi while the
 * application keeps depending only on LocalAgentClient.
 */
export function createLiveProviderAgentClient(options: {
  readonly route: LiveProviderRoute;
  readonly transcript: readonly LiveProviderTurnMessage[];
}): LocalAgentClient {
  return new LocalAgentClient({ harness: new LiveProviderHarness(options) });
}

export type { LiveProviderRoute, LiveProviderTurnMessage };
export * from './kernel.js';
