import { sha256Digest, type ContentDigest } from '@sage/agent-contracts';

export interface Phase3CanonicalExpansionGates {
  readonly dependency: boolean;
  readonly conformance: boolean;
  readonly shadowDiff: boolean;
  readonly failureInjection: boolean;
  readonly referenceWorkload: boolean;
  readonly rollback: boolean;
}

export interface Phase3AdmissionFeatureConfig {
  readonly packageDarkLaunch: boolean;
  readonly registryDarkLaunch: boolean;
  readonly shadowAdmission: boolean;
  readonly canonicalNewWorkload: boolean;
  readonly legacyAdapterCutover: boolean;
  readonly tenantAllowlist: readonly string[];
  readonly taskTypeAllowlist: readonly string[];
  readonly killSwitch: boolean;
  readonly canonicalExpansionGates: Phase3CanonicalExpansionGates;
}

export interface Phase3AdmissionDecision {
  readonly packageDarkLaunch: boolean;
  readonly registryDarkLaunch: boolean;
  readonly shadowAdmission: boolean;
  readonly canonicalNewWorkload: boolean;
  readonly legacyAdapterCutover: boolean;
  readonly lifecycleOwner: 'legacy' | 'canonical';
  readonly reason: 'disabled' | 'kill_switch' | 'allowlist_tenant' | 'allowlist_task_type' | 'gates_incomplete' | 'enabled';
}

const enabled = (value: string | undefined): boolean => value === '1' || value === 'true' || value === 'TRUE';
const list = (value: string | undefined): readonly string[] => Object.freeze((value ?? '').split(',').map((item) => item.trim()).filter(Boolean));
const included = (values: readonly string[], value: string): boolean => values.length === 0 || values.includes(value);

export function parsePhase3AdmissionFeatureConfig(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): Phase3AdmissionFeatureConfig {
  return Object.freeze({
    packageDarkLaunch: enabled(environment.SAGE_AGENT_PACKAGE_DARK_LAUNCH),
    registryDarkLaunch: enabled(environment.SAGE_AGENT_REGISTRY_DARK_LAUNCH),
    shadowAdmission: enabled(environment.SAGE_AGENT_SHADOW_ADMISSION),
    canonicalNewWorkload: enabled(environment.SAGE_AGENT_CANONICAL_NEW_WORKLOAD),
    legacyAdapterCutover: enabled(environment.SAGE_AGENT_LEGACY_ADAPTER_CUTOVER),
    tenantAllowlist: list(environment.SAGE_AGENT_ADMISSION_TENANT_ALLOWLIST),
    taskTypeAllowlist: list(environment.SAGE_AGENT_ADMISSION_TASK_TYPE_ALLOWLIST),
    killSwitch: enabled(environment.SAGE_AGENT_ADMISSION_KILL_SWITCH),
    canonicalExpansionGates: Object.freeze({
      dependency: enabled(environment.SAGE_AGENT_GATE_DEPENDENCY_PASS),
      conformance: enabled(environment.SAGE_AGENT_GATE_CONFORMANCE_PASS),
      shadowDiff: enabled(environment.SAGE_AGENT_GATE_SHADOW_DIFF_PASS),
      failureInjection: enabled(environment.SAGE_AGENT_GATE_FAILURE_INJECTION_PASS),
      referenceWorkload: enabled(environment.SAGE_AGENT_GATE_REFERENCE_WORKLOAD_PASS),
      rollback: enabled(environment.SAGE_AGENT_GATE_ROLLBACK_PASS),
    }),
  });
}

const allCanonicalExpansionGatesPass = (gates: Phase3CanonicalExpansionGates): boolean =>
  gates.dependency && gates.conformance && gates.shadowDiff && gates.failureInjection && gates.referenceWorkload && gates.rollback;

/** Independent launch controls. The kill switch and incomplete mandatory gates always preserve the legacy owner. */
export function selectPhase3AdmissionDecision(input: {
  readonly config: Phase3AdmissionFeatureConfig;
  readonly tenantId: string;
  readonly taskType: string;
}): Phase3AdmissionDecision {
  const { config } = input;
  if (config.killSwitch) return { ...config, packageDarkLaunch: false, registryDarkLaunch: false, shadowAdmission: false, canonicalNewWorkload: false, legacyAdapterCutover: false, lifecycleOwner: 'legacy', reason: 'kill_switch' };
  if (!included(config.tenantAllowlist, input.tenantId)) return { ...config, canonicalNewWorkload: false, legacyAdapterCutover: false, lifecycleOwner: 'legacy', reason: 'allowlist_tenant' };
  if (!included(config.taskTypeAllowlist, input.taskType)) return { ...config, canonicalNewWorkload: false, legacyAdapterCutover: false, lifecycleOwner: 'legacy', reason: 'allowlist_task_type' };
  if ((config.canonicalNewWorkload || config.legacyAdapterCutover) && !allCanonicalExpansionGatesPass(config.canonicalExpansionGates)) {
    return { ...config, packageDarkLaunch: false, registryDarkLaunch: false, canonicalNewWorkload: false, legacyAdapterCutover: false, lifecycleOwner: 'legacy', reason: 'gates_incomplete' };
  }
  const anyEnabled = config.packageDarkLaunch || config.registryDarkLaunch || config.shadowAdmission || config.canonicalNewWorkload || config.legacyAdapterCutover;
  return { ...config, lifecycleOwner: config.canonicalNewWorkload ? 'canonical' : 'legacy', reason: anyEnabled ? 'enabled' : 'disabled' };
}

export interface ShadowAdmissionInputV1 {
  readonly tenantId: string;
  readonly taskType: string;
  readonly legacy: {
    readonly semanticDigest: ContentDigest;
    readonly routeDigest: ContentDigest;
    readonly grantDigest: ContentDigest;
  };
  readonly canonical: {
    readonly semanticDigest: ContentDigest;
    readonly routeDigest: ContentDigest;
    readonly grantDigest: ContentDigest;
  };
  readonly recordedAt: string;
}

export interface ShadowAdmissionAuditV1 {
  readonly name: 'agent.admission.shadow_diff';
  readonly tenantId: string;
  readonly taskType: string;
  readonly semanticEqual: boolean;
  readonly routeEqual: boolean;
  readonly grantEqual: boolean;
  readonly diffDigest: ContentDigest;
  readonly reservationCreated: false;
  readonly effectClaims: 0;
  readonly usageSettlements: 0;
  readonly readableRefs: 0;
  readonly envelopeIssued: false;
  readonly dispatches: 0;
  readonly recordedAt: string;
}

/**
 * Compares only bounded digests. This pure function has no Ledger, Spec Store,
 * Envelope, Coordinator, or dispatch dependency, so shadow admission cannot create
 * an executable or billable authority record.
 */
export function evaluateShadowAdmission(input: ShadowAdmissionInputV1): ShadowAdmissionAuditV1 {
  const semanticEqual = input.legacy.semanticDigest === input.canonical.semanticDigest;
  const routeEqual = input.legacy.routeDigest === input.canonical.routeDigest;
  const grantEqual = input.legacy.grantDigest === input.canonical.grantDigest;
  const diffDigest = sha256Digest({
    schemaVersion: '1', semanticEqual, routeEqual, grantEqual,
    legacy: input.legacy, canonical: input.canonical,
  });
  return Object.freeze({
    name: 'agent.admission.shadow_diff', tenantId: input.tenantId, taskType: input.taskType,
    semanticEqual, routeEqual, grantEqual, diffDigest,
    reservationCreated: false, effectClaims: 0, usageSettlements: 0, readableRefs: 0,
    envelopeIssued: false, dispatches: 0, recordedAt: input.recordedAt,
  });
}
