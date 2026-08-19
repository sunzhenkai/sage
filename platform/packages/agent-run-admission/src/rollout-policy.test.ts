import { describe, expect, it } from 'vitest';
import {
  evaluateShadowAdmission,
  parsePhase3AdmissionFeatureConfig,
  selectPhase3AdmissionDecision,
} from './rollout-policy.js';

const digest = (letter: string): `sha256:${string}` => `sha256:${letter.repeat(64)}`;
const passingGateEnvironment = {
  SAGE_AGENT_GATE_DEPENDENCY_PASS: 'true',
  SAGE_AGENT_GATE_CONFORMANCE_PASS: 'true',
  SAGE_AGENT_GATE_SHADOW_DIFF_PASS: 'true',
  SAGE_AGENT_GATE_FAILURE_INJECTION_PASS: 'true',
  SAGE_AGENT_GATE_REFERENCE_WORKLOAD_PASS: 'true',
  SAGE_AGENT_GATE_ROLLBACK_PASS: 'true',
} as const;

describe('Phase 3 admission rollout policy', () => {
  it('parses independent dark-launch controls and defaults to safe legacy behavior', () => {
    const defaults = parsePhase3AdmissionFeatureConfig({});
    expect(defaults).toMatchObject({
      packageDarkLaunch: false, registryDarkLaunch: false, shadowAdmission: false,
      canonicalNewWorkload: false, legacyAdapterCutover: false, killSwitch: false,
    });
    const config = parsePhase3AdmissionFeatureConfig({
      ...passingGateEnvironment,
      SAGE_AGENT_PACKAGE_DARK_LAUNCH: 'true', SAGE_AGENT_REGISTRY_DARK_LAUNCH: '1',
      SAGE_AGENT_SHADOW_ADMISSION: 'true', SAGE_AGENT_CANONICAL_NEW_WORKLOAD: 'true',
      SAGE_AGENT_LEGACY_ADAPTER_CUTOVER: 'true', SAGE_AGENT_ADMISSION_TENANT_ALLOWLIST: 'tenant-a',
      SAGE_AGENT_ADMISSION_TASK_TYPE_ALLOWLIST: 'summary.v1',
    });
    expect(selectPhase3AdmissionDecision({ config, tenantId: 'tenant-a', taskType: 'summary.v1' })).toMatchObject({
      packageDarkLaunch: true, registryDarkLaunch: true, shadowAdmission: true,
      canonicalNewWorkload: true, legacyAdapterCutover: true, reason: 'enabled',
    });
  });

  it('keeps canonical admission off for kill switch, incomplete gates or allowlist mismatch', () => {
    const config = parsePhase3AdmissionFeatureConfig({
      SAGE_AGENT_CANONICAL_NEW_WORKLOAD: 'true', SAGE_AGENT_ADMISSION_KILL_SWITCH: 'true',
    });
    expect(selectPhase3AdmissionDecision({ config, tenantId: 'tenant-a', taskType: 'summary.v1' })).toMatchObject({
      canonicalNewWorkload: false, legacyAdapterCutover: false, shadowAdmission: false, reason: 'kill_switch',
    });
    const incomplete = parsePhase3AdmissionFeatureConfig({
      SAGE_AGENT_PACKAGE_DARK_LAUNCH: 'true', SAGE_AGENT_REGISTRY_DARK_LAUNCH: 'true',
      SAGE_AGENT_CANONICAL_NEW_WORKLOAD: 'true', SAGE_AGENT_LEGACY_ADAPTER_CUTOVER: 'true',
      SAGE_AGENT_GATE_DEPENDENCY_PASS: 'true',
    });
    expect(selectPhase3AdmissionDecision({ config: incomplete, tenantId: 'tenant-a', taskType: 'summary.v1' })).toMatchObject({
      packageDarkLaunch: false, registryDarkLaunch: false, canonicalNewWorkload: false,
      legacyAdapterCutover: false, lifecycleOwner: 'legacy', reason: 'gates_incomplete',
    });
    const limited = parsePhase3AdmissionFeatureConfig({
      SAGE_AGENT_CANONICAL_NEW_WORKLOAD: 'true', SAGE_AGENT_ADMISSION_TENANT_ALLOWLIST: 'tenant-a',
    });
    expect(selectPhase3AdmissionDecision({ config: limited, tenantId: 'tenant-b', taskType: 'summary.v1' })).toMatchObject({
      canonicalNewWorkload: false, legacyAdapterCutover: false, reason: 'allowlist_tenant',
    });
  });

  it('produces bounded shadow diff audit without authority side effects', () => {
    const audit = evaluateShadowAdmission({
      tenantId: 'tenant-a', taskType: 'summary.v1', recordedAt: '2030-01-01T00:00:00.000Z',
      legacy: { semanticDigest: digest('a'), routeDigest: digest('b'), grantDigest: digest('c') },
      canonical: { semanticDigest: digest('a'), routeDigest: digest('d'), grantDigest: digest('c') },
    });
    expect(audit).toMatchObject({ semanticEqual: true, routeEqual: false, grantEqual: true, reservationCreated: false, effectClaims: 0, usageSettlements: 0, readableRefs: 0, envelopeIssued: false, dispatches: 0 });
    expect(audit.diffDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(Object.keys(audit).sort()).toEqual(['diffDigest', 'dispatches', 'effectClaims', 'envelopeIssued', 'grantEqual', 'name', 'readableRefs', 'recordedAt', 'reservationCreated', 'routeEqual', 'semanticEqual', 'taskType', 'tenantId', 'usageSettlements']);
  });
});
