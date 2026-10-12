import { describe, expect, it } from 'vitest';
import type { LegacyAdmissionPreparationV1 } from './compatibility.js';
import {
  FIXED_TASK_TYPE_GOLDEN_FIXTURES_V1,
  FIXED_TASK_TYPE_RUNTIME_REQUIREMENTS_V1,
  assertFixedTaskTypeMappingBoundary,
  compileLegacyAdmission,
  prepareLegacyAdmissionRequest,
  legacySpecSemanticDigest,
  assertLegacyNewSemanticEquivalence,
  prepareAgentRunSpecAdmissionRequest,
  prepareChatAdmissionRequest,
  getFixedTaskTypeRuntimeRequirements,
} from './compatibility.js';

describe('fixed TaskType runtime requirements v1', () => {
  it('resolves the versioned golden fixtures without physical or identity authority', () => {
    expect(FIXED_TASK_TYPE_GOLDEN_FIXTURES_V1).toEqual([
      { taskType: 'sage.agent-task.v1', packageId: 'sage.agent-task', channel: 'stable', releaseRef: 'release://sha256:1111111111111111111111111111111111111111111111111111111111111111' },
      { taskType: 'sage.batch-agent-task.v1', packageId: 'sage.batch-agent-task', channel: 'stable', releaseRef: 'release://sha256:2222222222222222222222222222222222222222222222222222222222222222' },
    ]);
    for (const requirements of Object.values(FIXED_TASK_TYPE_RUNTIME_REQUIREMENTS_V1)) {
      assertFixedTaskTypeMappingBoundary(requirements);
      expect(JSON.stringify(requirements)).not.toMatch(/target|secret|credential|principal|tenant|endpoint|namespace|taskQueue|provider/i);
    }
  });

  it('returns immutable requirements and rejects unknown TaskTypes', () => {
    const requirements = getFixedTaskTypeRuntimeRequirements('sage.agent-task.v1');
    expect(requirements.packageId).toBe('sage.agent-task');
    expect(Object.isFrozen(requirements)).toBe(true);
    expect(() => getFixedTaskTypeRuntimeRequirements('caller-controlled-task')).toThrow('FIXED_TASK_TYPE_UNSUPPORTED');
  });

  it('rejects an authority-bearing mapping fixture', () => {
    expect(() => assertFixedTaskTypeMappingBoundary({ taskType: 'x', endpoint: 'http://untrusted' })).toThrow('FIXED_TASK_TYPE_MAPPING_AUTHORITY_LEAK');
    expect(() => assertFixedTaskTypeMappingBoundary({ taskType: 'x', secretRef: 'secret://raw' })).toThrow('FIXED_TASK_TYPE_MAPPING_AUTHORITY_LEAK');
  });
});


describe('legacy input canonical Admission adapters', () => {
  const spec = {
    schemaVersion: '1' as const, runId: 'run-adapter', input: 'summarize', skillRefs: [], requiredCapabilities: ['events' as const],
    limits: { maxTurns: 1, maxToolCalls: 0, maxTokens: 10, deadlineAt: '2030-01-01T00:00:00.000Z' }
  };
  const trusted = {
    legacySource: 'agent-run-spec-v1' as const, adapterBuild: 'adapter://golden/1', tenantId: 'tenant-adapter', principalRef: 'principal://trusted',
    taskId: 'task-adapter', attemptId: 'attempt-adapter', invocationId: 'invoke-adapter', specRef: 'spec://tenant-adapter/task-adapter',
    goalRef: 'artifact://tenant-adapter/input', releaseRef: 'release://tenant-adapter/release', releaseDigest: `sha256:${'a'.repeat(64)}`,
    engineId: 'reference', allowedSkillRefs: [], allowedCapabilities: ['events' as const], modelRouteRef: 'model://trusted', contextPlanRef: 'context://trusted',
    capabilityGrantRef: 'grant://trusted', executionPolicyRef: 'policy://trusted', boundsRef: 'bounds://trusted', governanceRef: 'governance://trusted',
    admittedAt: '2030-01-01T00:00:00.000Z'
  };

  it('normalizes Chat, Task and direct AgentRunSpec through one compiler and emits only immutable refs', async () => {
    const calls: string[] = [];
    const compiler = async (prepared: LegacyAdmissionPreparationV1) => {
      calls.push(prepared.source);
      expect(prepared.request.inputRefs[0]).toMatchObject({ ref: trusted.goalRef, schemaRef: 'schema://agent-run-spec/v1' });
      expect(prepared.request).not.toHaveProperty('tenantId');
      expect(prepared.request).not.toHaveProperty('principalRef');
      return prepared.requestDigest;
    };
    const inputs = [
      { ...trusted, legacySource: 'chat-v1' as const },
      { ...trusted, legacySource: 'task-v1' as const },
      trusted
    ];
    await Promise.all(inputs.map((context, index) => compileLegacyAdmission({ source: context.legacySource, taskType: 'sage.agent-task.v1', legacySpec: spec, trusted: context, idempotencyKey: `key-${index}`, mode: index === 1 ? 'DURABLE' : 'INTERACTIVE' }, compiler)));
    expect(calls.sort()).toEqual(['agent-run-spec-v1', 'chat-v1', 'task-v1']);
  });

  it('keeps equivalent source semantics stable while allowing transport identity to differ', () => {
    const chat = prepareChatAdmissionRequest({ taskType: 'sage.agent-task.v1', legacySpec: spec, trusted: { ...trusted, legacySource: 'chat-v1' }, idempotencyKey: 'chat-key', mode: 'INTERACTIVE' });
    const direct = prepareAgentRunSpecAdmissionRequest({ taskType: 'sage.agent-task.v1', legacySpec: spec, trusted, idempotencyKey: 'run-key', mode: 'INTERACTIVE' });
    expect(chat.request.inputRefs).toEqual(direct.request.inputRefs);
    expect(chat.request.releaseSelector).toEqual(direct.request.releaseSelector);
    expect(chat.requirements).toEqual(direct.requirements);
    expect(chat.requestDigest).not.toBe(direct.requestDigest);
  });
});


describe('legacy/new Spec semantic equivalence', () => {
  const digest = (letter: string) => `sha256:${letter.repeat(64)}` as `sha256:${string}`;
  const base = {
    schemaVersion: '1' as const, specRef: 'spec://tenant/legacy', specDigest: digest('a'), taskId: 'task-legacy', runId: 'run-legacy', attemptId: 'attempt-1',
    releaseRef: 'release://tenant/release', releaseDigest: digest('b'), principalRef: 'principal://tenant/user', tenantId: 'tenant', goalRef: 'artifact://tenant/input', engineId: 'reference',
    skillRefs: ['skill://summary/1'], modelRouteRef: 'model://route', contextPlanRef: 'context://plan', capabilityGrantRef: 'grant://tenant/read',
    executionPolicyRef: 'policy://bounded', boundsRef: 'bounds://default', governanceRef: 'governance://default', admittedAt: '2030-01-01T00:00:00.000Z'
  };
  it('keeps the same semantic digest across equivalent legacy/new transport identity', () => {
    const result = assertLegacyNewSemanticEquivalence({
      legacySpec: base,
      canonicalSpec: { ...base, specRef: 'spec://tenant/canonical', specDigest: digest('c'), taskId: 'task-canonical', runId: 'run-canonical', attemptId: 'attempt-2', admittedAt: '2030-01-02T00:00:00.000Z' }
    });
    expect(result.semanticDigest).toBe(legacySpecSemanticDigest(base));
    expect(result.comparedAuthorities).toEqual(['GRANT', 'MODEL', 'CONTEXT', 'CAPABILITY', 'TARGET', 'BUDGET']);
  });
  it('rejects a semantic grant/model/context/bounds change', () => {
    expect(() => assertLegacyNewSemanticEquivalence({ legacySpec: base, canonicalSpec: { ...base, modelRouteRef: 'model://changed' } })).toThrow('LEGACY_SEMANTIC_MISMATCH:modelRouteRef');
    expect(() => assertLegacyNewSemanticEquivalence({ legacySpec: base, canonicalSpec: { ...base, boundsRef: 'bounds://changed' } })).toThrow('LEGACY_SEMANTIC_MISMATCH:boundsRef');
  });
});


describe('legacy authority override and tenant scope boundary', () => {
  const spec = { schemaVersion: '1' as const, runId: 'run-boundary', input: 'input', skillRefs: [], requiredCapabilities: ['events' as const], limits: { maxTurns: 1, maxToolCalls: 0, maxTokens: 1, deadlineAt: '2030-01-01T00:00:00.000Z' } };
  const trusted = {
    legacySource: 'agent-run-spec-v1' as const, adapterBuild: 'adapter://boundary/1', tenantId: 'tenant-trusted', principalRef: 'principal://trusted', taskId: 'task-boundary', attemptId: 'attempt-boundary', invocationId: 'invoke-boundary', specRef: 'spec://tenant-trusted/task-boundary', goalRef: 'artifact://tenant-trusted/input', releaseRef: 'release://tenant-trusted/release', releaseDigest: `sha256:${'a'.repeat(64)}`, engineId: 'reference', allowedSkillRefs: [], allowedCapabilities: ['events' as const], modelRouteRef: 'model://trusted', contextPlanRef: 'context://trusted', capabilityGrantRef: 'grant://trusted', executionPolicyRef: 'policy://trusted', boundsRef: 'bounds://trusted', governanceRef: 'governance://trusted', admittedAt: '2030-01-01T00:00:00.000Z'
  };
  it.each(['endpoint', 'namespace', 'taskQueue', 'modelProvider'] as const)('rejects legacy %s physical override', (key) => {
    expect(() => prepareLegacyAdmissionRequest({ source: 'agent-run-spec-v1', taskType: 'sage.agent-task.v1', legacySpec: { ...spec, [key]: 'attacker-controlled' }, trusted, idempotencyKey: 'boundary-key', mode: 'DURABLE' })).toThrow('LEGACY_AUTHORITY_OVERRIDE');
  });
  it('uses trusted tenant scope and does not accept a legacy tenant field', () => {
    const prepared = prepareLegacyAdmissionRequest({ source: 'agent-run-spec-v1', taskType: 'sage.agent-task.v1', legacySpec: spec, trusted, idempotencyKey: 'tenant-key', mode: 'DURABLE' });
    expect(prepared.request.inputRefs[0]!.ref).toBe('artifact://tenant-trusted/input');
    expect(prepared.request).not.toHaveProperty('tenantId');
    expect(() => prepareLegacyAdmissionRequest({ source: 'agent-run-spec-v1', taskType: 'sage.agent-task.v1', legacySpec: { ...spec, tenantId: 'tenant-attacker' } as unknown as typeof spec, trusted, idempotencyKey: 'tenant-attack', mode: 'DURABLE' })).toThrow('LEGACY_AUTHORITY_OVERRIDE');
  });
});
