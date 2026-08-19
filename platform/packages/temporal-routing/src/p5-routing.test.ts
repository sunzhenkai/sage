import { describe, expect, it } from 'vitest';
import type { WorkflowClient } from '@temporalio/client';
import type { CredentialLease, CredentialProvider, CredentialResolutionRequest } from '@sage/platform-ports';
import { TASK_TYPE, type WorkflowTargetSnapshot } from '@sage/task-domain';
import { createDevRegistryBundle, publishDevRegistry } from '@sage/temporal-registry';
import type { VersionedTemporalRegistry } from '@sage/temporal-registry';
import {
  RoutingUnavailableError, TargetClusterUnavailableError, TargetOverrideRejectedError, TemporalClientFactory,
  TrustedTemporalRouter, type TemporalClientConnector
} from './index.js';

const input = { taskId: 'task-route-1', taskType: TASK_TYPE, tenantId: 'tenant-p5', actorId: 'actor-1', contextId: 'request-1', environment: 'development' as const, region: 'us-east', residency: 'us' };
function published(bundle = createDevRegistryBundle()): VersionedTemporalRegistry { return publishDevRegistry(bundle); }

describe('trusted Temporal route matrix', () => {
  it('filters authenticated region/residency and records every candidate rationale with complete identity', async () => {
    const router = new TrustedTemporalRouter({ registry: published() });
    const us = await router.route(input);
    expect(us.snapshot).toMatchObject({
      targetId: 'sage-dev-us', isolationKey: 'sage-dev-us-namespace-queue', clusterId: 'sage-dev-cluster'
    });
    expect(us.decision.candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ targetId: 'sage-dev-us', eligible: true, reasons: ['eligible-all-trusted-constraints-satisfied'] }),
      expect.objectContaining({ targetId: 'sage-dev-eu', eligible: false, reasons: expect.arrayContaining(['region-mismatch', 'residency-mismatch']) })
    ]));
    const eu = await router.route({ ...input, taskId: 'task-route-2', region: 'eu-west', residency: 'eu' });
    expect(eu.snapshot).toMatchObject({ targetId: 'sage-dev-eu', taskQueue: 'sage-agent-task-eu-v1', registryVersion: 'registry-dev-v1' });
  });

  it('enforces TaskType residency as a real routing control with explicit candidate rationale', async () => {
    const bundle = createDevRegistryBundle('registry-task-residency');
    bundle.taskTypes[0] = { ...bundle.taskTypes[0]!, requiredResidencies: ['eu'] };
    try {
      await new TrustedTemporalRouter({ registry: published(bundle) }).route(input);
      throw new Error('expected route failure');
    } catch (cause) {
      expect(cause).toBeInstanceOf(RoutingUnavailableError);
      const decision = (cause as RoutingUnavailableError).decision;
      expect(decision.candidates).toHaveLength(2);
      expect(decision.candidates.every((candidate) => candidate.reasons.includes('task-type-residency-not-allowed'))).toBe(true);
    }
  });

  it('uses health/capacity/backlog, priority and fallback deterministically with an explanation', async () => {
    const bundle = createDevRegistryBundle('registry-fallback', { usHealth: 'unavailable' });
    bundle.targets[1] = { ...bundle.targets[1]!, region: 'us-east', residency: 'us', priority: 90, fallbackRank: 1 };
    const result = await new TrustedTemporalRouter({ registry: published(bundle) }).route(input);
    expect(result.snapshot.targetId).toBe('sage-dev-eu');
    expect(result.decision.explanation).toContain('priority=90');
    expect(result.decision.candidates.find((candidate) => candidate.targetId === 'sage-dev-us')?.reasons).toContain('health-unavailable');
  });

  it('strictly rejects endpoint/namespace/taskQueue aliases and all unknown fields', async () => {
    const router = new TrustedTemporalRouter({ registry: published() });
    for (const override of [{ endpoint: 'evil:7233' }, { namespace: 'evil' }, { taskQueue: 'evil' }, { target_id: 'evil' }, { clusterId: 'evil' }]) {
      await expect(router.route({ ...input, ...override })).rejects.toBeInstanceOf(TargetOverrideRejectedError);
    }
    await expect(router.route({ ...input, modelHint: 'pick-eu' })).rejects.toMatchObject({ code: 'TARGET_OVERRIDE_REJECTED' });
  });
  it('builds a ref-only coordinator snapshot from trusted registry metadata and rejects raw coordinator fields', async () => {
    const router = new TrustedTemporalRouter({ registry: published() });
    const result = await router.routeCoordinator(input);
    expect(result.snapshot).toMatchObject({
      targetRef: 'target://sage-dev-us/sage-dev-us-v1', adapterRef: 'adapter://durable-coordinator-v2',
      runtimeCompatibilityRef: 'runtime-compatibility://agent-task-profile-v1', registryVersion: 'registry-dev-v1'
    });
    expect(result.snapshot).not.toHaveProperty('endpoint');
    expect(result.snapshot).not.toHaveProperty('namespace');
    expect(result.snapshot).not.toHaveProperty('taskQueue');
    for (const override of [{ adapterRef: 'adapter://evil' }, { runtimeCompatibilityRef: 'runtime-compatibility://evil' }, { packageId: 'pkg' }, { provider: 'model' }]) {
      await expect(router.routeCoordinator({ ...input, ...override })).rejects.toBeInstanceOf(TargetOverrideRejectedError);
    }
  });


  it('returns auditable ROUTING_UNAVAILABLE when health, capacity or legal constraints remove all targets', async () => {
    const bundle = createDevRegistryBundle('registry-none', { usCapacity: 0, euCapacity: 0 });
    try {
      await new TrustedTemporalRouter({ registry: published(bundle) }).route(input);
      throw new Error('expected route failure');
    } catch (cause) {
      expect(cause).toBeInstanceOf(RoutingUnavailableError);
      expect(cause).toMatchObject({ code: 'ROUTING_UNAVAILABLE', decision: { rejectionCode: 'ROUTING_UNAVAILABLE' } });
      expect((cause as RoutingUnavailableError).decision.chosenTargetId).toBeUndefined();
      expect((cause as RoutingUnavailableError).decision.candidates[0]?.reasons).toContain('capacity-insufficient');
    }
  });
});

class CapturingCredentialProvider implements CredentialProvider {
  request: CredentialResolutionRequest | undefined;
  retainedLease: Uint8Array | undefined;
  readonly secretText = 'credential-value-must-never-persist';
  async resolveCredential(request: CredentialResolutionRequest): Promise<CredentialLease> {
    this.request = structuredClone(request);
    this.retainedLease = new TextEncoder().encode(this.secretText);
    return { value: this.retainedLease, expiresAt: '2099-01-01T00:00:00.000Z', scope: request.scope };
  }
  async health() { return { healthy: true, checkedAt: new Date(0).toISOString() }; }
}
class CapturingConnector implements TemporalClientConnector {
  credentialSeen: Uint8Array | undefined;
  readonly snapshots: WorkflowTargetSnapshot[] = [];
  constructor(readonly failWithSecret = false) {}
  async connect(snapshot: WorkflowTargetSnapshot, credential: Uint8Array): Promise<WorkflowClient> {
    this.credentialSeen = credential;
    this.snapshots.push(structuredClone(snapshot));
    if (this.failWithSecret) throw new Error(`connector leaked ${new TextDecoder().decode(credential)}`);
    return { options: { namespace: snapshot.namespace } } as WorkflowClient;
  }
}

describe('credential-reference-only Temporal Client Factory', () => {
  it('transfers and zeroes the provider lease itself and never adds values to snapshot', async () => {
    const snapshot = (await new TrustedTemporalRouter({ registry: published() }).route(input)).snapshot;
    const credentials = new CapturingCredentialProvider();
    const connector = new CapturingConnector();
    const factory = new TemporalClientFactory({ credentials, connector, tenantId: 'tenant-p5' });
    await factory.forSnapshot(snapshot);
    expect(credentials.request).toEqual({ secretRef: 'secret://temporal/sage-dev-us', tenantId: 'tenant-p5', environment: 'development', purpose: 'temporal-workflow-client', scope: 'sage-dev-cluster/sage-dev' });
    expect(connector.credentialSeen).toBe(credentials.retainedLease);
    expect(credentials.retainedLease).toEqual(new Uint8Array(credentials.secretText.length));
    expect(JSON.stringify(snapshot)).not.toContain(credentials.secretText);
    expect(snapshot.credentialRef).toBe('secret://temporal/sage-dev-us');
  });

  it('redacts connector/provider causes from errors, serialization and log-shaped output while zeroing bytes', async () => {
    const snapshot = (await new TrustedTemporalRouter({ registry: published() }).route(input)).snapshot;
    const credentials = new CapturingCredentialProvider();
    const factory = new TemporalClientFactory({ credentials, connector: new CapturingConnector(true), tenantId: 'tenant-p5' });
    let captured: unknown;
    try { await factory.forSnapshot(snapshot); } catch (cause) { captured = cause; }
    expect(captured).toBeInstanceOf(TargetClusterUnavailableError);
    const error = captured as TargetClusterUnavailableError & { cause?: unknown };
    expect(error.cause).toBeUndefined();
    const logCapture = JSON.stringify({ name: error.name, message: error.message, code: error.code, cause: error.cause });
    expect(logCapture).not.toContain(credentials.secretText);
    expect(String(error)).not.toContain(credentials.secretText);
    expect(credentials.retainedLease).toEqual(new Uint8Array(credentials.secretText.length));
  });

  it('keys cached clients by all client-relevant snapshot fields so credential rotation creates a new client', async () => {
    const original = (await new TrustedTemporalRouter({ registry: published() }).route(input)).snapshot;
    const rotated: WorkflowTargetSnapshot = {
      ...original, snapshotId: 'snapshot-rotated', targetProfileVersion: 'sage-dev-us-v2',
      credentialRef: 'secret://temporal/sage-dev-us-rotated'
    };
    const credentials = new CapturingCredentialProvider();
    const connector = new CapturingConnector();
    const factory = new TemporalClientFactory({ credentials, connector, tenantId: 'tenant-p5' });
    await factory.forSnapshot(original);
    await factory.forSnapshot(original);
    await factory.forSnapshot(rotated);
    expect(connector.snapshots.map(({ targetProfileVersion, credentialRef }) => [targetProfileVersion, credentialRef])).toEqual([
      ['sage-dev-us-v1', 'secret://temporal/sage-dev-us'],
      ['sage-dev-us-v2', 'secret://temporal/sage-dev-us-rotated']
    ]);
  });
});

describe('verified Release routing requirements', () => {
  it('applies verified Release runtime and compatibility requirements without trusting physical target fields', async () => {
    const router = new TrustedTemporalRouter({ registry: published() });
    const requirements = {
      releaseRuntimeRequirements: {
        requirementsDigest: `sha256:${'a'.repeat(64)}` as `sha256:${string}`,
        allowedTargetIds: ['sage-dev-us'], targetProfileVersions: ['sage-dev-us-v1'],
        adapterRefs: ['adapter://legacy-temporal'], runtimeCompatibilityRefs: ['runtime-compatibility://agent-task-profile-v1']
      },
      compatibilityTaskTypeRequirements: { taskType: TASK_TYPE, taskTypeVersion: 'agent-task-profile-v1', requiredResidencies: ['us'] }
    };
    const routed = await router.route(input, requirements);
    expect(routed.snapshot.targetId).toBe('sage-dev-us');
    await expect(router.route({ ...input, runtimeRequirements: 'client-controlled' } as unknown as Record<string, unknown>)).rejects.toMatchObject({ code: 'TARGET_OVERRIDE_REJECTED' });
    await expect(router.route(input, { ...requirements, releaseRuntimeRequirements: { ...requirements.releaseRuntimeRequirements, endpoint: 'evil:7233' } as never })).rejects.toMatchObject({ code: 'TARGET_OVERRIDE_REJECTED' });
    await expect(router.route(input, { ...requirements, compatibilityTaskTypeRequirements: { ...requirements.compatibilityTaskTypeRequirements, namespace: 'evil' } as never })).rejects.toMatchObject({ code: 'TARGET_OVERRIDE_REJECTED' });
  });

  it('returns exact target/runtime identity, requirements digest, registry revision and bounded rationale', async () => {
    const requirementsDigest = `sha256:${'c'.repeat(64)}` as `sha256:${string}`;
    const routed = await new TrustedTemporalRouter({ registry: published() }).route(input, {
      releaseRuntimeRequirements: { requirementsDigest, allowedTargetIds: ['sage-dev-us'] }
    });
    expect(routed.snapshot).toMatchObject({
      targetId: 'sage-dev-us', targetProfileVersion: 'sage-dev-us-v1',
      runtimeBuildRef: 'runtime://sage-dev-us/sage-dev-us-runtime-v1', requirementsDigest,
      registryVersion: 'registry-dev-v1'
    });
    expect(routed.decision).toMatchObject({ requirementsDigest, registryVersion: 'registry-dev-v1', policyVersion: 'policy-dev-v1' });
    expect(routed.decision.candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ targetId: 'sage-dev-us', eligible: true }),
      expect.objectContaining({ targetId: 'sage-dev-eu', eligible: false, reasons: expect.arrayContaining(['release-target-not-allowed']) })
    ]));
    expect(routed.decision.explanation).toContain('priority=100');
  });

  it('returns bounded rejection rationale when no exact target/runtime is legal', async () => {
    const router = new TrustedTemporalRouter({ registry: published() });
    try {
      await router.route(input, { releaseRuntimeRequirements: {
        requirementsDigest: `sha256:${'d'.repeat(64)}` as `sha256:${string}`,
        targetProfileVersions: ['runtime-profile-that-does-not-exist']
      } });
      throw new Error('expected routing failure');
    } catch (error) {
      expect(error).toBeInstanceOf(RoutingUnavailableError);
      const decision = (error as RoutingUnavailableError).decision;
      expect(decision.rejectionCode).toBe('ROUTING_UNAVAILABLE');
      expect(decision.candidates.every((candidate) => candidate.reasons.includes('release-target-profile-incompatible'))).toBe(true);
      expect(decision.explanation.length).toBeLessThanOrEqual(2_048);
    }
  });

});
