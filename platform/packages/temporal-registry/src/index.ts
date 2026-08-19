import { randomUUID } from 'node:crypto';
import { Type, type Static } from 'typebox';
import { Value } from 'typebox/value';
import { BATCH_TASK_TYPE, TASK_TYPE, TaskTypeIdSchema, type TaskTypeId } from '@sage/task-domain';

const Id = Type.String({ minLength: 1, maxLength: 128, pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]*$' });
const Timestamp = Type.String({ format: 'date-time' });
const Reason = Type.String({ minLength: 1, maxLength: 1_024 });
const CredentialRef = Type.String({ pattern: '^secret://[^\\s]+$', maxLength: 2_048 });
const Environment = Type.Union([Type.Literal('development'), Type.Literal('staging'), Type.Literal('production')]);

export const TaskTypeProfileSchema = Type.Object({
  schemaVersion: Type.Literal('1'), taskType: TaskTypeIdSchema, version: Id, enabled: Type.Boolean(),
  targetIds: Type.Array(Id, { minItems: 1 }), requiredResidencies: Type.Array(Id, { minItems: 1 }),
  defaultMaxSlices: Type.Integer({ minimum: 1, maximum: 100 })
}, { additionalProperties: false, $id: 'TaskTypeProfile.v1' });
export type TaskTypeProfile = Static<typeof TaskTypeProfileSchema>;

export const TemporalTargetProfileSchema = Type.Object({
  schemaVersion: Type.Literal('1'), targetId: Id, version: Id, enabled: Type.Boolean(),
  clusterId: Id, endpoint: Type.String({ minLength: 1, maxLength: 512 }), namespace: Id, taskQueue: Id,
  credentialRef: CredentialRef, environment: Environment, region: Id, residency: Id,
  allowedTenantIds: Type.Array(Id, { minItems: 1 }), isolationKey: Id,
  adapterRef: Type.Optional(Type.String({ pattern: '^adapter://[^\\s]+$', maxLength: 2_048 })),
  targetRef: Type.Optional(Type.String({ pattern: '^target://[^\\s]+$', maxLength: 2_048 })),
  runtimeCompatibilityRef: Type.Optional(Type.String({ pattern: '^runtime-compatibility://[^\\s]+$', maxLength: 2_048 })),
  runtimeBuildRef: Type.Optional(Type.String({ pattern: '^runtime://[^\\s]+$', maxLength: 2_048 })),
  health: Type.Union([Type.Literal('healthy'), Type.Literal('degraded'), Type.Literal('unavailable')]),
  capacityAvailable: Type.Integer({ minimum: 0 }), backlog: Type.Integer({ minimum: 0 }),
  priority: Type.Integer(), fallbackRank: Type.Integer({ minimum: 0 })
}, { additionalProperties: false, $id: 'TemporalTargetProfile.v1' });
export type TemporalTargetProfile = Static<typeof TemporalTargetProfileSchema>;

export const RoutingPolicySchema = Type.Object({
  schemaVersion: Type.Literal('1'), policyId: Id, version: Id,
  requireHealthy: Type.Boolean(), minimumCapacity: Type.Integer({ minimum: 1 }),
  maximumBacklog: Type.Integer({ minimum: 0 }), selection: Type.Literal('priority-fallback-backlog-target-id')
}, { additionalProperties: false, $id: 'RoutingPolicy.v1' });
export type RoutingPolicy = Static<typeof RoutingPolicySchema>;

export const TemporalRegistryBundleSchema = Type.Object({
  schemaVersion: Type.Literal('1'), registryId: Id, version: Id, ownerId: Id, createdAt: Timestamp,
  policy: RoutingPolicySchema,
  taskTypes: Type.Array(TaskTypeProfileSchema, { minItems: 1 }),
  targets: Type.Array(TemporalTargetProfileSchema, { minItems: 1 })
}, { additionalProperties: false, $id: 'TemporalRegistryBundle.v1' });
export type TemporalRegistryBundle = Static<typeof TemporalRegistryBundleSchema>;

export const RegistryApprovalAuthorizationSchema = Type.Object({ authenticationId: Id }, {
  additionalProperties: false, $id: 'RegistryApprovalAuthorization.v1'
});
export type RegistryApprovalAuthorization = Static<typeof RegistryApprovalAuthorizationSchema>;

export const AuthenticatedRegistryPrincipalSchema = Type.Object({
  principalId: Id, roles: Type.Array(Id, { minItems: 1 })
}, { additionalProperties: false, $id: 'AuthenticatedRegistryPrincipal.v1' });
export type AuthenticatedRegistryPrincipal = Static<typeof AuthenticatedRegistryPrincipalSchema>;

export const RegistryApprovalSchema = Type.Object({
  approvalId: Id, approverId: Id, approverRole: Type.Literal('temporal-registry-approver'),
  authenticationId: Id, approvedAt: Timestamp, reason: Reason
}, { additionalProperties: false, $id: 'RegistryApproval.v1' });
export type RegistryApproval = Static<typeof RegistryApprovalSchema>;

export interface RegistryApprovalAuthorizer {
  authenticate(authorization: RegistryApprovalAuthorization): AuthenticatedRegistryPrincipal | undefined;
}
export type RegistryAuditAction = 'submitted' | 'approved' | 'published' | 'rollback';
export interface RegistryAuditRecord {
  readonly sequence: number;
  readonly registryId: string;
  readonly version: string;
  readonly action: RegistryAuditAction;
  readonly actorId: string;
  readonly occurredAt: string;
  readonly reason: string;
  readonly fromVersion?: string;
}
export interface RegistryPublication {
  readonly bundle: TemporalRegistryBundle;
  readonly approval: RegistryApproval;
  readonly publishedAt: string;
  readonly publishedBy: string;
}
export interface TemporalRegistryReader { getActive(): Promise<RegistryPublication>; }

const clone = <T>(value: T): T => structuredClone(value);
const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`).join(',')}}`;
  }
  return JSON.stringify(value);
};
const assertReason = (reason: string): void => {
  if (reason.trim().length === 0 || reason.length > 1_024) throw new RegistryGovernanceError('REGISTRY_AUDIT_REASON_REQUIRED');
};
const assertBundle = (bundle: TemporalRegistryBundle): void => {
  if (!Value.Check(TemporalRegistryBundleSchema, bundle)) throw new RegistryGovernanceError('REGISTRY_SCHEMA_INVALID');
  if (new Set(bundle.taskTypes.map((entry) => entry.taskType)).size !== bundle.taskTypes.length) throw new RegistryGovernanceError('REGISTRY_TASK_TYPE_DUPLICATE');
  if (new Set(bundle.targets.map((entry) => entry.targetId)).size !== bundle.targets.length) throw new RegistryGovernanceError('REGISTRY_TARGET_DUPLICATE');
  const targets = new Set(bundle.targets.map((entry) => entry.targetId));
  for (const taskType of bundle.taskTypes) for (const targetId of taskType.targetIds) {
    if (!targets.has(targetId)) throw new RegistryGovernanceError('REGISTRY_TARGET_REFERENCE_INVALID');
  }
  const isolationKeys = new Set<string>();
  for (const target of bundle.targets) {
    const key = `${target.clusterId}:${target.namespace}:${target.isolationKey}`;
    if (isolationKeys.has(key)) throw new RegistryGovernanceError('REGISTRY_ISOLATION_COLLISION');
    isolationKeys.add(key);
  }
};

export class RegistryGovernanceError extends Error {
  constructor(readonly code: string) { super(code); }
}

/**
 * Immutable, audited Registry workflow. approve() accepts only an authentication reference and
 * delegates identity/role proof to a trusted authorizer; caller-supplied "human" claims are absent.
 * AI review may be recorded externally but can never satisfy this authorization boundary.
 */
export class VersionedTemporalRegistry implements TemporalRegistryReader {
  readonly #registryId: string;
  readonly #ownerId: string;
  readonly #authorizer: RegistryApprovalAuthorizer;
  readonly #clock: () => Date;
  readonly #drafts = new Map<string, TemporalRegistryBundle>();
  readonly #approvals = new Map<string, RegistryApproval>();
  readonly #publications = new Map<string, RegistryPublication>();
  readonly #artifactCatalog = new Map<string, string>();
  readonly #audit: RegistryAuditRecord[] = [];
  #activeVersion: string | undefined;

  constructor(options: {
    ownerId: string;
    approvalAuthorizer: RegistryApprovalAuthorizer;
    registryId?: string;
    now?: () => Date;
  }) {
    this.#registryId = options.registryId ?? 'sage-temporal-routing';
    this.#ownerId = options.ownerId;
    this.#authorizer = options.approvalAuthorizer;
    this.#clock = options.now ?? (() => new Date());
  }

  submit(bundle: TemporalRegistryBundle, actorId: string, reason: string): void {
    assertReason(reason);
    if (actorId !== this.#ownerId || bundle.ownerId !== this.#ownerId) throw new RegistryGovernanceError('REGISTRY_OWNER_REQUIRED');
    if (bundle.registryId !== this.#registryId) throw new RegistryGovernanceError('REGISTRY_ID_IMMUTABLE');
    assertBundle(bundle);
    if (this.#drafts.has(bundle.version) || this.#publications.has(bundle.version)) throw new RegistryGovernanceError('REGISTRY_VERSION_IMMUTABLE');
    this.#assertArtifactsImmutable(bundle);
    this.#drafts.set(bundle.version, clone(bundle));
    this.#catalogArtifacts(bundle);
    this.#record(bundle.version, 'submitted', actorId, reason);
  }

  approve(version: string, authorization: RegistryApprovalAuthorization, reason: string): RegistryApproval {
    assertReason(reason);
    if (!this.#drafts.has(version)) throw new RegistryGovernanceError('REGISTRY_VERSION_NOT_SUBMITTED');
    if (!Value.Check(RegistryApprovalAuthorizationSchema, authorization)) throw new RegistryGovernanceError('REGISTRY_APPROVAL_AUTHORIZATION_INVALID');
    const principal = this.#authorizer.authenticate(clone(authorization));
    if (!principal || !Value.Check(AuthenticatedRegistryPrincipalSchema, principal)
      || !principal.roles.includes('temporal-registry-approver')) throw new RegistryGovernanceError('HUMAN_APPROVAL_REQUIRED');
    if (principal.principalId === this.#ownerId) throw new RegistryGovernanceError('REGISTRY_SEPARATION_OF_DUTIES_REQUIRED');
    if (this.#approvals.has(version)) throw new RegistryGovernanceError('REGISTRY_APPROVAL_IMMUTABLE');
    const approval: RegistryApproval = {
      approvalId: `approval-${randomUUID()}`, approverId: principal.principalId,
      approverRole: 'temporal-registry-approver', authenticationId: authorization.authenticationId,
      approvedAt: this.#clock().toISOString(), reason
    };
    if (!Value.Check(RegistryApprovalSchema, approval)) throw new RegistryGovernanceError('REGISTRY_APPROVAL_INVALID');
    this.#approvals.set(version, clone(approval));
    this.#record(version, 'approved', approval.approverId, approval.reason);
    return clone(approval);
  }

  publish(version: string, actorId: string, reason: string): RegistryPublication {
    assertReason(reason);
    if (actorId !== this.#ownerId) throw new RegistryGovernanceError('REGISTRY_OWNER_REQUIRED');
    const bundle = this.#drafts.get(version);
    const approval = this.#approvals.get(version);
    if (!bundle || !approval || !Value.Check(RegistryApprovalSchema, approval)) throw new RegistryGovernanceError('REGISTRY_APPROVAL_REQUIRED');
    if (this.#publications.has(version)) throw new RegistryGovernanceError('REGISTRY_VERSION_IMMUTABLE');
    const publication = { bundle: clone(bundle), approval: clone(approval), publishedAt: this.#clock().toISOString(), publishedBy: actorId };
    this.#publications.set(version, publication);
    this.#activeVersion = version;
    this.#record(version, 'published', actorId, reason);
    return clone(publication);
  }

  rollback(toVersion: string, actorId: string, reason: string): RegistryPublication {
    assertReason(reason);
    if (actorId !== this.#ownerId) throw new RegistryGovernanceError('REGISTRY_OWNER_REQUIRED');
    const publication = this.#publications.get(toVersion);
    if (!publication) throw new RegistryGovernanceError('REGISTRY_ROLLBACK_VERSION_NOT_APPROVED');
    const fromVersion = this.#activeVersion;
    this.#activeVersion = toVersion;
    this.#record(toVersion, 'rollback', actorId, reason, fromVersion);
    return clone(publication);
  }

  async getActive(): Promise<RegistryPublication> {
    const publication = this.#activeVersion === undefined ? undefined : this.#publications.get(this.#activeVersion);
    if (!publication) throw new RegistryGovernanceError('REGISTRY_NOT_PUBLISHED');
    return clone(publication);
  }

  auditLog(): readonly RegistryAuditRecord[] { return clone(this.#audit); }
  publication(version: string): RegistryPublication | undefined { const value = this.#publications.get(version); return value && clone(value); }

  #artifacts(bundle: TemporalRegistryBundle): readonly (readonly [string, unknown])[] {
    return [
      [`policy:${bundle.policy.policyId}:${bundle.policy.version}`, bundle.policy],
      ...bundle.taskTypes.map((entry) => [`taskType:${entry.taskType}:${entry.version}`, entry] as const),
      ...bundle.targets.map((entry) => [`target:${entry.targetId}:${entry.version}`, entry] as const)
    ];
  }
  #assertArtifactsImmutable(bundle: TemporalRegistryBundle): void {
    for (const [key, artifact] of this.#artifacts(bundle)) {
      const known = this.#artifactCatalog.get(key);
      if (known !== undefined && known !== canonical(artifact)) throw new RegistryGovernanceError('REGISTRY_ARTIFACT_VERSION_IMMUTABLE');
    }
  }
  #catalogArtifacts(bundle: TemporalRegistryBundle): void {
    for (const [key, artifact] of this.#artifacts(bundle)) this.#artifactCatalog.set(key, canonical(artifact));
  }
  #record(version: string, action: RegistryAuditAction, actorId: string, reason: string, fromVersion?: string): void {
    this.#audit.push({ sequence: this.#audit.length + 1, registryId: this.#registryId, version, action, actorId,
      occurredAt: this.#clock().toISOString(), reason, ...(fromVersion === undefined ? {} : { fromVersion }) });
  }
}

export const DEV_TARGET_US = 'sage-dev-us' as const;
export const DEV_TARGET_EU = 'sage-dev-eu' as const;
export const DEV_QUEUE_US = 'sage-agent-task-us-v1' as const;
export const DEV_QUEUE_EU = 'sage-agent-task-eu-v1' as const;

export function createDevRegistryBundle(version = 'registry-dev-v1', options: {
  usHealth?: TemporalTargetProfile['health']; euHealth?: TemporalTargetProfile['health'];
  usCapacity?: number; euCapacity?: number; usBacklog?: number; euBacklog?: number;
} = {}): TemporalRegistryBundle {
  const endpoint = process.env.SAGE_TEMPORAL_ADDRESS ?? '127.0.0.1:17233';
  const target = (targetId: string, region: 'us-east' | 'eu-west', residency: 'us' | 'eu', taskQueue: string, priority: number): TemporalTargetProfile => ({
    schemaVersion: '1', targetId, version: `${targetId}-v1`, enabled: true, clusterId: 'sage-dev-cluster', endpoint,
    namespace: 'sage-dev', taskQueue, credentialRef: `secret://temporal/${targetId}`, environment: 'development',
    region, residency, allowedTenantIds: ['tenant-p5', 'tenant-local'], isolationKey: `${targetId}-namespace-queue`,
    health: targetId === DEV_TARGET_US ? (options.usHealth ?? 'healthy') : (options.euHealth ?? 'healthy'),
    runtimeBuildRef: `runtime://${targetId}/${targetId}-runtime-v1`,
    capacityAvailable: targetId === DEV_TARGET_US ? (options.usCapacity ?? 10) : (options.euCapacity ?? 10),
    backlog: targetId === DEV_TARGET_US ? (options.usBacklog ?? 0) : (options.euBacklog ?? 0), priority, fallbackRank: priority === 100 ? 0 : 1
  });
  return {
    schemaVersion: '1', registryId: 'sage-temporal-routing', version, ownerId: 'control-plane-owner', createdAt: new Date(0).toISOString(),
    policy: { schemaVersion: '1', policyId: 'trusted-dev-routing', version: 'policy-dev-v1', requireHealthy: true, minimumCapacity: 1, maximumBacklog: 100, selection: 'priority-fallback-backlog-target-id' },
    taskTypes: [
      { schemaVersion: '1', taskType: TASK_TYPE, version: 'agent-task-profile-v1', enabled: true, targetIds: [DEV_TARGET_US, DEV_TARGET_EU], requiredResidencies: ['us', 'eu'], defaultMaxSlices: 8 },
      { schemaVersion: '1', taskType: BATCH_TASK_TYPE, version: 'batch-task-profile-v1', enabled: true, targetIds: [DEV_TARGET_US, DEV_TARGET_EU], requiredResidencies: ['us', 'eu'], defaultMaxSlices: 20 }
    ],
    targets: [target(DEV_TARGET_US, 'us-east', 'us', DEV_QUEUE_US, 100), target(DEV_TARGET_EU, 'eu-west', 'eu', DEV_QUEUE_EU, 90)]
  };
}

const devApprovalAuthorizer: RegistryApprovalAuthorizer = {
  authenticate(authorization) {
    return authorization.authenticationId === 'dev-human-approver-session'
      ? { principalId: 'dev-human-approver-fixture', roles: ['temporal-registry-approver'] }
      : undefined;
  }
};
export function publishDevRegistry(bundle = createDevRegistryBundle()): VersionedTemporalRegistry {
  const registry = new VersionedTemporalRegistry({ ownerId: 'control-plane-owner', approvalAuthorizer: devApprovalAuthorizer });
  registry.submit(bundle, 'control-plane-owner', 'dev fixture submission');
  registry.approve(bundle.version, { authenticationId: 'dev-human-approver-session' }, 'test fixture approval, not production authorization');
  registry.publish(bundle.version, 'control-plane-owner', 'dev fixture publication');
  return registry;
}

export type { TaskTypeId };
