import { describe, expect, it } from 'vitest';
import { LocalAgentClient } from '@sage/agent-client';
import type {
  AgentEvent,
  AgentRunSpec,
  HarnessPort,
  HarnessTurnRequest,
  HarnessTurnResult
} from '@sage/agent-contracts';
import { LiveProviderHarness, createFakeLiveInvoker } from '@sage/harness-pi';
import { runCanonicalNodeHostExample, runLiveNodeHostExample } from './index.js';

let nextRun = 0;
const makeSpec = (input: string, overrides: Partial<AgentRunSpec['limits']> = {}): AgentRunSpec => ({
  schemaVersion: '1',
  runId: `host-run-${++nextRun}`,
  input,
  skillRefs: [],
  requiredCapabilities: ['events', 'cancellation'],
  limits: {
    maxTurns: 2,
    maxToolCalls: 2,
    maxTokens: 1_000,
    deadlineAt: new Date(Date.now() + 5_000).toISOString(),
    ...overrides
  }
});

/** 与产品路径同构的组装：LiveProviderHarness + fake invoker（只替换最终模型 HTTP 调用）。 */
const liveClient = (tokensPerSecond = 5_000): LocalAgentClient => new LocalAgentClient({
  harness: new LiveProviderHarness({
    route: { adapterKind: 'openai-compatible', baseUrl: 'https://provider.example/v1', modelId: 'model-x', apiKey: 'example-key' },
    transcript: [],
    turnInput: true,
    invoker: createFakeLiveInvoker({ tokensPerSecond })
  })
});

const execute = async (client: LocalAgentClient, spec: AgentRunSpec, cancelAfterMs?: number) => {
  const execution = client.run(spec);
  const events: AgentEvent[] = [];
  const collecting = (async () => { for await (const event of execution.events) events.push(event); })();
  if (cancelAfterMs !== undefined) setTimeout(() => execution.cancel(), cancelAfterMs);
  const outcome = await execution.result;
  await collecting;
  return { outcome, events };
};

const expectTimeline = (events: readonly AgentEvent[]): void => {
  expect(events.length).toBeGreaterThan(0);
  expect(events.map((event) => event.sequence)).toEqual(events.map((_event, index) => index + 1));
  expect(new Set(events.map((event) => event.sequence)).size).toBe(events.length);
};

describe('canonical Node.js Host example', () => {
  it('shows create-only Spec Store, minimal Envelope, candidate-only Engine output and platform-sealed Checkpoint', async () => {
    const result = await runCanonicalNodeHostExample();
    expect(result.executionPath).toBe('canonical-spec-envelope');
    expect(result.loadedSpec).toEqual(result.spec);
    expect(Object.keys(result.envelope).sort()).toEqual([
      'attemptId', 'invocationId', 'runId', 'schemaVersion', 'specDigest', 'specRef', 'taskId'
    ]);
    expect(result.envelope).toMatchObject({
      specRef: result.spec.specRef,
      specDigest: result.spec.specDigest,
      taskId: result.spec.taskId,
      runId: result.spec.runId,
      attemptId: result.spec.attemptId
    });
    expect(result.outcome).toBe('COMPLETED');
    expect(result.checkpointCandidate).toMatchObject({
      specDigest: result.spec.specDigest,
      engineCodec: 'pi@0.73.1',
      runtimeContractMajor: 1,
      sequence: 1
    });
    expect('checkpointRef' in result.checkpointCandidate).toBe(false);
    expect(result.sealedCheckpoint).toMatchObject({
      candidateDigest: result.checkpointCandidate.candidateDigest,
      specDigest: result.spec.specDigest,
      engineCodec: result.checkpointCandidate.engineCodec,
      runtimeContractMajor: result.checkpointCandidate.runtimeContractMajor,
      sequence: result.checkpointCandidate.sequence
    });
    expect(result.sealedCheckpoint.checkpointRef).toMatch(/^checkpoint:\/\/sealed\//);
  });
});

describe('live provider Node.js Host example', () => {
  it('runs through the live path with a deterministic fake invoker', async () => {
    const result = await runLiveNodeHostExample();
    expect(result.executionPath).toBe('live-provider');
    expect(result.outcome.status).toBe('succeeded');
    expect(result.outcome.checkpointRef).toBeUndefined();
    expect(result.events.some((event) => event.type === 'checkpoint.created')).toBe(false);
    expectTimeline(result.events);
  });

  it('normalizes Harness failure into a stable terminal error', async () => {
    const { outcome, events } = await execute(liveClient(), makeSpec('[fail]'));
    expect(outcome.status).toBe('failed');
    expect(outcome.error?.code).toBe('HARNESS_FAILURE');
    expect(events.at(-1)?.type).toBe('run.failed');
    expectTimeline(events);
  });

  it('propagates caller cancellation', async () => {
    const { outcome, events } = await execute(liveClient(1), makeSpec('[slow]'), 10);
    expect(outcome.status).toBe('cancelled');
    expect(outcome.error?.code).toBe('CANCELLED');
    expect(events.some((event) => event.type === 'run.cancel.requested')).toBe(true);
    expectTimeline(events);
  });

  it('enforces deadline independently of the Host', async () => {
    const spec = makeSpec('[slow]', { deadlineAt: new Date(Date.now() + 20).toISOString() });
    const { outcome, events } = await execute(liveClient(1), spec);
    expect(outcome.status).toBe('deadline_exceeded');
    expect(outcome.error?.code).toBe('DEADLINE_EXCEEDED');
    expectTimeline(events);
  });

  it('enforces token and turn budgets with stable errors', async () => {
    const client = liveClient();
    const token = await execute(client, makeSpec('[tokens:100]', { maxTokens: 10 }));
    expect(token.outcome.status).toBe('budget_exhausted');
    expect(token.outcome.error?.code).toBe('TOKEN_BUDGET_EXHAUSTED');
    const turn = await execute(client, makeSpec('[continue]', { maxTurns: 1 }));
    expect(turn.outcome.error?.code).toBe('TURN_BUDGET_EXHAUSTED');
    expectTimeline(token.events);
    expectTimeline(turn.events);
  });

  it('emits a paused outcome without claiming a sealed Checkpoint', async () => {
    const { outcome, events } = await execute(liveClient(), makeSpec('[pause]'));
    expect(outcome.status).toBe('paused');
    expect(outcome.checkpointRef).toBeUndefined();
    expect(events.some((event) => event.type === 'checkpoint.created')).toBe(false);
    expect(events.at(-1)?.type).toBe('run.paused');
  });

  it('rejects missing Harness capabilities before execution', async () => {
    let calls = 0;
    const harness: HarnessPort = {
      capabilities: { harness: 'counting', version: '1', supported: ['events'] },
      async executeTurn(request: HarnessTurnRequest, signal: AbortSignal): Promise<HarnessTurnResult> {
        void request;
        void signal;
        calls += 1;
        return { output: 'must not run', done: true, toolCalls: 0, tokens: 0 };
      }
    };
    const { outcome, events } = await execute(new LocalAgentClient({ harness }), makeSpec('preflight'));
    expect(outcome.error?.code).toBe('HARNESS_CAPABILITY_MISSING');
    expect(calls).toBe(0);
    expect(events.map((event) => event.type)).toEqual(['run.failed']);
  });
});
