import { canonicalJson, isAgentRunSpec, sha256Digest, type AgentRunSpec, type ContentDigest } from '@sage/agent-contracts';
import { admissionRequestDigest, parseAdmissionRequestV1, type AdmissionRequestV1 } from '@sage/agent-run-admission';
import type { LegacyAdapterTrustedContext, LegacyRunSource } from './index.js';


/** Versioned, non-authoritative requirements selected by fixed workload identity. */
export interface FixedTaskTypeRuntimeRequirementsV1 {
  readonly schemaVersion: '1';
  readonly taskType: string;
  readonly taskTypeVersion: string;
  readonly packageId: string;
  readonly channel: string;
  readonly releaseRef: `release://${string}`;
  readonly releaseDigest: ContentDigest;
  readonly engineId: string;
  readonly modelRouteRef: `model://${string}`;
  readonly contextPlanRef: `context://${string}`;
  readonly capabilityRefs: readonly `capability://${string}`[];
  readonly executionPolicyRef: `policy://${string}`;
  readonly boundsRef: `bounds://${string}`;
  readonly governanceRef: `governance://${string}`;
}

/**
 * The fixed mapping is deliberately metadata-only. Target, Secret, caller identity,
 * provider endpoint, namespace and task queue are resolved by trusted authorities later.
 */
export const FIXED_TASK_TYPE_RUNTIME_REQUIREMENTS_V1: Readonly<Record<string, FixedTaskTypeRuntimeRequirementsV1>> = Object.freeze({
  'sage.agent-task.v1': Object.freeze({
    schemaVersion: '1', taskType: 'sage.agent-task.v1', taskTypeVersion: 'v1',
    packageId: 'sage.agent-task', channel: 'stable',
    releaseRef: 'release://sha256:1111111111111111111111111111111111111111111111111111111111111111',
    releaseDigest: 'sha256:1111111111111111111111111111111111111111111111111111111111111111',
    engineId: 'reference', modelRouteRef: 'model://sage/default', contextPlanRef: 'context://sage/default',
    capabilityRefs: ['capability://sage/events'] as const, executionPolicyRef: 'policy://sage/bounded',
    boundsRef: 'bounds://sage/default', governanceRef: 'governance://sage/default'
  }),
  'sage.batch-agent-task.v1': Object.freeze({
    schemaVersion: '1', taskType: 'sage.batch-agent-task.v1', taskTypeVersion: 'v1',
    packageId: 'sage.batch-agent-task', channel: 'stable',
    releaseRef: 'release://sha256:2222222222222222222222222222222222222222222222222222222222222222',
    releaseDigest: 'sha256:2222222222222222222222222222222222222222222222222222222222222222',
    engineId: 'reference', modelRouteRef: 'model://sage/batch', contextPlanRef: 'context://sage/batch',
    capabilityRefs: ['capability://sage/events'] as const, executionPolicyRef: 'policy://sage/bounded',
    boundsRef: 'bounds://sage/batch', governanceRef: 'governance://sage/default'
  })
});

export const FIXED_TASK_TYPE_GOLDEN_FIXTURES_V1 = Object.freeze([
  Object.freeze({ taskType: 'sage.agent-task.v1', packageId: 'sage.agent-task', channel: 'stable', releaseRef: FIXED_TASK_TYPE_RUNTIME_REQUIREMENTS_V1['sage.agent-task.v1']!.releaseRef }),
  Object.freeze({ taskType: 'sage.batch-agent-task.v1', packageId: 'sage.batch-agent-task', channel: 'stable', releaseRef: FIXED_TASK_TYPE_RUNTIME_REQUIREMENTS_V1['sage.batch-agent-task.v1']!.releaseRef })
] as const);

const forbiddenRuntimeAuthorityKeys = new Set([
  'target', 'targetRef', 'targetId', 'secret', 'secretRef', 'credential', 'credentialRef',
  'principal', 'principalRef', 'tenant', 'tenantId', 'endpoint', 'namespace', 'taskQueue',
  'provider', 'providerRef', 'modelProvider', 'model_provider'
]);

export function getFixedTaskTypeRuntimeRequirements(taskType: string): FixedTaskTypeRuntimeRequirementsV1 {
  const requirements = FIXED_TASK_TYPE_RUNTIME_REQUIREMENTS_V1[taskType];
  if (requirements === undefined) throw new Error('FIXED_TASK_TYPE_UNSUPPORTED');
  return requirements;
}

/** Fails closed if a mapping fixture accidentally grows physical or identity authority. */
export function assertFixedTaskTypeMappingBoundary(value: unknown): void {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('FIXED_TASK_TYPE_MAPPING_INVALID');
  const inspect = (current: unknown): void => {
    if (Array.isArray(current)) { current.forEach(inspect); return; }
    if (current === null || typeof current !== 'object') return;
    for (const [key, nested] of Object.entries(current as Record<string, unknown>)) {
      if (forbiddenRuntimeAuthorityKeys.has(key)) throw new Error('FIXED_TASK_TYPE_MAPPING_AUTHORITY_LEAK');
      inspect(nested);
    }
  };
  inspect(value);
}

const legacyInputAuthorityKeys = new Set([
  'tenant', 'tenantId', 'principal', 'principalRef', 'target', 'targetRef', 'targetId',
  'secret', 'secretRef', 'credential', 'credentialRef', 'endpoint', 'namespace', 'taskQueue',
  'provider', 'providerRef', 'modelProvider', 'model-provider', 'runtime', 'runtimeTarget'
]);
const assertLegacyInputAuthorityBoundary = (value: unknown): void => {
  if (value === null || typeof value !== 'object') return;
  if (Array.isArray(value)) { value.forEach(assertLegacyInputAuthorityBoundary); return; }
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (legacyInputAuthorityKeys.has(key)) throw new Error('LEGACY_AUTHORITY_OVERRIDE');
    assertLegacyInputAuthorityBoundary(nested);
  }
};

for (const fixture of Object.values(FIXED_TASK_TYPE_RUNTIME_REQUIREMENTS_V1)) assertFixedTaskTypeMappingBoundary(fixture);

export interface LegacyAdmissionPreparationV1 {
  readonly request: AdmissionRequestV1;
  readonly requestDigest: ContentDigest;
  readonly taskType: string;
  readonly source: LegacyRunSource;
  readonly requirements: FixedTaskTypeRuntimeRequirementsV1;
}

export interface LegacyAdmissionPreparationInputV1 {
  readonly source: LegacyRunSource;
  readonly taskType: string;
  readonly legacySpec: AgentRunSpec;
  readonly trusted: LegacyAdapterTrustedContext;
  readonly idempotencyKey: string;
  readonly mode: 'INTERACTIVE' | 'DURABLE';
}

export type LegacyAdmissionCompiler<T> = (prepared: LegacyAdmissionPreparationV1) => Promise<T>;

const legacyInputDigest = (legacySpec: AgentRunSpec): ContentDigest => sha256Digest(JSON.parse(canonicalJson({
  schemaVersion: legacySpec.schemaVersion,
  runId: legacySpec.runId,
  input: legacySpec.input,
  skillRefs: legacySpec.skillRefs,
  requiredCapabilities: legacySpec.requiredCapabilities,
  limits: legacySpec.limits,
  ...(legacySpec.resumeFrom === undefined ? {} : { resumeFrom: legacySpec.resumeFrom })
})) as Record<string, unknown>);

const inputRefFor = (trusted: LegacyAdapterTrustedContext): `artifact://${string}` => {
  if (!trusted.goalRef.startsWith('artifact://')) throw new Error('LEGACY_INPUT_REF_INVALID');
  return trusted.goalRef as `artifact://${string}`;
};

/** Common fail-closed normalization used by Chat, Task and direct AgentRunSpec adapters. */
export function prepareLegacyAdmissionRequest(input: LegacyAdmissionPreparationInputV1): LegacyAdmissionPreparationV1 {
  const requirements = getFixedTaskTypeRuntimeRequirements(input.taskType);
  assertLegacyInputAuthorityBoundary(input.legacySpec);
  if (!isAgentRunSpec(input.legacySpec)) throw new Error('LEGACY_SPEC_INVALID');
  if (input.trusted.tenantId.trim() === '' || input.trusted.principalRef.trim() === '') throw new Error('LEGACY_CONTEXT_INVALID');
  const request: AdmissionRequestV1 = parseAdmissionRequestV1({
    schemaVersion: '1',
    releaseSelector: { kind: 'package_channel', packageId: requirements.packageId, channel: requirements.channel },
    inputRefs: [{ ref: inputRefFor(input.trusted), digest: legacyInputDigest(input.legacySpec), schemaRef: 'schema://agent-run-spec/v1' }],
    mode: input.mode,
    invocation: {
      idempotencyKey: input.idempotencyKey,
      taskId: input.trusted.taskId,
      runId: input.legacySpec.runId,
      correlationRefs: input.trusted.correlationIds === undefined ? undefined : Object.values(input.trusted.correlationIds)
    }
  });
  return Object.freeze({ request, requestDigest: admissionRequestDigest(request), taskType: input.taskType, source: input.source, requirements });
}

export const prepareChatAdmissionRequest = (input: Omit<LegacyAdmissionPreparationInputV1, 'source'>): LegacyAdmissionPreparationV1 =>
  prepareLegacyAdmissionRequest({ ...input, source: 'chat-v1' });
export const prepareTaskAdmissionRequest = (input: Omit<LegacyAdmissionPreparationInputV1, 'source'>): LegacyAdmissionPreparationV1 =>
  prepareLegacyAdmissionRequest({ ...input, source: 'task-v1' });
export const prepareAgentRunSpecAdmissionRequest = (input: Omit<LegacyAdmissionPreparationInputV1, 'source'>): LegacyAdmissionPreparationV1 =>
  prepareLegacyAdmissionRequest({ ...input, source: 'agent-run-spec-v1' });

/** All compatibility surfaces invoke the same supplied Admission Compiler. */
export async function compileLegacyAdmission<T>(input: LegacyAdmissionPreparationInputV1, compiler: LegacyAdmissionCompiler<T>): Promise<T> {
  return compiler(prepareLegacyAdmissionRequest(input));
}

import { admissionSpecSemanticDigest, compareAdmissionSpecSemantics } from '@sage/agent-run-admission';
import type { AgentTaskSpec } from '@sage/agent-contracts';

export interface LegacySemanticEquivalenceResultV1 {
  readonly status: 'equivalent';
  readonly semanticDigest: ContentDigest;
  readonly comparedAuthorities: readonly ['GRANT', 'MODEL', 'CONTEXT', 'CAPABILITY', 'TARGET', 'BUDGET'];
}

/** Canonical Spec semantic digest excludes only stable identity and admission time fields. */
export const legacySpecSemanticDigest = (spec: AgentTaskSpec): ContentDigest => admissionSpecSemanticDigest(spec);

/**
 * Legacy/new equivalence is fail-closed: semantic Spec fields must match while
 * stable IDs and timestamps may differ. The canonical Spec digest remains the authority.
 */
export function assertLegacyNewSemanticEquivalence(input: {
  readonly legacySpec: AgentTaskSpec;
  readonly canonicalSpec: AgentTaskSpec;
}): LegacySemanticEquivalenceResultV1 {
  const left = input.legacySpec;
  const right = input.canonicalSpec;
  const authorities: readonly (keyof AgentTaskSpec)[] = [
    'capabilityGrantRef', 'modelRouteRef', 'contextPlanRef', 'skillRefs',
    'targetSnapshotRef', 'targetSnapshotDigest', 'requirementsDigest', 'boundsRef', 'executionPolicyRef'
  ];
  for (const key of authorities) {
    if (JSON.stringify(left[key]) !== JSON.stringify(right[key])) throw new Error(`LEGACY_SEMANTIC_MISMATCH:${String(key)}`);
  }
  if (compareAdmissionSpecSemantics(left, right) !== 'equivalent') throw new Error('LEGACY_SEMANTIC_MISMATCH');
  return { status: 'equivalent', semanticDigest: legacySpecSemanticDigest(left), comparedAuthorities: ['GRANT', 'MODEL', 'CONTEXT', 'CAPABILITY', 'TARGET', 'BUDGET'] };
}
