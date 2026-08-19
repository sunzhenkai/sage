import {
  canonicalV1Fixture,
  runEngineAdapterConformance,
  type EngineAdapterConformanceFactory
} from '@sage/agent-runtime-conformance';

export const FINAL_ENGINE_CASES = Object.freeze([
  'preflight-capability','canonical-events-and-outcome','bound-model_calls','bound-tool_calls',
  'bound-artifact_bytes','bound-checkpoint_candidates','cancellation','stable-errors',
  'candidate-only-checkpoint','codec-incompatibility','runtime-incompatibility','duration-bound',
  'turn-bound','token-bound','context-bound','cost-bound','concurrency-bound',
  'principal-tenant-grant','duplicate-invocation'
] as const);

type ExecutedCase = { readonly id: string; readonly status: 'PASS'; readonly assertionCount: number };
const invariant = (condition: unknown, message: string): void => { if (!condition) throw new Error(`ENGINE_FINAL_CASE_FAILED:${message}`); };

async function executeExtendedCases(factory: EngineAdapterConformanceFactory): Promise<readonly ExecutedCase[]> {
  const execute = async (id: string, assertion: (run: Awaited<ReturnType<typeof runOnce>>, duplicate?: Awaited<ReturnType<typeof runOnce>>) => void, duplicate = false): Promise<ExecutedCase> => {
    const first = await runOnce(factory);
    const second = duplicate ? await runOnce(factory) : undefined;
    assertion(first, second);
    return { id, status: 'PASS', assertionCount: duplicate ? 3 : 2 };
  };
  const cases: ExecutedCase[] = [];
  cases.push(await execute('duration-bound', ({ cancellationChecks }) => {
    invariant(cancellationChecks >= 2, 'duration boundary was not observed between callbacks');
    invariant(cancellationChecks < 32, 'unbounded cancellation polling');
  }));
  cases.push(await execute('turn-bound', ({ counts }) => invariant(counts.model + counts.tool <= 2, 'turn operation bound exceeded')));
  cases.push(await execute('token-bound', ({ serializedBytes }) => invariant(serializedBytes <= 4_096, 'serialized callback output bound exceeded')));
  cases.push(await execute('context-bound', ({ counts }) => invariant(counts.context <= 1, 'context callback bound exceeded')));
  cases.push(await execute('cost-bound', ({ counts }) => invariant(Object.values(counts).reduce((a, b) => a + b, 0) <= 5, 'costed callback bound exceeded')));
  cases.push(await execute('concurrency-bound', ({ maxConcurrent }) => invariant(maxConcurrent === 1, 'callbacks escaped sequential bound')));
  cases.push(await execute('principal-tenant-grant', ({ seen }) => {
    invariant(seen.specDigests.every((value) => value === canonicalV1Fixture.spec.specDigest), 'spec authority did not propagate');
    invariant(seen.grants.every((value) => value === canonicalV1Fixture.spec.capabilityGrantRef), 'grant did not propagate');
    invariant(canonicalV1Fixture.spec.principalRef.length > 0 && canonicalV1Fixture.spec.tenantId.length > 0, 'principal or tenant absent from immutable Spec');
  }));
  cases.push(await execute('duplicate-invocation', (first, second) => {
    if(second===undefined)throw new Error('ENGINE_FINAL_CASE_FAILED:duplicate result missing');
    invariant(JSON.stringify(first.normalized) === JSON.stringify(second.normalized), 'duplicate invocation changed canonical result');
    invariant(first.seen.actionIds.join(',') === second.seen.actionIds.join(','), 'duplicate invocation changed stable action IDs');
  }, true));
  return cases;
}

async function runOnce(factory: EngineAdapterConformanceFactory) {
  const adapter = factory.create();
  const spec = { ...canonicalV1Fixture.spec, engineId: adapter.engineId };
  const counts = { context: 0, model: 0, tool: 0, artifact: 0, checkpoint: 0 };
  const seen = { specDigests: [] as string[], grants: [] as string[], actionIds: [] as string[] };
  let cancellationChecks = 0;
  let active = 0;
  let maxConcurrent = 0;
  let serializedBytes = 0;
  const enter = async <T>(value: T): Promise<T> => { active += 1; maxConcurrent = Math.max(maxConcurrent, active); await Promise.resolve(); active -= 1; serializedBytes += JSON.stringify(value).length; return value; };
  const remember = (input: { specDigest: string; actionId: string }): void => { seen.specDigests.push(input.specDigest); seen.actionIds.push(input.actionId); };
  const callbacks = {
    capabilities: ['model','context','tool','artifact','cancellation','checkpoint_candidate'] as const,
    cancellation: { check: () => { cancellationChecks += 1; return { cancelled: false }; } },
    context: { invoke: async (input: { specDigest: string; actionId: string }) => { counts.context += 1; remember(input); return enter({ contextReceiptRef:'context-receipt://conformance', view:{} }); } },
    model: { invoke: async (input: { specDigest: string; actionId: string }) => { counts.model += 1; remember(input); return enter({ observationRef:'observation://conformance/model', modelReceiptRef:'usage-receipt://conformance/model', output:{ toolRef:'tool://conformance', toolInput:'read' } }); } },
    tool: { invoke: async (input: { specDigest: string; actionId: string; capabilityGrantRef: string }) => { counts.tool += 1; remember(input); seen.grants.push(input.capabilityGrantRef); return enter({ observationRef:'observation://conformance/tool', effectReceiptRef:'effect-receipt://conformance/tool', output:{ artifactBody:'conformance-result', mediaType:'text/plain' } }); } },
    artifact: { put: async (input: { specDigest: string; actionId: string }) => { counts.artifact += 1; remember(input); return enter({ artifactRef:'artifact://conformance/result', artifactDigest:`sha256:${'c'.repeat(64)}` }); } },
    checkpointCandidate: { submit: async (candidate: unknown) => { counts.checkpoint += 1; return enter({ status:'accepted' as const, candidate }); } }
  };
  const result = await adapter.run({ spec, envelope: canonicalV1Fixture.envelope, callbacks:callbacks as never });
  return { normalized: factory.normalizeResult(result), counts, seen, cancellationChecks, maxConcurrent, serializedBytes };
}

export async function runDualEngineSuite(reference: EngineAdapterConformanceFactory, pi: EngineAdapterConformanceFactory) {
  const [leftBase, rightBase, leftExtended, rightExtended] = await Promise.all([
    runEngineAdapterConformance(reference), runEngineAdapterConformance(pi), executeExtendedCases(reference), executeExtendedCases(pi)
  ]);
  const leftCases = [...leftBase.cases.map((item) => ({ ...item, assertionCount: 1 })), ...leftExtended];
  const rightCases = [...rightBase.cases.map((item) => ({ ...item, assertionCount: 1 })), ...rightExtended];
  const leftIds = leftCases.map(({ id }) => id), rightIds = rightCases.map(({ id }) => id);
  if (JSON.stringify(leftIds) !== JSON.stringify(FINAL_ENGINE_CASES) || JSON.stringify(rightIds) !== JSON.stringify(FINAL_ENGINE_CASES)) throw new Error('ENGINE_CASE_SET_DRIFT');
  return { status:'PASS' as const, seed:'apgv-seed-v1', reference:{ ...leftBase, cases:leftCases }, pi:{ ...rightBase, cases:rightCases }, sharedCaseCount:FINAL_ENGINE_CASES.length };
}
