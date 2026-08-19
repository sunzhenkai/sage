import { describe, expect, it } from 'vitest';
import { isAgentExecutionEnvelope, isAgentTaskSpec } from '@sage/agent-contracts';
import {
  buildAdmissionSpecV1,
  evaluateShadowAdmission,
  parsePhase3AdmissionFeatureConfig,
  selectPhase3AdmissionDecision,
} from './index.js';

const digest = (letter: string): `sha256:${string}` => `sha256:${letter.repeat(64)}`;
const passingGateEnvironment = {
  SAGE_AGENT_GATE_DEPENDENCY_PASS: 'true',
  SAGE_AGENT_GATE_CONFORMANCE_PASS: 'true',
  SAGE_AGENT_GATE_SHADOW_DIFF_PASS: 'true',
  SAGE_AGENT_GATE_FAILURE_INJECTION_PASS: 'true',
  SAGE_AGENT_GATE_REFERENCE_WORKLOAD_PASS: 'true',
  SAGE_AGENT_GATE_ROLLBACK_PASS: 'true',
} as const;
const draft = () => ({
  schemaVersion: '1' as const,
  specRef: 'spec://tenant-reference/task-1/attempt-1', taskId: 'task-1', runId: 'run-1', attemptId: 'attempt-1',
  releaseRef: `release://${digest('a')}`, releaseDigest: digest('b'), principalRef: 'principal://user', tenantId: 'tenant-reference',
  goalRef: 'artifact://tenant-reference/input-1', engineId: 'reference', skillRefs: [], modelRouteRef: 'model://reference/summary',
  contextPlanRef: 'context://summary/1', capabilityGrantRef: 'grant://summary/1', executionPolicyRef: 'policy://summary/1',
  boundsRef: 'bounds://summary/1', governanceRef: 'governance://summary/1', admittedAt: '2030-01-01T00:00:00.000Z',
});

describe('Phase 3 migration and rollback lifecycle', () => {
  it('runs shadow to canonical to lossless legacy rollback without Spec drift or double owner', () => {
    const shadowConfig = parsePhase3AdmissionFeatureConfig({
      SAGE_AGENT_SHADOW_ADMISSION: 'true', SAGE_AGENT_ADMISSION_TENANT_ALLOWLIST: 'tenant-reference',
      SAGE_AGENT_ADMISSION_TASK_TYPE_ALLOWLIST: 'controlled-summary.v1',
    });
    const shadow = selectPhase3AdmissionDecision({ config: shadowConfig, tenantId: 'tenant-reference', taskType: 'controlled-summary.v1' });
    expect(shadow.lifecycleOwner).toBe('legacy');
    const diff = evaluateShadowAdmission({
      tenantId: 'tenant-reference', taskType: 'controlled-summary.v1', recordedAt: '2030-01-01T00:00:00.000Z',
      legacy: { semanticDigest: digest('a'), routeDigest: digest('b'), grantDigest: digest('c') },
      canonical: { semanticDigest: digest('a'), routeDigest: digest('b'), grantDigest: digest('c') },
    });
    expect(diff).toMatchObject({ semanticEqual: true, routeEqual: true, grantEqual: true, reservationCreated: false, envelopeIssued: false, dispatches: 0 });

    const canonicalConfig = parsePhase3AdmissionFeatureConfig({
      ...passingGateEnvironment,
      SAGE_AGENT_CANONICAL_NEW_WORKLOAD: 'true', SAGE_AGENT_LEGACY_ADAPTER_CUTOVER: 'true',
      SAGE_AGENT_ADMISSION_TENANT_ALLOWLIST: 'tenant-reference', SAGE_AGENT_ADMISSION_TASK_TYPE_ALLOWLIST: 'controlled-summary.v1',
    });
    const canonical = selectPhase3AdmissionDecision({ config: canonicalConfig, tenantId: 'tenant-reference', taskType: 'controlled-summary.v1' });
    expect(canonical.lifecycleOwner).toBe('canonical');
    const committedSpec = buildAdmissionSpecV1(draft());
    const envelope = {
      schemaVersion: '1' as const, specRef: committedSpec.specRef, specDigest: committedSpec.specDigest,
      taskId: committedSpec.taskId, runId: committedSpec.runId, attemptId: committedSpec.attemptId, invocationId: 'invocation-1',
    };
    expect(isAgentTaskSpec(committedSpec)).toBe(true);
    expect(isAgentExecutionEnvelope(envelope)).toBe(true);

    const rollbackConfig = parsePhase3AdmissionFeatureConfig({ SAGE_AGENT_ADMISSION_KILL_SWITCH: 'true' });
    const rolledBack = selectPhase3AdmissionDecision({ config: rollbackConfig, tenantId: 'tenant-reference', taskType: 'controlled-summary.v1' });
    expect(rolledBack.lifecycleOwner).toBe('legacy');
    expect(rolledBack.canonicalNewWorkload).toBe(false);
    expect(committedSpec).toEqual(buildAdmissionSpecV1(draft()));
    expect(envelope.specDigest).toBe(committedSpec.specDigest);
  });
});
