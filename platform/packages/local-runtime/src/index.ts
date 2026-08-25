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

/**
 * Package-run composition: the assembled run input (entry prompt + references +
 * user input) becomes the single user message of one provider turn. The route is
 * process-scoped trusted config (env-sourced), never persisted.
 */
export const PACKAGE_RUN_SYSTEM_PROMPT = 'You are executing an agent package run. Follow the instructions embedded in the user message exactly and produce the requested output.';

export function createLivePackageAgentClient(options: {
  readonly route: LiveProviderRoute;
  readonly systemPrompt?: string;
  readonly maxOutputTokens?: number;
}): LocalAgentClient {
  return new LocalAgentClient({
    harness: new LiveProviderHarness({
      route: options.route,
      transcript: [],
      turnInput: true,
      systemPrompt: options.systemPrompt ?? PACKAGE_RUN_SYSTEM_PROMPT,
      ...(options.maxOutputTokens === undefined ? {} : { maxOutputTokens: options.maxOutputTokens })
    })
  });
}

export type { LiveProviderRoute, LiveProviderTurnMessage };
export * from './kernel.js';
