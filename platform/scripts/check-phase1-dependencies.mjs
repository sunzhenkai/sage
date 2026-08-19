import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(new URL('..', import.meta.url).pathname);
const read = (path) => readFile(resolve(root, path), 'utf8');

const contracts = await read('packages/agent-contracts/src/index.ts');
const phase0Evidence = await read('evidence/agent-platform-contract-authority-foundation/phase-0-authority-audit.md');
const phase1Specs = await Promise.all([
  read('../openspec/changes/agent-runtime-kernel-broker-integration/specs/agent-runtime-kernel/spec.md'),
  read('../openspec/changes/agent-runtime-kernel-broker-integration/specs/agent-state-and-artifact-boundaries/spec.md'),
  read('../openspec/changes/agent-runtime-kernel-broker-integration/specs/authorized-tool-execution/spec.md'),
  read('../openspec/changes/agent-runtime-kernel-broker-integration/specs/consumption-ledger/spec.md'),
  read('../openspec/changes/agent-runtime-kernel-broker-integration/specs/context-resolution/spec.md'),
  read('../openspec/changes/agent-runtime-kernel-broker-integration/specs/model-broker-execution/spec.md')
]);

const requiredMajors = [
  'AgentTaskSpec.v1', 'AgentExecutionEnvelope.v1', 'AgentEvent.v2',
  'BoundedRunReceipt.v1', 'CheckpointCandidate.v1', 'SealedCheckpointRef.v1'
];
const missing = requiredMajors.filter((major) => !contracts.includes(major));
if (missing.length > 0) throw new Error(`PHASE1_DEPENDENCY_SCHEMA_MISSING:${missing.join(',')}`);
if (!phase0Evidence.includes('AgentTaskSpec') || !phase0Evidence.includes('Dependency boundaries: OK')) {
  throw new Error('PHASE1_DEPENDENCY_PHASE0_EVIDENCE_MISSING');
}
const duplicateAuthority = phase1Specs.filter((spec) => /AgentTaskSpec\\.v1|AgentExecutionEnvelope\\.v1/.test(spec));
if (duplicateAuthority.length > 0) throw new Error('PHASE1_DUPLICATE_PHASE0_AUTHORITY');

console.log(JSON.stringify({
  status: 'PASS',
  phase: '1',
  sequence: 2,
  consumedSchemaMajors: requiredMajors,
  authority: 'AgentTaskSpec is the sole execution configuration authority',
  phase0Evidence: 'phase-0-authority-audit.md',
  duplicateAuthority: false
}, null, 2));
