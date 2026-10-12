export type ReplayCorpusScenario =
  | 'legacy-regression'
  | 'continue-boundary'
  | 'pending-timer'
  | 'pending-signal'
  | 'delivery-retry'
  | 'control-race'
  | 'effect-unknown';

export interface ReplayCorpusEntry {
  readonly caseId: `replay://${string}`;
  readonly workflowType: 'AgentTaskWorkflow' | 'DurableCoordinatorWorkflow';
  readonly schemaMajor: 1;
  readonly buildLine: `build://${string}`;
  readonly scenario: ReplayCorpusScenario;
  readonly fixtureDigest: `sha256:${string}`;
  readonly fixturePath: `fixtures/replay/${string}.json`;
}

/** Versioned supported-window corpus. Paths resolve through fixtures/replay/manifest.json. */
export const REPLAY_CORPUS_MANIFEST = 'fixtures/replay/manifest.json' as const;
export const DURABLE_REPLAY_CORPUS: readonly ReplayCorpusEntry[] = Object.freeze([
  { caseId:'replay://legacy/v1/regression', workflowType:'AgentTaskWorkflow', schemaMajor:1, buildLine:'build://legacy-temporal/v1', scenario:'legacy-regression', fixtureDigest:`sha256:${'3ac2c73d2ef507c3e82fdaaf70ab8e90a115dfcded58d373135e769b02534a1c'}`, fixturePath:'fixtures/replay/legacy-regression.json' },
  { caseId:'replay://coordinator/v1/continue-boundary', workflowType:'DurableCoordinatorWorkflow', schemaMajor:1, buildLine:'build://coordinator-v2/v1', scenario:'continue-boundary', fixtureDigest:`sha256:${'987bed71d8c1dc4c9ac325ae9222611fd9fe3bc5355ca39cb8465dc481f8531d'}`, fixturePath:'fixtures/replay/continue-boundary.json' },
  { caseId:'replay://coordinator/v1/pending-timer', workflowType:'DurableCoordinatorWorkflow', schemaMajor:1, buildLine:'build://coordinator-v2/v1', scenario:'pending-timer', fixtureDigest:`sha256:${'8212130137ac313d74e2c6bad8e708c5f2e0779761b2207f62abd2a275d3c286'}`, fixturePath:'fixtures/replay/pending-timer.json' },
  { caseId:'replay://coordinator/v1/pending-signal', workflowType:'DurableCoordinatorWorkflow', schemaMajor:1, buildLine:'build://coordinator-v2/v1', scenario:'pending-signal', fixtureDigest:`sha256:${'cb5b554d028ee448c6b114b58403f40a0023b552fea0f215d87568296d5ad174'}`, fixturePath:'fixtures/replay/pending-signal.json' },
  { caseId:'replay://coordinator/v1/delivery-retry', workflowType:'DurableCoordinatorWorkflow', schemaMajor:1, buildLine:'build://coordinator-v2/v1', scenario:'delivery-retry', fixtureDigest:`sha256:${'b7598751871cce0f417fe223e014b382595a5f9fde630671d6ae16dcc84d0a7a'}`, fixturePath:'fixtures/replay/delivery-retry.json' },
  { caseId:'replay://coordinator/v1/control-race', workflowType:'DurableCoordinatorWorkflow', schemaMajor:1, buildLine:'build://coordinator-v2/v1', scenario:'control-race', fixtureDigest:`sha256:${'d4ee552b3951b3e3c9bd44bf963aebad537fd6990929a5bf0f2c4f92406b9ae1'}`, fixturePath:'fixtures/replay/control-race.json' },
  { caseId:'replay://coordinator/v1/effect-unknown', workflowType:'DurableCoordinatorWorkflow', schemaMajor:1, buildLine:'build://coordinator-v2/v1', scenario:'effect-unknown', fixtureDigest:`sha256:${'36e558aacc411181467442d168c89e79b42f70c7df98d9de6a0e4357add51457'}`, fixturePath:'fixtures/replay/effect-unknown.json' }
]);

const REQUIRED_SCENARIOS: readonly ReplayCorpusScenario[] = [
  'legacy-regression', 'continue-boundary', 'pending-timer', 'pending-signal', 'delivery-retry', 'control-race', 'effect-unknown'
];

export function assertReplayCorpusManifest(manifest: readonly ReplayCorpusEntry[] = DURABLE_REPLAY_CORPUS): void {
  if (manifest.length === 0 || manifest.length > 128) throw new Error('REPLAY_CORPUS_UNBOUNDED_OR_EMPTY');
  const ids = new Set<string>();
  for (const entry of manifest) {
    if (ids.has(entry.caseId) || !/^replay:\/\/[^\s]+$/u.test(entry.caseId) || !/^build:\/\/[^\s]+$/u.test(entry.buildLine) || !/^sha256:[a-f0-9]{64}$/u.test(entry.fixtureDigest) || !/^fixtures\/replay\/[a-z0-9-]+\.json$/u.test(entry.fixturePath)) {
      throw new Error('REPLAY_CORPUS_ENTRY_INVALID');
    }
    ids.add(entry.caseId);
  }
  for (const scenario of REQUIRED_SCENARIOS) if (!manifest.some((entry) => entry.scenario === scenario)) throw new Error(`REPLAY_CORPUS_SCENARIO_MISSING:${scenario}`);
  if (!manifest.some((entry) => entry.workflowType === 'AgentTaskWorkflow' && entry.schemaMajor === 1 && entry.buildLine === 'build://legacy-temporal/v1')) throw new Error('REPLAY_CORPUS_LEGACY_WINDOW_MISSING');
  if (!manifest.some((entry) => entry.workflowType === 'DurableCoordinatorWorkflow' && entry.schemaMajor === 1 && entry.buildLine === 'build://coordinator-v2/v1')) throw new Error('REPLAY_CORPUS_COORDINATOR_WINDOW_MISSING');
}

assertReplayCorpusManifest();
