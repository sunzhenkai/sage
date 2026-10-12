import { LocalAgentClient } from '@sage/agent-client';
import { LiveProviderHarness, type LiveProviderInvoker, type LiveProviderRoute, type LiveProviderTurnMessage } from '@sage/harness-pi';

/**
 * Chat-only composition for provider-routed runs. The route and transcript stay
 * request-scoped; this keeps the Pi SDK boundary inside harness-pi while the
 * application keeps depending only on LocalAgentClient.
 */
export function createLiveProviderAgentClient(options: {
  readonly route: LiveProviderRoute;
  readonly transcript: readonly LiveProviderTurnMessage[];
  readonly invoker?: LiveProviderInvoker;
}): LocalAgentClient {
  return new LocalAgentClient({
    harness: new LiveProviderHarness({
      route: options.route,
      transcript: options.transcript,
      ...(options.invoker === undefined ? {} : { invoker: options.invoker })
    })
  });
}

/**
 * Package-run composition: the assembled run input (entry prompt + references +
 * user input) becomes the single user message of one provider turn. The route is
 * resolved at the execution boundary from the trusted registry, never persisted.
 */
export const PACKAGE_RUN_SYSTEM_PROMPT = 'You are executing an agent package run. Follow the instructions embedded in the user message exactly and produce the requested output.';

export const CHAT_SLICE_SYSTEM_PROMPT = 'You are Sage, a local workspace assistant. Answer the user directly and concisely in the language they use.';

export function createLivePackageAgentClient(options: {
  readonly route: LiveProviderRoute;
  readonly systemPrompt?: string;
  readonly maxOutputTokens?: number;
  readonly invoker?: LiveProviderInvoker;
}): LocalAgentClient {
  return new LocalAgentClient({
    harness: new LiveProviderHarness({
      route: options.route,
      transcript: [],
      turnInput: true,
      systemPrompt: options.systemPrompt ?? PACKAGE_RUN_SYSTEM_PROMPT,
      ...(options.maxOutputTokens === undefined ? {} : { maxOutputTokens: options.maxOutputTokens }),
      ...(options.invoker === undefined ? {} : { invoker: options.invoker })
    })
  });
}

export type { LiveProviderInvoker, LiveProviderRoute, LiveProviderTurnMessage };
export * from './kernel.js';
