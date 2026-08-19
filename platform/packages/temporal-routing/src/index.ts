import { createHash, randomUUID } from 'node:crypto';
import { Connection, NamespaceNotFoundError, WorkflowClient, WorkflowExecutionAlreadyStartedError, WorkflowNotFoundError
} from '@temporalio/client';
import { defaultPayloadConverter } from '@temporalio/common';
import type { P6Correlation, P6TelemetryRecorder } from '@sage/observability';
import type { CredentialProvider, SecretRef } from '@sage/platform-ports';
import {
  TASK_CONTROL_SIGNAL, TASK_NAMESPACE, TASK_QUEUE, TASK_STATE_QUERY, TASK_TARGET, TASK_TYPE, isAgentSliceResult,
  assertCoordinatorTargetSnapshot,
  type AgentTaskWorkflowInput, type CreateTaskRequest, type RouteCandidateEvaluation, type RouteDecision,
  type CoordinatorTargetSnapshot,
  type TaskControl, type TaskProjection, type TaskProjectionStore, type TaskQueryResult, type TaskRoutingRecord,
  type TaskRoutingStore, type TaskTypeId, type TaskWorkflowState, type WorkflowTargetSnapshot, type TaskCreateCorrelation,
  type TaskProjectionEvent, type TaskReconciliationStore, type ProjectionRepairAudit,
  type TaskLifecyclePath
} from '@sage/task-domain';
import {
  assertCoordinatorObservation,
  type CoordinatorObservation, type CoordinatorObservationKey, type DurableCoordinatorPort
} from '@sage/platform-ports';
import type { TaskTypeProfile, TemporalRegistryReader, TemporalTargetProfile } from '@sage/temporal-registry';

export class TaskRetryRejectedError extends Error {
  readonly code = 'TASK_EFFECT_UNKNOWN_REQUIRES_RESOLUTION';
  constructor() { super('Task retry requires an explicit audited resolution for effect_unknown'); }
}
export class TargetOverrideRejectedError extends Error {
  readonly code = 'TARGET_OVERRIDE_REJECTED';
  constructor(readonly fields: readonly string[]) { super(`Untrusted Temporal target override rejected: ${fields.join(',')}`); }
}
export class RoutingUnavailableError extends Error {
  readonly code = 'ROUTING_UNAVAILABLE';
  readonly retryable = true;
  constructor(readonly decision: RouteDecision) { super('No trusted Temporal target satisfies the authenticated routing constraints'); }
}
export class TargetClusterUnavailableError extends Error {
  readonly code = 'TARGET_CLUSTER_UNAVAILABLE';
  readonly retryable = true;
  constructor(readonly targetId: string) { super(`Selected Temporal target is unavailable: ${targetId}`); }
}
export class WorkflowStartOutcomeUnknownError extends Error {
  readonly code = 'WORKFLOW_START_OUTCOME_UNKNOWN';
  readonly retryable = true;
  constructor(readonly targetId: string) { super(`Workflow start outcome is not yet reconciled for target: ${targetId}`); }
}
export class TaskStartOwnerConflictError extends Error {
  readonly code = 'TASK_START_OWNER_CONFLICT';
  readonly retryable = false;
  constructor(readonly taskId: string) { super(`Another lifecycle owner has already claimed task start: ${taskId}`); }
}
/** Adapter signal used only when a start was provably rejected before acceptance. */
export class WorkflowStartDefinitivelyRejectedError extends Error {
  readonly code = 'WORKFLOW_START_DEFINITIVELY_REJECTED';
  constructor() { super('Temporal Workflow start was definitively rejected'); }
}
export class TaskRoutingNotFoundError extends Error {
  readonly code = 'TASK_ROUTING_NOT_FOUND';
  constructor() { super('No persisted target snapshot exists for this task'); }
}
export class TaskLifecycleAdapterUnavailableError extends Error {
  readonly code = 'TASK_LIFECYCLE_ADAPTER_UNAVAILABLE';
  readonly retryable = false;
  constructor(readonly taskId: string, readonly lifecyclePath: string) { super(`No lifecycle adapter is registered for ${lifecyclePath}: ${taskId}`); }
}
export class TargetSnapshotCommitError extends Error {
  readonly code = 'TARGET_SNAPSHOT_COMMIT_FAILED';
  readonly retryable = true;
  constructor(options?: ErrorOptions) { super('Immutable Workflow Target Snapshot could not be persisted and digest-bound', options); }
}

export interface TrustedRuntimeRequirements {
  readonly requirementsDigest: `sha256:${string}`;
  readonly allowedTargetIds?: readonly string[];
  readonly targetProfileVersions?: readonly string[];
  readonly runtimeBuildRefs?: readonly string[];
  readonly adapterRefs?: readonly string[];
  readonly runtimeCompatibilityRefs?: readonly string[];
}
export interface TrustedCompatibilityTaskTypeRequirements {
  readonly taskType: TaskTypeId;
  readonly taskTypeVersion?: string;
  readonly requiredResidencies?: readonly string[];
}
export interface TrustedRouteAuthorities {
  readonly releaseRuntimeRequirements?: TrustedRuntimeRequirements;
  readonly compatibilityTaskTypeRequirements?: TrustedCompatibilityTaskTypeRequirements;
}
export interface TrustedRouteInput {
  readonly taskId: string;
  readonly taskType: TaskTypeId;
  readonly tenantId: string;
  readonly actorId: string;
  readonly contextId: string;
  readonly environment: 'development' | 'staging' | 'production';
  readonly region: string;
  readonly residency: string;
}
export interface TrustedRouteResult { readonly decision: RouteDecision; readonly snapshot: WorkflowTargetSnapshot }
export interface TrustedCoordinatorRouteResult { readonly decision: RouteDecision; readonly snapshot: CoordinatorTargetSnapshot }

const routeKeys = new Set(['taskId', 'taskType', 'tenantId', 'actorId', 'contextId', 'environment', 'region', 'residency']);
const forbiddenRouteKeys = new Set([
  'endpoint', 'address', 'host', 'namespace', 'taskqueue', 'queue', 'cluster', 'clusterid',
  'target', 'targetid', 'credential', 'credentialref', 'secretref', 'connectionref',
  'adapter', 'adapterref', 'runtime', 'runtimeref', 'runtimecompatibility', 'runtimecompatibilityref',
  'package', 'model', 'provider', 'build', 'buildid'
]);
const normalizedKey = (key: string): string => key.replaceAll('_', '').replaceAll('-', '').toLowerCase();

export class TrustedTemporalRouter {
  readonly #registry: TemporalRegistryReader;
  readonly #now: () => Date;
  constructor(options: { registry: TemporalRegistryReader; now?: () => Date }) {
    this.#registry = options.registry;
    this.#now = options.now ?? (() => new Date());
  }

  async route(raw: TrustedRouteInput | Readonly<Record<string, unknown>>, authorities?: TrustedRouteAuthorities): Promise<TrustedRouteResult> {
    const input = this.#validate(raw);
    this.#validateAuthorities(authorities);
    const publication = await this.#registry.getActive();
    const bundle = publication.bundle;
    const taskType = bundle.taskTypes.find((entry) => entry.taskType === input.taskType && entry.enabled);
    const targets = taskType === undefined ? [] : bundle.targets.filter((target) => taskType.targetIds.includes(target.targetId));
    const candidates = taskType === undefined ? [] : targets.map((target) => this.#evaluate(target, input, bundle.policy, taskType, authorities));
    const eligible = targets.filter((target) => candidates.find((candidate) => candidate.targetId === target.targetId)?.eligible)
      .sort((left, right) => right.priority - left.priority || left.fallbackRank - right.fallbackRank || left.backlog - right.backlog || left.targetId.localeCompare(right.targetId));
    const chosen = eligible[0];
    const decisionId = `route-${randomUUID()}`;
    const decidedAt = this.#now().toISOString();
    const base = {
      schemaVersion: '1' as const, decisionId, taskId: input.taskId, taskType: input.taskType,
      tenantId: input.tenantId, actorId: input.actorId, contextId: input.contextId,
      environment: input.environment, region: input.region, residency: input.residency,
      registryVersion: bundle.version, policyVersion: bundle.policy.version,
      ...(authorities?.releaseRuntimeRequirements?.requirementsDigest === undefined ? {} : { requirementsDigest: authorities.releaseRuntimeRequirements.requirementsDigest }),
      candidates, decidedAt
    };
    if (chosen === undefined || taskType === undefined) {
      const decision: RouteDecision = { ...base, rejectionCode: 'ROUTING_UNAVAILABLE',
        explanation: taskType === undefined ? `TaskType ${input.taskType} is not enabled in Registry ${bundle.version}` : 'All trusted candidates were filtered by authenticated constraints or control-plane health/capacity policy' };
      throw new RoutingUnavailableError(decision);
    }
    const decision: RouteDecision = { ...base, chosenTargetId: chosen.targetId,
      explanation: `Selected ${chosen.targetId} by ${bundle.policy.selection}; priority=${chosen.priority}, fallback=${chosen.fallbackRank}, backlog=${chosen.backlog}` };
    const snapshot: WorkflowTargetSnapshot = {
      schemaVersion: '1', snapshotId: `snapshot-${randomUUID()}`, routeDecisionId: decisionId,
      targetId: chosen.targetId, targetProfileVersion: chosen.version, clusterId: chosen.clusterId, isolationKey: chosen.isolationKey,
      endpoint: chosen.endpoint, namespace: chosen.namespace, taskQueue: chosen.taskQueue,
      credentialRef: chosen.credentialRef as WorkflowTargetSnapshot['credentialRef'], taskType: input.taskType,
      taskTypeVersion: taskType.version, policyVersion: bundle.policy.version, registryVersion: bundle.version,
      environment: input.environment, region: chosen.region, residency: chosen.residency, selectedAt: decidedAt,
      adapterRef: chosen.adapterRef ?? 'adapter://legacy-temporal',
      targetRef: chosen.targetRef ?? `target://${chosen.targetId}/${chosen.version}`,
      runtimeCompatibilityRef: chosen.runtimeCompatibilityRef ?? `runtime-compatibility://${taskType.version}`,
      runtimeBuildRef: chosen.runtimeBuildRef!,
      ...(authorities?.releaseRuntimeRequirements?.requirementsDigest === undefined ? {} : { requirementsDigest: authorities.releaseRuntimeRequirements.requirementsDigest }),
      routingRationale: decision.explanation    };
    return { decision: structuredClone(decision), snapshot: structuredClone(snapshot) };
  }

  async routeCoordinator(raw: TrustedRouteInput | Readonly<Record<string, unknown>>, authorities?: TrustedRouteAuthorities): Promise<TrustedCoordinatorRouteResult> {
    const routed = await this.route(raw, authorities);
    const source = routed.snapshot;
    const snapshot: CoordinatorTargetSnapshot = {
      schemaVersion: '1', snapshotId: source.snapshotId, routeDecisionId: source.routeDecisionId,
      targetRef: source.targetRef!, adapterRef: source.adapterRef === 'adapter://legacy-temporal' ? 'adapter://durable-coordinator-v2' : source.adapterRef!, runtimeCompatibilityRef: source.runtimeCompatibilityRef!,
      taskType: source.taskType, taskTypeVersion: source.taskTypeVersion, policyVersion: source.policyVersion,
      registryVersion: source.registryVersion, environment: source.environment, region: source.region,
      residency: source.residency, selectedAt: source.selectedAt
    };
    assertCoordinatorTargetSnapshot(snapshot);
    return {decision: structuredClone(routed.decision), snapshot: structuredClone(snapshot)};
  }

  #validateAuthorities(authorities: TrustedRouteAuthorities | undefined): void {
    if (authorities === undefined) return;
    const assertRefList = (value: readonly string[] | undefined, field: string, prefix: string): void => {
      if (value === undefined) return;
      if (value.length === 0 || value.length > 32 || value.some((item) => typeof item !== 'string' || item.length === 0 || !item.startsWith(prefix))) {
        throw new TargetOverrideRejectedError([field]);
      }
    };
    const release = authorities.releaseRuntimeRequirements;
    if (release !== undefined) {
      const keys = Object.keys(release);
      const allowed = new Set(['requirementsDigest', 'allowedTargetIds', 'targetProfileVersions', 'runtimeBuildRefs', 'adapterRefs', 'runtimeCompatibilityRefs']);
      const unknown = keys.filter((key) => !allowed.has(key));
      if (unknown.length > 0) throw new TargetOverrideRejectedError(unknown);
      if (!/^sha256:[a-f0-9]{64}$/.test(release.requirementsDigest)) throw new TargetOverrideRejectedError(['requirementsDigest']);
      assertRefList(release.allowedTargetIds, 'allowedTargetIds', '');
      assertRefList(release.targetProfileVersions, 'targetProfileVersions', '');
      assertRefList(release.runtimeBuildRefs, 'runtimeBuildRefs', 'runtime://');
      assertRefList(release.adapterRefs, 'adapterRefs', 'adapter://');
      assertRefList(release.runtimeCompatibilityRefs, 'runtimeCompatibilityRefs', 'runtime-compatibility://');
    }
    const compatibility = authorities.compatibilityTaskTypeRequirements;
    if (compatibility !== undefined) {
      const keys = Object.keys(compatibility);
      const allowed = new Set(['taskType', 'taskTypeVersion', 'requiredResidencies']);
      const unknown = keys.filter((key) => !allowed.has(key));
      if (unknown.length > 0) throw new TargetOverrideRejectedError(unknown);
      if (compatibility.taskType !== 'sage.agent-task.v1' && compatibility.taskType !== 'sage.batch-agent-task.v1') throw new TargetOverrideRejectedError(['taskType']);
      if (compatibility.taskTypeVersion !== undefined && compatibility.taskTypeVersion.length === 0) throw new TargetOverrideRejectedError(['taskTypeVersion']);
      assertRefList(compatibility.requiredResidencies, 'requiredResidencies', '');
    }
  }

  #validate(raw: TrustedRouteInput | Readonly<Record<string, unknown>>): TrustedRouteInput {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) throw new TargetOverrideRejectedError(['invalid-input']);
    const keys = Object.keys(raw);
    const overrides = keys.filter((key) => forbiddenRouteKeys.has(normalizedKey(key)));
    if (overrides.length > 0) throw new TargetOverrideRejectedError(overrides);
    const unknown = keys.filter((key) => !routeKeys.has(key));
    if (unknown.length > 0) throw new TargetOverrideRejectedError(unknown);
    const input = raw as unknown as TrustedRouteInput;
    for (const key of routeKeys) if (typeof input[key as keyof TrustedRouteInput] !== 'string' || input[key as keyof TrustedRouteInput].length === 0) {
      throw new TargetOverrideRejectedError([key]);
    }
    if (input.environment !== 'development' && input.environment !== 'staging' && input.environment !== 'production') throw new TargetOverrideRejectedError(['environment']);
    if (input.taskType !== 'sage.agent-task.v1' && input.taskType !== 'sage.batch-agent-task.v1') throw new TargetOverrideRejectedError(['taskType']);
    return input;
  }

  #evaluate(target: TemporalTargetProfile, input: TrustedRouteInput, policy: { requireHealthy: boolean; minimumCapacity: number; maximumBacklog: number }, taskType: TaskTypeProfile, authorities?: TrustedRouteAuthorities): RouteCandidateEvaluation {
    const reasons: string[] = [];
    const release = authorities?.releaseRuntimeRequirements;
    const compatibility = authorities?.compatibilityTaskTypeRequirements;
    if (release?.allowedTargetIds !== undefined && !release.allowedTargetIds.includes(target.targetId)) reasons.push('release-target-not-allowed');
    if (release?.targetProfileVersions !== undefined && !release.targetProfileVersions.includes(target.version)) reasons.push('release-target-profile-incompatible');
    if (release?.runtimeBuildRefs !== undefined && !release.runtimeBuildRefs.includes(target.runtimeBuildRef ?? '')) reasons.push('release-runtime-build-incompatible');
    if (release?.adapterRefs !== undefined && !release.adapterRefs.includes(target.adapterRef ?? 'adapter://legacy-temporal')) reasons.push('release-adapter-incompatible');
    if (release?.runtimeCompatibilityRefs !== undefined && !release.runtimeCompatibilityRefs.includes(target.runtimeCompatibilityRef ?? `runtime-compatibility://${taskType.version}`)) reasons.push('release-runtime-incompatible');
    if (compatibility?.taskType !== undefined && compatibility.taskType !== input.taskType) reasons.push('compatibility-task-type-mismatch');
    if (compatibility?.taskTypeVersion !== undefined && compatibility.taskTypeVersion !== taskType.version) reasons.push('compatibility-task-type-version-mismatch');
    if (compatibility?.requiredResidencies !== undefined && !compatibility.requiredResidencies.includes(input.residency)) reasons.push('compatibility-residency-not-allowed');
    if (!taskType.requiredResidencies.includes(input.residency)) reasons.push('task-type-residency-not-allowed');
    if (!target.enabled) reasons.push('target-disabled');
    if (target.runtimeBuildRef === undefined) reasons.push('runtime-build-unavailable');
    if (target.environment !== input.environment) reasons.push('environment-mismatch');
    if (!target.allowedTenantIds.includes(input.tenantId)) reasons.push('tenant-not-allowed');
    if (target.region !== input.region) reasons.push('region-mismatch');
    if (target.residency !== input.residency) reasons.push('residency-mismatch');
    if (policy.requireHealthy && target.health !== 'healthy') reasons.push(`health-${target.health}`);
    if (target.capacityAvailable < policy.minimumCapacity) reasons.push('capacity-insufficient');
    if (target.backlog > policy.maximumBacklog) reasons.push('backlog-over-limit');
    return {
      targetId: target.targetId, targetProfileVersion: target.version, eligible: reasons.length === 0,
      reasons: reasons.length === 0 ? ['eligible-all-trusted-constraints-satisfied'] : reasons,
      health: target.health, capacityAvailable: target.capacityAvailable, backlog: target.backlog,
      priority: target.priority, fallbackRank: target.fallbackRank
    };
  }
}

export interface TemporalClientConnector {
  connect(snapshot: WorkflowTargetSnapshot, credential: Uint8Array): Promise<WorkflowClient>;
  close?(): Promise<void>;
}

/**
 * The Temporal SDK currently accepts apiKey only as a JavaScript string. That immutable, GC-managed
 * copy cannot be deterministically zeroed; keep the connection process scoped and never log/configure it.
 * The mutable source bytes are still zeroed by TemporalClientFactory immediately after connect returns.
 */
export class DefaultTemporalClientConnector implements TemporalClientConnector {
  readonly #connections: Connection[] = [];
  async connect(snapshot: WorkflowTargetSnapshot, credential: Uint8Array): Promise<WorkflowClient> {
    const apiKey = new TextDecoder().decode(credential);
    const connection = await Connection.connect({ address: snapshot.endpoint, ...(apiKey.length === 0 ? {} : { apiKey }) });
    this.#connections.push(connection);
    return new WorkflowClient({ connection, namespace: snapshot.namespace });
  }
  async close(): Promise<void> { await Promise.all(this.#connections.splice(0).map((connection) => connection.close())); }
}

/**
 * CredentialLease.value ownership transfers to this factory. The exact lease buffer is borrowed by
 * the connector and zeroed in finally, including provider-retained aliases. Errors cross this boundary
 * only as stable redacted codes and never retain an untrusted cause.
 */
export class TemporalClientFactory {
  readonly #credentials: CredentialProvider;
  readonly #connector: TemporalClientConnector;
  readonly #tenantId: string;
  readonly #clients = new Map<string, Promise<WorkflowClient>>();
  constructor(options: { credentials: CredentialProvider; connector?: TemporalClientConnector; tenantId: string }) {
    this.#credentials = options.credentials;
    this.#connector = options.connector ?? new DefaultTemporalClientConnector();
    this.#tenantId = options.tenantId;
  }
  forSnapshot(snapshot: WorkflowTargetSnapshot): Promise<WorkflowClient> {
    const key = JSON.stringify([
      snapshot.targetId, snapshot.targetProfileVersion, snapshot.clusterId, snapshot.endpoint,
      snapshot.namespace, snapshot.taskQueue, snapshot.isolationKey, snapshot.credentialRef
    ]);
    const existing = this.#clients.get(key);
    if (existing) return existing;
    const created = this.#create(snapshot).catch(() => { this.#clients.delete(key); throw new TargetClusterUnavailableError(snapshot.targetId); });
    this.#clients.set(key, created);
    return created;
  }
  async close(): Promise<void> { this.#clients.clear(); await this.#connector.close?.(); }
  async #create(snapshot: WorkflowTargetSnapshot): Promise<WorkflowClient> {
    let credential: Uint8Array | undefined;
    try {
      const lease = await this.#credentials.resolveCredential({
        secretRef: snapshot.credentialRef as SecretRef, tenantId: this.#tenantId,
        environment: snapshot.environment, purpose: 'temporal-workflow-client',
        scope: `${snapshot.clusterId}/${snapshot.namespace}`
      });
      credential = lease.value;
      return await this.#connector.connect(snapshot, credential);
    } finally { credential?.fill(0); }
  }
}

export interface SingleTargetTaskControllerOptions {
  readonly workflow: WorkflowClient;
  readonly projectionStore?: TaskProjectionStore;
  readonly tenantId?: string;
  readonly now?: () => Date;
  readonly controlTimeoutMs?: number;
  readonly projectionFreshnessThresholdMs?: number;
}

export class SingleTargetTaskController {
  readonly #workflow: WorkflowClient;
  readonly #projectionStore: TaskProjectionStore | undefined;
  readonly #tenantId: string;
  readonly #now: () => Date;
  readonly #controlTimeoutMs: number;
  readonly #projectionFreshnessThresholdMs: number;
  constructor(options: SingleTargetTaskControllerOptions) {
    this.#workflow = options.workflow; this.#projectionStore = options.projectionStore;
    this.#tenantId = options.tenantId ?? 'tenant-local'; this.#now = options.now ?? (() => new Date());
    this.#controlTimeoutMs = options.controlTimeoutMs ?? 5_000;
    this.#projectionFreshnessThresholdMs = options.projectionFreshnessThresholdMs ?? 30_000;
    if (this.#workflow.options.namespace !== TASK_NAMESPACE) throw new Error(`TASK_TARGET_NAMESPACE_MUST_BE_${TASK_NAMESPACE}`);
  }
  workflowId(taskId: string): string { return workflowIdFor(this.#tenantId, taskId); }
  async create(request: CreateTaskRequest): Promise<TaskQueryResult> {
    const workflowId = this.workflowId(request.taskId);
    const input: AgentTaskWorkflowInput = {
      schemaVersion: '1', taskType: TASK_TYPE, taskId: request.taskId, tenantId: this.#tenantId,
      workflowId, targetId: TASK_TARGET, inputRef: request.inputRef, attempt: 1,
      maxSlices: request.maxSlices ?? 8, sliceDelayMs: request.sliceDelayMs ?? 10,
      slice: request.slice ?? defaultSlice
    };
    await this.#workflow.start('AgentTaskWorkflow', { workflowId, taskQueue: TASK_QUEUE, args: [input] });
    await this.#tryProjection(projectionFromState(input, { ...initialState(input), status: 'running' }, this.#now().toISOString()));
    return this.query(request.taskId);
  }
  async query(taskId: string): Promise<TaskQueryResult> { return queryTask(this.#workflow, this.#projectionStore, this.#tenantId, taskId, this.workflowId(taskId), this.#now, this.#projectionFreshnessThresholdMs); }
  async signal(taskId: string, kind: 'pause' | 'resume', controlId = `control-${randomUUID()}`): Promise<TaskQueryResult> { return this.#control(taskId, { kind, controlId }); }
  async cancel(taskId: string, controlId = `control-${randomUUID()}`): Promise<TaskQueryResult> { return this.#control(taskId, { kind: 'cancel', controlId }); }
  async retry(taskId: string, controlId = `control-${randomUUID()}`): Promise<TaskQueryResult> {
    const state = await workflowState(this.#workflow, this.workflowId(taskId));
    if (state.status === 'effect_unknown') throw new TaskRetryRejectedError();
    return this.#control(taskId, { kind: 'retry', controlId });
  }
  async #control(taskId: string, control: TaskControl): Promise<TaskQueryResult> {
    const state = await sendControl(this.#workflow, this.workflowId(taskId), control, this.#controlTimeoutMs);
    await this.#tryProjection(projectionFromWorkflow(this.#tenantId, state, this.#now().toISOString(), control.controlId));
    return this.query(taskId);
  }
  async #tryProjection(projection: TaskProjection): Promise<void> { try { await this.#projectionStore?.writeProjection(projection); } catch { /* non-authoritative */ } }
}

export interface TrustedMultiTargetTaskControllerOptions {
  readonly router: TrustedTemporalRouter;
  readonly clientFactory: TemporalClientFactory;
  readonly routingStore: TaskRoutingStore;
  readonly projectionStore?: TaskProjectionStore;
  readonly tenantId: string;
  readonly actorId: string;
  readonly contextId: string;
  readonly environment: 'development' | 'staging' | 'production';
  readonly region: string;
  readonly residency: string;
  readonly now?: () => Date;
  readonly controlTimeoutMs?: number;
  readonly projectionFreshnessThresholdMs?: number;
  readonly reconcileAttempts?: number;
  readonly reconcileDelayMs?: number;
  readonly telemetry?: P6TelemetryRecorder;
}

type DescribeOutcome = 'exists' | 'absent' | 'unknown';

export class TrustedMultiTargetTaskController {
  readonly #options: TrustedMultiTargetTaskControllerOptions;
  readonly #now: () => Date;
  readonly #inflight = new Map<string, Promise<TaskQueryResult>>();
  constructor(options: TrustedMultiTargetTaskControllerOptions) { this.#options = options; this.#now = options.now ?? (() => new Date()); }
  workflowId(taskId: string): string { return workflowIdFor(this.#options.tenantId, taskId); }

  async create(request: CreateTaskRequest, _principal?:unknown, correlation?:TaskCreateCorrelation): Promise<TaskQueryResult> {
    const existing = await this.#options.routingStore.getTaskRouting(this.#options.tenantId, request.taskId);
    if (existing) {
      this.#assertRequestMatchesEnvelope(existing, request, correlation);
      return this.#coordinateStart(existing, false);
    }
    const taskType = request.taskType ?? TASK_TYPE;
    let routed: TrustedRouteResult;
    try {
      routed = await this.#options.router.route({ taskId: request.taskId, taskType, tenantId: this.#options.tenantId,
        actorId: this.#options.actorId, contextId: this.#options.contextId, environment: this.#options.environment,
        region: this.#options.region, residency: this.#options.residency });
    } catch (cause) {
      if (cause instanceof RoutingUnavailableError) await this.#options.routingStore.recordRoutingRejection(cause.decision);
      throw cause;
    }
    const workflowId = this.workflowId(request.taskId);
    const input = workflowInputFromRequest(request, {
      taskType, taskId: request.taskId, tenantId: this.#options.tenantId, workflowId, targetId: routed.snapshot.targetId
    },correlation);
    const record: TaskRoutingRecord = {
      schemaVersion: '1', tenantId: this.#options.tenantId, taskId: request.taskId, workflowId,
      taskType, status: 'start_pending', snapshot: routed.snapshot, decision: routed.decision,
      startEnvelope: {
        schemaVersion: '1', workflowType: 'AgentTaskWorkflow', workflowId,
        taskQueue: routed.snapshot.taskQueue, snapshotId: routed.snapshot.snapshotId,
        targetSnapshotDigest: workflowTargetSnapshotDigest(routed.snapshot), input
      },
      createdAt: this.#now().toISOString()
    };
    let reserved: { readonly status: 'created' | 'existing'; readonly record: TaskRoutingRecord };
    try {
      reserved = await this.#options.routingStore.reserveTaskStart(record);
      this.#assertRecordCoherent(reserved.record);
    } catch (cause) {
      if (cause instanceof Error && cause.message === 'TASK_CREATE_CONFLICT') throw cause;
      throw new TargetSnapshotCommitError({ cause });
    }
    this.#assertRequestMatchesEnvelope(reserved.record, request, correlation);
    this.#emit('sage_task_route_decisions_total',reserved.record,1,{registry_version:reserved.record.snapshot.registryVersion});
    return this.#coordinateStart(reserved.record, reserved.status === 'created');
  }

  /** Reconciles an existing reservation strictly from its immutable envelope and snapshot. */
  async reconcile(taskId: string): Promise<TaskQueryResult> {
    const record = await this.#options.routingStore.getTaskRouting(this.#options.tenantId, taskId);
    if (!record) throw new TaskRoutingNotFoundError();
    return this.#coordinateStart(record, false);
  }

  async query(taskId: string): Promise<TaskQueryResult> {
    const { record, workflow } = await this.#bound(taskId);
    const result = await queryTask(workflow, this.#options.projectionStore, this.#options.tenantId, taskId, record.workflowId, this.#now, this.#options.projectionFreshnessThresholdMs ?? 30_000);
    return { ...result, targetSnapshot: structuredClone(record.snapshot) };
  }
  async signal(taskId: string, kind: 'pause' | 'resume', controlId = `control-${randomUUID()}`): Promise<TaskQueryResult> { return this.#control(taskId, { kind, controlId }); }
  async cancel(taskId: string, controlId = `control-${randomUUID()}`): Promise<TaskQueryResult> { return this.#control(taskId, { kind: 'cancel', controlId }); }
  async retry(taskId: string, controlId = `control-${randomUUID()}`): Promise<TaskQueryResult> {
    const { record, workflow } = await this.#bound(taskId);
    const state = await workflowState(workflow, record.workflowId);
    if (state.status === 'effect_unknown') throw new TaskRetryRejectedError();
    return this.#controlBound(record, workflow, { kind: 'retry', controlId });
  }

  #coordinateStart(record: TaskRoutingRecord, reservationCreated: boolean): Promise<TaskQueryResult> {
    const key = `${record.tenantId}:${record.taskId}`;
    const existing = this.#inflight.get(key);
    if (existing) return existing;
    const operation = this.#startOrReconcile(record, reservationCreated).finally(() => this.#inflight.delete(key));
    this.#inflight.set(key, operation);
    return operation;
  }

  async #startOrReconcile(record: TaskRoutingRecord, reservationCreated: boolean): Promise<TaskQueryResult> {
    this.#assertRecordCoherent(record);
    assertLegacyTemporalPath(record);
    if (record.status === 'target_unavailable') throw new TargetClusterUnavailableError(record.snapshot.targetId);
    const lifecyclePath = record.lifecyclePath ?? 'LEGACY_TEMPORAL_TASK';
    const ownerToken = record.ownerToken ?? `owner://legacy-temporal/${record.tenantId}/${record.taskId}`;
    const startIdempotencyKey = record.startIdempotencyKey ?? `start://legacy-temporal/${record.tenantId}/${record.taskId}`;
    const claim = await this.#options.routingStore.claimTaskStart(record.tenantId, record.taskId, lifecyclePath, ownerToken, startIdempotencyKey);
    if (claim.status === 'owner_conflict') throw new TaskStartOwnerConflictError(record.taskId);
    const activeRecord = claim.record ?? record;
    this.#assertRecordCoherent(activeRecord);
    if (activeRecord.status === 'started') return this.query(activeRecord.taskId);
    let workflow: WorkflowClient;
    try {
      workflow = await this.#options.clientFactory.forSnapshot(activeRecord.snapshot);
    } catch {
      this.#emit('sage_temporal_target_unavailable_total',activeRecord,1,{phase:'connect'});
      // Provider resolution and connector establishment happen after the owner CAS. Their failures
      // cannot prove a definitive start rejection, so the same owner/key remains STARTING.
      throw new WorkflowStartOutcomeUnknownError(activeRecord.snapshot.targetId);
    }

    if (!reservationCreated || claim.status === 'already_claimed') {
      const prior = await this.#describe(workflow, activeRecord.workflowId);
      if (prior === 'exists') {
        if (!await this.#markStarted(activeRecord)) throw new WorkflowStartOutcomeUnknownError(activeRecord.snapshot.targetId);
        return this.query(activeRecord.taskId);
      }
      if (prior === 'unknown') throw new WorkflowStartOutcomeUnknownError(activeRecord.snapshot.targetId);
    }

    try {
      await workflow.start(activeRecord.startEnvelope.workflowType, {
        workflowId: activeRecord.startEnvelope.workflowId,
        taskQueue: activeRecord.startEnvelope.taskQueue,
        args: [structuredClone(activeRecord.startEnvelope.input)]
      });
      if (!await this.#markStarted(activeRecord)) throw new WorkflowStartOutcomeUnknownError(activeRecord.snapshot.targetId);
      return this.query(activeRecord.taskId);
    } catch (cause) {
      if (cause instanceof WorkflowStartOutcomeUnknownError) throw cause;
      if (cause instanceof WorkflowExecutionAlreadyStartedError) {
        if (!await this.#markStarted(activeRecord)) throw new WorkflowStartOutcomeUnknownError(activeRecord.snapshot.targetId);
        return this.query(activeRecord.taskId);
      }
      const outcome = await this.#describe(workflow, activeRecord.workflowId);
      if (outcome === 'exists') {
        if (!await this.#markStarted(activeRecord)) throw new WorkflowStartOutcomeUnknownError(activeRecord.snapshot.targetId);
        return this.query(activeRecord.taskId);
      }
      if (outcome === 'absent' && isDefinitiveStartRejection(cause)) {
        if (!await this.#markUnavailable(activeRecord)) throw new WorkflowStartOutcomeUnknownError(activeRecord.snapshot.targetId);
        throw new TargetClusterUnavailableError(activeRecord.snapshot.targetId);
      }
      throw new WorkflowStartOutcomeUnknownError(activeRecord.snapshot.targetId);
    }
  }

  #assertRecordCoherent(record: TaskRoutingRecord): void {
    const envelope = record.startEnvelope;
    if (envelope.workflowId !== record.workflowId || envelope.snapshotId !== record.snapshot.snapshotId
      || envelope.targetSnapshotDigest !== workflowTargetSnapshotDigest(record.snapshot)
      || envelope.taskQueue !== record.snapshot.taskQueue || envelope.input.workflowId !== record.workflowId
      || envelope.input.taskId !== record.taskId || envelope.input.tenantId !== record.tenantId
      || envelope.input.taskType !== record.taskType || envelope.input.targetId !== record.snapshot.targetId) {
      throw new Error('TASK_START_ENVELOPE_INVALID');
    }
  }
  #assertRequestMatchesEnvelope(record: TaskRoutingRecord, request: CreateTaskRequest, correlation?:TaskCreateCorrelation): void {
    this.#assertRecordCoherent(record);
    const expected = workflowInputFromRequest(request, {
      taskType: request.taskType ?? TASK_TYPE, taskId: record.taskId, tenantId: record.tenantId,
      workflowId: record.workflowId, targetId: record.snapshot.targetId
    },correlation);
    if (canonicalJson(expected) !== canonicalJson(record.startEnvelope.input)) throw new Error('TASK_CREATE_CONFLICT');
  }
  async #describe(workflow: WorkflowClient, workflowId: string): Promise<DescribeOutcome> {
    const attempts = this.#options.reconcileAttempts ?? 3;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try { await workflow.getHandle(workflowId).describe(); return 'exists'; }
      catch (cause) {
        if (cause instanceof WorkflowNotFoundError) return 'absent';
        if (attempt < attempts) await this.#delay();
      }
    }
    return 'unknown';
  }
  async #markStarted(record: TaskRoutingRecord): Promise<boolean> {
    const attempts = this.#options.reconcileAttempts ?? 3;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        const ownerToken = record.ownerToken ?? `owner://legacy-temporal/${record.tenantId}/${record.taskId}`;
        const startIdempotencyKey = record.startIdempotencyKey ?? `start://legacy-temporal/${record.tenantId}/${record.taskId}`;
        await this.#options.routingStore.markWorkflowStarted(record.tenantId, record.taskId, this.#now().toISOString(), ownerToken, startIdempotencyKey);
        return true;
      }
      catch { if (attempt < attempts) await this.#delay(); }
    }
    return false;
  }
  async #markUnavailable(record: TaskRoutingRecord): Promise<boolean> {
    const attempts = this.#options.reconcileAttempts ?? 3;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        const ownerToken = record.ownerToken ?? `owner://legacy-temporal/${record.tenantId}/${record.taskId}`;
        const startIdempotencyKey = record.startIdempotencyKey ?? `start://legacy-temporal/${record.tenantId}/${record.taskId}`;
        await this.#options.routingStore.markTargetUnavailable(record.tenantId, record.taskId, 'TARGET_CLUSTER_UNAVAILABLE', ownerToken, startIdempotencyKey);
        return true;
      }
      catch { if (attempt < attempts) await this.#delay(); }
    }
    return false;
  }
  async #delay(): Promise<void> { await new Promise((resolve) => setTimeout(resolve, this.#options.reconcileDelayMs ?? 20)); }

  async #bound(taskId: string): Promise<{ record: TaskRoutingRecord; workflow: WorkflowClient }> {
    const record = await this.#options.routingStore.getTaskRouting(this.#options.tenantId, taskId);
    if (!record) throw new TaskRoutingNotFoundError();
    if (record.status === 'target_unavailable') throw new TargetClusterUnavailableError(record.snapshot.targetId);
    this.#assertRecordCoherent(record);
    assertLegacyTemporalPath(record);
    return { record, workflow: await this.#options.clientFactory.forSnapshot(record.snapshot) };
  }
  async #control(taskId: string, control: TaskControl): Promise<TaskQueryResult> {
    const { record, workflow } = await this.#bound(taskId);
    return this.#controlBound(record, workflow, control);
  }
  #emit(name:Parameters<P6TelemetryRecorder['record']>[0],record:TaskRoutingRecord,value:number,fields:Readonly<Record<string,unknown>>={}):void{
    const correlation=p6Correlation(record);if(!correlation)return;
    try{this.#options.telemetry?.record(name,value,correlation,fields);}catch{/* Telemetry cannot change Task semantics. */}
  }
  async #controlBound(record: TaskRoutingRecord, workflow: WorkflowClient, control: TaskControl): Promise<TaskQueryResult> {
    const state = await sendControl(workflow, record.workflowId, control, this.#options.controlTimeoutMs ?? 5_000);
    try { await this.#options.projectionStore?.writeProjection(projectionFromWorkflow(record.tenantId, state, this.#now().toISOString(), control.controlId)); } catch { /* non-authoritative */ }
    return this.query(record.taskId);
  }
}

function isDefinitiveStartRejection(cause: unknown): boolean {
  return cause instanceof WorkflowStartDefinitivelyRejectedError || cause instanceof NamespaceNotFoundError;
}

function workflowInputFromRequest(request: CreateTaskRequest, identity: {
  taskType: TaskTypeId; taskId: string; tenantId: string; workflowId: string; targetId: string;
},correlation?:TaskCreateCorrelation): AgentTaskWorkflowInput {
  return {
    schemaVersion: '1', ...identity, inputRef: request.inputRef, ...(correlation??{}), attempt: 1,
    maxSlices: request.maxSlices ?? 8, sliceDelayMs: request.sliceDelayMs ?? 10,
    slice: request.slice ?? defaultSlice
  };
}

const defaultSlice = { maxTurns: 1, maxToolCalls: 4, maxTokens: 8_000, timeoutMs: 10_000 } as const;
function workflowIdFor(tenantId: string, taskId: string): string {
  const digest = createHash('sha256').update(`${tenantId}:${taskId}`).digest('hex').slice(0, 20);
  return `sage-task-${taskId.slice(0, 80)}-${digest}`;
}
function initialState(input: AgentTaskWorkflowInput): TaskWorkflowState {
  return { schemaVersion: '1', taskType: input.taskType, taskId: input.taskId, workflowId: input.workflowId,
    targetId: input.targetId, attempt: 1, status: 'running', committedSlices: 0, manualRetries: 0 };
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
function projectionFromState(input: AgentTaskWorkflowInput, state: TaskWorkflowState, timestamp: string): TaskProjection {
  return { schemaVersion: '1', taskType: input.taskType, tenantId: input.tenantId, taskId: input.taskId, workflowId: input.workflowId,
    targetId: input.targetId, attempt: state.attempt, status: state.status, revision: state.committedSlices,
    projectionSource: 'writer', historyEventId: '0',
    projectionUpdatedAt: timestamp, historyObservedAt: timestamp };
}
function projectionFromWorkflow(tenantId: string, state: TaskWorkflowState, timestamp: string, controlId?: string): TaskProjection {
  return { schemaVersion: '1', taskType: state.taskType, tenantId, taskId: state.taskId, workflowId: state.workflowId,
    targetId: state.targetId, attempt: state.attempt, status: state.status, revision: state.committedSlices,
    projectionSource: 'writer', historyEventId: '0',
    ...(state.checkpointRef === undefined ? {} : { checkpointRef: state.checkpointRef }),
    ...(state.artifactRef === undefined ? {} : { artifactRef: state.artifactRef }),
    ...(controlId === undefined ? {} : { lastControlId: controlId }), projectionUpdatedAt: timestamp, historyObservedAt: timestamp };
}
async function workflowState(workflow: WorkflowClient, workflowId: string): Promise<TaskWorkflowState> {
  const handle = workflow.getHandle(workflowId);
  const description = await handle.describe();
  if (description.status.name !== 'RUNNING') return await handle.result() as TaskWorkflowState;
  try { return await handle.query<TaskWorkflowState>(TASK_STATE_QUERY); }
  catch (cause) { const after = await handle.describe(); if (after.status.name === 'RUNNING') throw cause; return await handle.result() as TaskWorkflowState; }
}
async function queryTask(workflow: WorkflowClient, store: TaskProjectionStore | undefined, tenantId: string, taskId: string, workflowId: string, now: () => Date, freshnessThresholdMs: number): Promise<TaskQueryResult> {
  const state = await workflowState(workflow, workflowId);
  let projection: TaskProjection | undefined;
  try { projection = await store?.getProjection(tenantId, taskId); } catch { /* History remains authoritative. */ }
  if (!projection) return { workflow: state, projectionFreshness: 'unavailable' };
  const ageMs = Math.max(0, now().getTime() - Date.parse(projection.projectionUpdatedAt));
  const fresh = projection.revision === state.committedSlices && projection.status === state.status && ageMs <= freshnessThresholdMs;
  return { workflow: state, projection, projectionFreshness: fresh ? 'fresh' : 'stale' };
}
async function sendControl(workflow: WorkflowClient, workflowId: string, control: TaskControl, timeoutMs: number): Promise<TaskWorkflowState> {
  const handle = workflow.getHandle(workflowId);
  await handle.signal(TASK_CONTROL_SIGNAL, control);
  const deadline = Date.now() + timeoutMs;
  let state: TaskWorkflowState;
  do {
    state = await handle.query<TaskWorkflowState>(TASK_STATE_QUERY);
    if (state.lastControlId === control.controlId) return state;
    await new Promise((resolve) => setTimeout(resolve, 20));
  } while (Date.now() < deadline);
  throw new Error('TASK_CONTROL_NOT_OBSERVED_IN_HISTORY');
}


function p6Correlation(record:TaskRoutingRecord):P6Correlation|undefined{
  const input=record.startEnvelope.input;
  if(!input.sessionId||!input.runId||!input.messageId)return undefined;
  return {tenant_id:record.tenantId,message_id:input.messageId,session_id:input.sessionId,run_id:input.runId,task_id:record.taskId,workflow_id:record.workflowId,target_id:record.snapshot.targetId,attempt:input.attempt};
}

export interface TaskHistoryObservation {
  readonly state: TaskWorkflowState; readonly observedHistoryEventId: string; readonly events: readonly TaskProjectionEvent[];
  readonly logicalCursor?: string; readonly authorityReceiptDigest?: string;
}
export interface DurableCoordinatorObservationSource {
  read(record: TaskRoutingRecord): Promise<TaskHistoryObservation>;
}

function coordinatorTaskStatus(observation: CoordinatorObservation): TaskWorkflowState['status'] {
  switch (observation.state) {
    case 'PAUSED': return 'paused';
    case 'COMPLETED': return 'succeeded';
    case 'FAILED':
    case 'TIMED_OUT': return 'failed';
    case 'CANCELLED': return 'cancelled';
    case 'EFFECT_UNKNOWN': return 'effect_unknown';
    default: return 'running';
  }
}
function coordinatorObservationState(observation: CoordinatorObservation, record: TaskRoutingRecord): TaskWorkflowState {
  return {
    schemaVersion: '1', taskType: record.taskType, taskId: record.taskId, workflowId: record.workflowId,
    targetId: record.snapshot.targetId, attempt: record.startEnvelope.input.attempt ?? 1,
    status: coordinatorTaskStatus(observation), committedSlices: observation.revision, manualRetries: 0,
    ...(observation.lastReceipt?.checkpointRef === undefined ? {} : { checkpointRef: observation.lastReceipt.checkpointRef }),
    ...(observation.lastReceipt?.artifactRefs[0] === undefined ? {} : { artifactRef: observation.lastReceipt.artifactRefs[0] as `artifact://${string}` }),
    ...(observation.lastReceipt?.errorCode === undefined ? {} : { failureCode: observation.lastReceipt.errorCode })
  };
}
function coordinatorEvents(observation: CoordinatorObservation, record: TaskRoutingRecord): TaskProjectionEvent[] {
  const sequence = Math.max(1, observation.logicalCursor.sequence);
  const base = { schemaVersion: '1' as const, tenantId: record.tenantId, taskId: record.taskId, workflowId: record.workflowId,
    targetId: record.snapshot.targetId, attempt: record.startEnvelope.input.attempt ?? 1, sequence, occurredAt: record.createdAt };
  const events: TaskProjectionEvent[] = [{ ...base, eventId: `coordinator-observation-${sequence}`, sourceEventId: `coordinator-observation-${observation.logicalCursor.cursorRef}`,
    kind: 'task', type: `coordinator.${observation.state.toLowerCase()}`, payload: { cursorRef: observation.logicalCursor.cursorRef,
      ...(observation.logicalCursor.previousCursorRef === undefined ? {} : { previousCursorRef: observation.logicalCursor.previousCursorRef }),
      ...(observation.logicalCursor.nextCursorRef === undefined ? {} : { nextCursorRef: observation.logicalCursor.nextCursorRef }),
      sequence: observation.logicalCursor.sequence, stateDigest: observation.logicalCursor.stateDigest, revision: observation.revision } }];
  const receipt = observation.lastReceipt;
  if (receipt) events.push({ ...base, eventId: `coordinator-receipt-${receipt.receiptRef}`, sourceEventId: `coordinator-receipt-${receipt.receiptRef}`,
    kind: 'agent', type: `coordinator.receipt.${receipt.outcome.toLowerCase()}`, payload: { receiptRef: receipt.receiptRef, receiptDigest: receipt.receiptDigest,
      outcome: receipt.outcome, receiptRefs: receipt.receiptRefs, artifactRefs: receipt.artifactRefs, ...(receipt.checkpointRef === undefined ? {} : { checkpointRef: receipt.checkpointRef }) } });
  return events;
}

/** Reads V2 authority at a stable H1 -> observation/receipts -> H2 boundary. */
export interface DurableCoordinatorCursorReader {
  read(key: CoordinatorObservationKey, cursorRef: string): Promise<CoordinatorObservation | undefined>;
}

class DurableCoordinatorObservationError extends Error {
  constructor(readonly code: 'TARGET_UNAVAILABLE' | 'CHAIN_MISSING' | 'CHAIN_CONFLICT' | 'RECEIPT_UNAVAILABLE' | 'OBSERVATION_UNSTABLE', message: string) { super(message); }
}

function assertCoordinatorReceiptBoundary(observation: CoordinatorObservation): void {
  const receiptRefs = [...observation.receiptRefs, ...(observation.lastReceipt?.receiptRefs ?? [])];
  if (receiptRefs.some((ref) => !ref.startsWith('receipt://'))) throw new DurableCoordinatorObservationError('RECEIPT_UNAVAILABLE', 'V2_COORDINATOR_RECEIPT_REF_INVALID');
  if (observation.lastReceipt && !observation.receiptRefs.includes(observation.lastReceipt.receiptRef)) {
    throw new DurableCoordinatorObservationError('RECEIPT_UNAVAILABLE', 'V2_COORDINATOR_RECEIPT_BOUNDARY_MISSING');
  }
  if (['COMPLETED', 'FAILED', 'CANCELLED', 'TIMED_OUT', 'EFFECT_UNKNOWN'].includes(observation.state) && !observation.lastReceipt) {
    throw new DurableCoordinatorObservationError('RECEIPT_UNAVAILABLE', 'V2_COORDINATOR_TERMINAL_RECEIPT_UNAVAILABLE');
  }
}

function coordinatorObservationIdentity(observation: CoordinatorObservation): string {
  return JSON.stringify({ tenantId: observation.tenantId, taskId: observation.taskId, attemptId: observation.attemptId,
    specDigest: observation.specDigest, path: observation.path, ownerRef: observation.ownerRef, targetRef: observation.targetRef,
    adapterRef: observation.adapterRef, runtimeRef: observation.runtimeRef });
}

function coordinatorChainFingerprint(chain: readonly CoordinatorObservation[]): string {
  return JSON.stringify(chain.map((observation) => ({
    identity: coordinatorObservationIdentity(observation), cursor: observation.logicalCursor,
    state: observation.state, revision: observation.revision, dispatchEpoch: observation.dispatchEpoch,
    controlSequence: observation.controlSequence, activeInvocationId: observation.activeInvocationId,
    requestedControl: observation.requestedControl, effectiveControl: observation.effectiveControl,
    receiptRefs: observation.receiptRefs, artifactRefs: observation.artifactRefs, lastReceipt: observation.lastReceipt,
    blockedCode: observation.blockedCode
  })));
}

/** Reads a bounded logical chain and rejects missing, cyclic, or discontinuous continue-as-new links. */
export class DurableCoordinatorHistorySource implements DurableCoordinatorObservationSource {
  readonly #maxChainDepth: number;
  constructor(readonly options: {
    readonly coordinator: DurableCoordinatorPort;
    readonly keyForRecord: (record: TaskRoutingRecord) => CoordinatorObservationKey | undefined;
    readonly cursorReader?: DurableCoordinatorCursorReader;
    readonly maxChainDepth?: number;
  }) {
    const depth = options.maxChainDepth ?? 128;
    if (!Number.isInteger(depth) || depth < 1 || depth > 512) throw new Error('INVALID_V2_CHAIN_DEPTH');
    this.#maxChainDepth = depth;
  }
  async #readChain(key: CoordinatorObservationKey, anchor: CoordinatorObservation): Promise<CoordinatorObservation[]> {
    assertCoordinatorObservation(anchor);
    assertCoordinatorReceiptBoundary(anchor);
    const chain: CoordinatorObservation[] = [anchor];
    const seen = new Set([anchor.logicalCursor.cursorRef]);
    let current = anchor;
    while (current.logicalCursor.previousCursorRef !== undefined) {
      if (!this.options.cursorReader) throw new DurableCoordinatorObservationError('CHAIN_MISSING', 'V2_COORDINATOR_CHAIN_SOURCE_UNAVAILABLE');
      if (chain.length >= this.#maxChainDepth) throw new DurableCoordinatorObservationError('CHAIN_CONFLICT', 'V2_COORDINATOR_CHAIN_DEPTH_EXCEEDED');
      const previousRef = current.logicalCursor.previousCursorRef;
      if (seen.has(previousRef)) throw new DurableCoordinatorObservationError('CHAIN_CONFLICT', 'V2_COORDINATOR_CHAIN_CYCLE');
      const previous = await this.options.cursorReader.read(key, previousRef);
      if (!previous) throw new DurableCoordinatorObservationError('CHAIN_MISSING', 'V2_COORDINATOR_CHAIN_MISSING');
      assertCoordinatorObservation(previous);
      assertCoordinatorReceiptBoundary(previous);
      if (coordinatorObservationIdentity(previous) !== coordinatorObservationIdentity(anchor)) throw new DurableCoordinatorObservationError('CHAIN_CONFLICT', 'V2_COORDINATOR_CHAIN_IDENTITY_CONFLICT');
      if (previous.logicalCursor.sequence >= current.logicalCursor.sequence) throw new DurableCoordinatorObservationError('CHAIN_CONFLICT', 'V2_COORDINATOR_CHAIN_SEQUENCE_CONFLICT');
      if (previous.logicalCursor.nextCursorRef !== undefined && previous.logicalCursor.nextCursorRef !== current.logicalCursor.cursorRef) {
        throw new DurableCoordinatorObservationError('CHAIN_CONFLICT', 'V2_COORDINATOR_CHAIN_LINK_CONFLICT');
      }
      seen.add(previous.logicalCursor.cursorRef);
      chain.push(previous);
      current = previous;
    }
    return chain.reverse();
  }
  async read(record: TaskRoutingRecord): Promise<TaskHistoryObservation> {
    const key = this.options.keyForRecord(record);
    if (!key) throw new Error('V2_COORDINATOR_OBSERVATION_KEY_UNAVAILABLE');
    let health: Awaited<ReturnType<DurableCoordinatorPort['health']>>;
    try { health = await this.options.coordinator.health(); } catch { throw new DurableCoordinatorObservationError('TARGET_UNAVAILABLE', 'V2_COORDINATOR_TARGET_UNAVAILABLE'); }
    if (!health.healthy) throw new DurableCoordinatorObservationError('TARGET_UNAVAILABLE', 'V2_COORDINATOR_TARGET_UNAVAILABLE');
    const firstAnchor = await this.options.coordinator.observe(key);
    if (!firstAnchor) throw new DurableCoordinatorObservationError('CHAIN_MISSING', 'V2_COORDINATOR_OBSERVATION_UNAVAILABLE');
    const firstChain = await this.#readChain(key, firstAnchor);
    const secondAnchor = await this.options.coordinator.observe(key);
    if (!secondAnchor) throw new DurableCoordinatorObservationError('CHAIN_MISSING', 'V2_COORDINATOR_OBSERVATION_UNAVAILABLE');
    const secondChain = await this.#readChain(key, secondAnchor);
    if (coordinatorChainFingerprint(firstChain) !== coordinatorChainFingerprint(secondChain)) throw new DurableCoordinatorObservationError('OBSERVATION_UNSTABLE', 'V2_COORDINATOR_OBSERVATION_UNSTABLE');
    const latest = secondChain.at(-1)!;
    const state = coordinatorObservationState(latest, record);
    return { state, observedHistoryEventId: String(latest.logicalCursor.sequence), events: secondChain.flatMap((observation) => coordinatorEvents(observation, record)),
      ...(latest.lastReceipt?.receiptDigest===undefined?{}:{authorityReceiptDigest:latest.lastReceipt.receiptDigest}), logicalCursor: latest.logicalCursor.cursorRef };
  }
}

export interface TaskProjectionReconcilerOptions {
  readonly tenantId:string; readonly store:TaskReconciliationStore; readonly clientFactory:TemporalClientFactory;
  readonly historySource?:TaskHistorySource; readonly v2HistorySource?:DurableCoordinatorObservationSource; readonly batchSize?:number; readonly freshnessThresholdMs?:number; readonly now?:()=>Date;
  readonly telemetry?:P6TelemetryRecorder;
}

export interface TaskHistorySource {
  read(workflow: WorkflowClient, record: TaskRoutingRecord): Promise<TaskHistoryObservation>;
}

function temporalHistoryOccurredAt(event:{eventTime?:unknown},fallback:string):string{
  const value=event.eventTime;if(!value||typeof value!=='object')return fallback;
  const timestamp=value as {seconds?:unknown;nanos?:unknown};
  const secondsValue=timestamp.seconds;
  const seconds=typeof secondsValue==='number'?secondsValue:Number(typeof secondsValue==='object'&&secondsValue!==null&&'toString' in secondsValue?(secondsValue as {toString():string}).toString():secondsValue);
  const nanos=typeof timestamp.nanos==='number'?timestamp.nanos:0;
  const millis=seconds*1000+Math.floor(nanos/1_000_000);
  return Number.isFinite(millis)&&millis>0?new Date(millis).toISOString():fallback;
}

/** Accepts state only when the History cursor is unchanged across H1 -> state -> H2. */
export class TemporalTaskHistorySource implements TaskHistorySource {
  readonly #maxStabilityAttempts:number;
  constructor(options:{readonly maxStabilityAttempts?:number}={}){
    const attempts=options.maxStabilityAttempts??3;
    if(!Number.isInteger(attempts)||attempts<1||attempts>10)throw new Error('INVALID_HISTORY_STABILITY_ATTEMPTS');
    this.#maxStabilityAttempts=attempts;
  }
  async read(workflow: WorkflowClient, record: TaskRoutingRecord): Promise<TaskHistoryObservation> {
    const handle = workflow.getHandle(record.workflowId);
    let acceptedHistory:Awaited<ReturnType<typeof handle.fetchHistory>>|undefined;
    let state:TaskWorkflowState|undefined;
    let lastHistoryId='0';
    for(let attempt=0;attempt<this.#maxStabilityAttempts;attempt+=1){
      const first=await handle.fetchHistory();
      const firstEvents=first.events??[];
      const firstCursor=String(firstEvents.at(-1)?.eventId??0);
      const observedState=await workflowState(workflow,record.workflowId);
      const second=await handle.fetchHistory();
      const secondEvents=second.events??[];
      const secondCursor=String(secondEvents.at(-1)?.eventId??0);
      if(firstCursor===secondCursor){acceptedHistory=second;state=observedState;lastHistoryId=secondCursor;break;}
    }
    if(!acceptedHistory||!state)throw new Error('TEMPORAL_HISTORY_OBSERVATION_UNSTABLE');
    const rawEvents = acceptedHistory.events ?? [];
    const events: TaskProjectionEvent[] = rawEvents.flatMap((event, index) => {
      const attributes = Object.keys(event).find((key) => key.endsWith('EventAttributes') && event[key as keyof typeof event] !== undefined) ?? 'temporalHistory';
      const sequence = Number(event.eventId ?? index + 1);
      const occurredAt = temporalHistoryOccurredAt(event,record.createdAt);
      const taskEvent:TaskProjectionEvent = {
        schemaVersion:'1',eventId:`task-event-${record.taskId}-${sequence}`,sourceEventId:`temporal-history-${sequence}`,
        tenantId:record.tenantId,taskId:record.taskId,workflowId:record.workflowId,targetId:record.snapshot.targetId,
        attempt:state.attempt,sequence:Math.max(1,sequence),kind:'task',type:`temporal.${attributes.replace('EventAttributes','')}`,
        occurredAt,payload:{historyEventId:String(event.eventId ?? sequence)}
      };
      const payload=event.activityTaskCompletedEventAttributes?.result?.payloads?.[0];
      if(!payload)return [taskEvent];
      let result:unknown;
      try{result=defaultPayloadConverter.fromPayload(payload);}catch{return [taskEvent];}
      if(!isAgentSliceResult(result))return [taskEvent];
      const agentEvent:TaskProjectionEvent={
        schemaVersion:'1',eventId:`agent-event-${record.taskId}-${sequence}`,sourceEventId:`temporal-history-${sequence}:agent-result`,
        tenantId:record.tenantId,taskId:record.taskId,workflowId:record.workflowId,targetId:record.snapshot.targetId,
        attempt:state.attempt,sequence:Math.max(1,sequence),kind:'agent',
        type:result.outcome==='effect_unknown'?'agent.task.effect_unknown':result.done?'agent.task.succeeded':'agent.task.slice_committed',
        occurredAt,payload:{historyEventId:String(event.eventId ?? sequence),sliceNumber:result.sliceNumber,duplicate:result.duplicate,
          ...(result.checkpointRef===undefined?{}:{checkpointRef:result.checkpointRef}),...(result.artifactRef===undefined?{}:{artifactRef:result.artifactRef})}
      };
      return [taskEvent,agentEvent];
    });
    return {state,observedHistoryEventId:lastHistoryId,events};
  }
}

export interface ReconcileBatchResult { readonly inspected:number; readonly repaired:number; readonly failed:number }

export class TaskProjectionReconciler {
  readonly #options:TaskProjectionReconcilerOptions;
  readonly #history:TaskHistorySource;
  readonly #now:()=>Date;
  constructor(options:TaskProjectionReconcilerOptions){
    const batchSize=options.batchSize??50;
    if(!Number.isInteger(batchSize)||batchSize<1||batchSize>500) throw new Error('INVALID_RECONCILE_BATCH_SIZE');
    this.#options=options;this.#history=options.historySource??new TemporalTaskHistorySource();this.#now=options.now??(()=>new Date());
  }
  async runBatch():Promise<ReconcileBatchResult>{
    const batchSize=this.#options.batchSize??50;
    const threshold=this.#options.freshnessThresholdMs??30_000;
    const candidates=await this.#options.store.listReconciliationCandidates(this.#options.tenantId,batchSize,this.#now(),threshold);
    let repaired=0;let failed=0;
    for(const candidate of candidates){
      const record=candidate.routing;
      let pending:ProjectionRepairAudit|undefined;
      try{pending=await this.#options.store.getPendingRepairAudit(record.tenantId,record.taskId);}
      catch{failed+=1;await this.#recordFailure(record,'AUDIT_WRITE_FAILED');continue;}
      if(pending){
        try{await this.#options.store.appendRepairAudit(pending);await this.#options.store.completePendingRepairAudit(pending.repairId);repaired+=1;}
        catch{failed+=1;this.#emit('sage_task_reconcile_retryable_failure_total',record,1,{failure_code:'AUDIT_WRITE_FAILED',repair_id:pending.repairId});}
        continue;
      }
      const lifecyclePath:TaskLifecyclePath = record.lifecyclePath ?? 'LEGACY_TEMPORAL_TASK';
      let workflow:WorkflowClient|undefined;
      try{
        if(lifecyclePath==='LEGACY_TEMPORAL_TASK') {
          // Client resolution is exclusively from the immutable persisted snapshot; Registry is never consulted here.
          workflow=await this.#options.clientFactory.forSnapshot(record.snapshot);
        } else if(!this.#options.v2HistorySource) {
          throw new TaskLifecycleAdapterUnavailableError(record.taskId, lifecyclePath);
        }
      }catch{
        failed+=1;await this.#recordFailure(record,'TARGET_CLUSTER_UNAVAILABLE');continue;
      }
      let observed:TaskHistoryObservation;
      try{
        observed=lifecyclePath==='DURABLE_COORDINATOR_V2'
          ? await this.#options.v2HistorySource!.read(record)
          : await this.#history.read(workflow!,record);
        this.#emit('sage_task_projection_lag_ms',record,Math.max(0,this.#now().getTime()-Date.parse(candidate.projection?.projectionUpdatedAt??record.createdAt)),{history_event_id:observed.observedHistoryEventId});
      }
      catch(error){
        failed+=1;
        const failureCode = error instanceof DurableCoordinatorObservationError && error.code === 'TARGET_UNAVAILABLE'
          ? 'TARGET_CLUSTER_UNAVAILABLE' as const : 'HISTORY_READ_FAILED' as const;
        await this.#recordFailure(record,failureCode);continue;
      }
      let inserted:number;
      try{inserted=await this.#options.store.appendProjectionEvents(observed.events);}
      catch{failed+=1;await this.#recordFailure(record,'EVENT_APPEND_FAILED',observed.observedHistoryEventId);continue;}
      const timestamp=this.#now().toISOString();
      const projection:TaskProjection={schemaVersion:'1',taskType:observed.state.taskType,tenantId:record.tenantId,taskId:record.taskId,
        workflowId:record.workflowId,targetId:record.snapshot.targetId,attempt:observed.state.attempt,status:observed.state.status,
        revision:observed.state.committedSlices,projectionSource:'history',historyEventId:observed.observedHistoryEventId,
        ...(observed.state.checkpointRef===undefined?{}:{checkpointRef:observed.state.checkpointRef}),
        ...(observed.state.artifactRef===undefined?{}:{artifactRef:observed.state.artifactRef}),
        ...(observed.state.lastControlId===undefined?{}:{lastControlId:observed.state.lastControlId}),
        ...(record.lifecyclePath===undefined?{}:{lifecyclePath:record.lifecyclePath}),
        ...(record.ownerToken===undefined?{}:{ownerToken:record.ownerToken}),
        ...(record.adapterRef===undefined?{}:{adapterRef:record.adapterRef}),
        ...(record.runtimeRef===undefined?{}:{runtimeRef:record.runtimeRef}),
        ...((observed.logicalCursor===undefined && record.logicalCursor===undefined)?{}:{logicalCursor:observed.logicalCursor??record.logicalCursor}),
        ...(observed.authorityReceiptDigest===undefined?{}:{authorityReceiptDigest:observed.authorityReceiptDigest}),
        projectionFreshness:'fresh', projectionUpdatedAt:timestamp,historyObservedAt:timestamp};
      const changed=candidate.projection===undefined||candidate.projection.revision!==projection.revision||candidate.projection.status!==projection.status
        ||candidate.projection.historyEventId!==projection.historyEventId||candidate.projection.logicalCursor!==projection.logicalCursor
        ||candidate.projection.authorityReceiptDigest!==projection.authorityReceiptDigest||inserted>0;
      if(changed)this.#emit('sage_task_projection_drift_total',record,1,{history_event_id:observed.observedHistoryEventId,previous_revision:candidate.projection?.revision??-1,repaired_revision:projection.revision});
      const audit:ProjectionRepairAudit={repairId:`repair-${record.snapshot.snapshotId}-${observed.observedHistoryEventId}-${projection.revision}-${projection.status}`,
        tenantId:record.tenantId,taskId:record.taskId,workflowId:record.workflowId,targetId:record.snapshot.targetId,snapshotId:record.snapshot.snapshotId,
        observedHistoryEventId:observed.observedHistoryEventId,outcome:changed?'repaired':'noop',retryable:false,repairedEventCount:inserted,
        ...(candidate.projection===undefined?{}:{previousRevision:candidate.projection.revision}),repairedRevision:projection.revision,repairedAt:timestamp};
      let durableAudit:ProjectionRepairAudit;
      try{durableAudit=await this.#options.store.writeProjectionWithRepairAudit(projection,audit);}
      catch{failed+=1;await this.#recordFailure(record,'PROJECTION_WRITE_FAILED',observed.observedHistoryEventId,inserted);continue;}
      try{await this.#options.store.appendRepairAudit(durableAudit);await this.#options.store.completePendingRepairAudit(durableAudit.repairId);repaired+=1;}
      catch{failed+=1;this.#emit('sage_task_reconcile_retryable_failure_total',record,1,{failure_code:'AUDIT_WRITE_FAILED',repair_id:durableAudit.repairId});}
    }
    return {inspected:candidates.length,repaired,failed};
  }
  async #recordFailure(record:TaskRoutingRecord,failureCode:NonNullable<ProjectionRepairAudit['failureCode']>,observedHistoryEventId='unavailable',repairedEventCount=0):Promise<void>{
    const timestamp=this.#now().toISOString();this.#emit('sage_task_reconcile_retryable_failure_total',record,1,{failure_code:failureCode});
    try{await this.#options.store.appendRepairAudit({repairId:`repair-failure-${record.taskId}-${failureCode}-${randomUUID()}`,tenantId:record.tenantId,taskId:record.taskId,
      workflowId:record.workflowId,targetId:record.snapshot.targetId,snapshotId:record.snapshot.snapshotId,observedHistoryEventId,
      outcome:'retryable_failure',retryable:true,repairedEventCount,failureCode,repairedAt:timestamp});}
    catch{/* A failed audit sink cannot be recursively audited. The failed batch remains retryable. */}
  }
  #emit(name:Parameters<P6TelemetryRecorder['record']>[0],record:TaskRoutingRecord,value:number,fields:Readonly<Record<string,unknown>>={}):void{
    const correlation=p6Correlation(record);if(!correlation)return;
    try{this.#options.telemetry?.record(name,value,correlation,fields);}catch{/* Telemetry cannot change reconciliation. */}
  }
}

function assertLegacyTemporalPath(record: TaskRoutingRecord): void {
  const path = record.lifecyclePath ?? 'LEGACY_TEMPORAL_TASK';
  if (path !== 'LEGACY_TEMPORAL_TASK') throw new TaskLifecycleAdapterUnavailableError(record.taskId, path);
}

export const workflowTargetSnapshotDigest = (snapshot: WorkflowTargetSnapshot): `sha256:${string}` =>
  `sha256:${createHash('sha256').update(canonicalJson(snapshot)).digest('hex')}`;
