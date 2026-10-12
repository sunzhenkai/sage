import { describe, expect, it } from 'vitest';
import { agentStateDigest } from '@sage/platform-ports';
import type { AgentTaskSpecStorePort, ArtifactAdapter, CredentialProvider, IdempotencyStore, RegistryAdapter, SecretManagerAdapter } from '@sage/platform-ports';
import type { InMemoryAgentEventStore } from './index.js';
import {
  FailureInjectableArtifactAdapter,
  InMemoryArtifactAdapter,
  InMemoryCredentialProvider,
  InMemoryIdempotencyStore,
  InMemoryAgentTaskSpecStore,
  InMemoryRegistryAdapter,
  InMemorySecretManagerAdapter
} from './index.js';

export function artifactAdapterContract(name: string, create: () => ArtifactAdapter): void {
  describe(`${name} ArtifactAdapter contract`, () => {
    it('round-trips bytes, isolates tenants, and deletes explicitly', async () => {
      const adapter = create();
      const source = new TextEncoder().encode('contract-data');
      const metadata = await adapter.put({ tenantId: 'tenant-a', mediaType: 'text/plain', bytes: source });
      expect(metadata.artifactRef).toMatch(/^artifact:/);
      expect(metadata.size).toBe(source.byteLength);
      await expect(adapter.get(metadata.artifactRef, 'tenant-b')).rejects.toThrow('ARTIFACT_NOT_FOUND');
      expect(await adapter.get(metadata.artifactRef, 'tenant-a')).toEqual(source);
      await adapter.delete(metadata.artifactRef, 'tenant-a');
      await expect(adapter.get(metadata.artifactRef, 'tenant-a')).rejects.toThrow('ARTIFACT_NOT_FOUND');
    });
  });
}

artifactAdapterContract('in-memory', () => new InMemoryArtifactAdapter());
artifactAdapterContract('failure-injectable', () => new FailureInjectableArtifactAdapter());

export function credentialProviderContract(name: string, create: () => CredentialProvider & InMemoryCredentialProvider): void {
  describe(`${name} CredentialProvider contract`, () => {
    it('binds copies to secret/connection/tenant/environment/purpose/scope and fails closed on every mismatch', async () => {
      const provider = create();
      provider.set('secret://crm/key', 'credential-value', {
        scope: 'contacts:read', connectionRef: 'connection://crm', tenantId: 'tenant-a', environment: 'local', purpose: 'tool://crm-read/v1'
      });
      const request = {
        secretRef: 'secret://crm/key' as const,
        connectionRef: 'connection://crm' as const,
        tenantId: 'tenant-a', environment: 'local' as const, purpose: 'tool://crm-read/v1', scope: 'contacts:read'
      };
      const lease = await provider.resolveCredential(request);
      expect(lease.scope).toBe('contacts:read');
      lease.value.fill(0);
      expect(new TextDecoder().decode((await provider.resolveCredential(request)).value)).toBe('credential-value');
      provider.set('secret://crm/key', 'rotated-credential-value', {
        scope: 'contacts:read', connectionRef: 'connection://crm', tenantId: 'tenant-a', environment: 'local', purpose: 'tool://crm-read/v1'
      });
      expect(new TextDecoder().decode(lease.value)).toBe('\0'.repeat('credential-value'.length));
      expect(new TextDecoder().decode((await provider.resolveCredential(request)).value)).toBe('rotated-credential-value');

      for (const mismatch of [
        { ...request, secretRef: 'secret://crm/other' as const },
        { ...request, connectionRef: 'connection://wrong' as const },
        { ...request, tenantId: 'tenant-b' },
        { ...request, environment: 'production' as const },
        { ...request, purpose: 'tool://other/v1' },
        { ...request, scope: 'contacts:write' }
      ]) await expect(provider.resolveCredential(mismatch)).rejects.toThrow('CREDENTIAL_NOT_FOUND');

      expect(() => provider.set('secret://unbound', 'value', { scope: 'x' } as never)).toThrow('INVALID_CREDENTIAL_BINDING');
      provider.failNext('resolve');
      await expect(provider.resolveCredential(request)).rejects.toThrow('INJECTED_RESOLVE_FAILURE');
      expect((await provider.resolveCredential(request)).expiresAt).toBeTruthy();
    });
  });
}

credentialProviderContract('in-memory', () => new InMemoryCredentialProvider());

export function idempotencyStoreContract(name: string, create: () => IdempotencyStore): void {
  describe(`${name} IdempotencyStore contract`, () => {
    it('atomically claims, completes, shares results, and releases pre-commit claims', async () => {
      const store = create();
      const lease = new Date(Date.now() + 60_000).toISOString();
      const claims = await Promise.all([
        store.claim('key-a', 'owner-a', lease),
        store.claim('key-a', 'owner-b', lease)
      ]);
      expect(claims.filter((claim) => claim.status === 'claimed')).toHaveLength(1);
      expect(claims.filter((claim) => claim.status === 'in_progress')).toHaveLength(1);
      const owner = claims[0]?.status === 'claimed' ? 'owner-a' : 'owner-b';
      await store.complete('key-a', owner, { status: 'succeeded', output: { id: 1 } });
      expect(await store.get('key-a')).toEqual({ status: 'completed', result: { status: 'succeeded', output: { id: 1 } } });
      expect(await store.claim('key-a', 'owner-c', lease)).toMatchObject({ status: 'completed' });

      expect(await store.claim('key-precommit', 'owner-a', lease)).toEqual({ status: 'claimed' });
      await store.release('key-precommit', 'owner-a');
      expect(await store.claim('key-precommit', 'owner-b', lease)).toEqual({ status: 'claimed' });
    });

    it('rejects sensitive and malformed-reference completion payloads without storing them', async () => {
      const store = create();
      const lease = new Date(Date.now() + 60_000).toISOString();
      await store.claim('key-sensitive', 'owner', lease);
      await expect(store.complete('key-sensitive', 'owner', { password: 'not-persisted' })).rejects.toThrow('SENSITIVE_DATA_LEAK_DETECTED');
      expect(await store.get('key-sensitive')).toEqual({ status: 'in_progress' });

      await store.claim('key-malformed-ref', 'owner', lease);
      await expect(store.complete('key-malformed-ref', 'owner', {
        status: 'succeeded', output: { nested: { secret_ref: 'plain-text-credential' } }
      })).rejects.toThrow('INVALID_REFERENCE_VALUE');
      expect(await store.get('key-malformed-ref')).toEqual({ status: 'in_progress' });
    });
  });
}

idempotencyStoreContract('in-memory', () => new InMemoryIdempotencyStore());

describe('local control-plane fakes', () => {
  it('resolves versioned registry records', async () => {
    const registry: RegistryAdapter & InMemoryRegistryAdapter = new InMemoryRegistryAdapter();
    registry.publish({ kind: 'target', id: 'dev', version: '1', enabled: true, value: { queue: 'q1' }, publishedAt: new Date().toISOString() });
    expect((await registry.get<{ queue: string }>('target', 'dev'))?.value.queue).toBe('q1');
  });

  it('returns copies of secret values without exposing storage', async () => {
    const secrets: SecretManagerAdapter & InMemorySecretManagerAdapter = new InMemorySecretManagerAdapter();
    secrets.set('secret://test', 'value');
    const context = { tenantId: 'tenant-a', environment: 'local' as const, purpose: 'contract' };
    const first = await secrets.resolve('secret://test', context);
    first.value.fill(0);
    expect(new TextDecoder().decode((await secrets.resolve('secret://test', context)).value)).toBe('value');
  });

  it('fails exactly the selected Artifact operation and then recovers', async () => {
    const adapter = new FailureInjectableArtifactAdapter();
    adapter.failNext('put');
    await expect(adapter.put({ tenantId: 'tenant-a', mediaType: 'text/plain', bytes: new Uint8Array([1]) })).rejects.toThrow('INJECTED_PUT_FAILURE');
    expect((await adapter.put({ tenantId: 'tenant-a', mediaType: 'text/plain', bytes: new Uint8Array([1]) })).artifactRef).toMatch(/^artifact:/);
  });
});


describe('InMemoryAgentTaskSpecStore', () => {
  const digest = (suffix: string) => `sha256:${suffix.charCodeAt(0).toString(16).repeat(64).slice(0, 64)}`;
  const specFor = (overrides: Partial<Parameters<AgentTaskSpecStorePort['putSpec']>[0]['spec']> = {}): Parameters<AgentTaskSpecStorePort['putSpec']>[0]['spec'] => ({
    schemaVersion: '1', specRef: 'spec://tenant/one', specDigest: digest('a'), taskId: 'task', runId: 'run', attemptId: 'attempt',
    releaseRef: 'release://tenant/one', releaseDigest: digest('b'), principalRef: 'principal://tenant/user', tenantId: 'tenant',
    goalRef: 'artifact://tenant/goal', engineId: 'reference', skillRefs: [], modelRouteRef: 'model-route://fixed',
    contextPlanRef: 'context-plan://fixed', capabilityGrantRef: 'grant://fixed', executionPolicyRef: 'policy://fixed',
    boundsRef: 'bounds://fixed', governanceRef: 'governance://fixed', admittedAt: '2026-08-15T00:00:00.000Z', ...overrides
  });

  it('stores create-only Specs, replays exact writes, and rejects ref or Attempt rebinding', async () => {
    const store = new InMemoryAgentTaskSpecStore();
    const spec = specFor();
    expect(await store.putSpec({ tenantId: 'tenant', spec })).toMatchObject({ status: 'stored' });
    expect(await store.putSpec({ tenantId: 'tenant', spec: structuredClone(spec) })).toMatchObject({ status: 'existing' });
    await expect(store.getSpec({ tenantId: 'tenant', specRef: spec.specRef, expectedDigest: spec.specDigest })).resolves.toEqual(spec);
    expect(await store.putSpec({ tenantId: 'tenant', spec: specFor({ specDigest: digest('c') }) })).toEqual({ status: 'conflict', code: 'SPEC_REF_CONFLICT' });
    expect(await store.putSpec({ tenantId: 'tenant', spec: specFor({ specRef: 'spec://tenant/two', specDigest: digest('d') }) })).toEqual({ status: 'conflict', code: 'ATTEMPT_SPEC_CONFLICT' });
  });

  it('isolates tenants, fails closed on digest or tenant mismatch, and injects unavailability', async () => {
    const store = new InMemoryAgentTaskSpecStore();
    const spec = specFor();
    await store.putSpec({ tenantId: 'tenant', spec });
    await expect(store.getSpec({ tenantId: 'other', specRef: spec.specRef, expectedDigest: spec.specDigest })).resolves.toBeUndefined();
    await expect(store.getSpec({ tenantId: 'tenant', specRef: spec.specRef, expectedDigest: digest('e') })).resolves.toBeUndefined();
    await expect(store.putSpec({ tenantId: 'other', spec })).rejects.toThrow('SPEC_TENANT_MISMATCH');
    store.failNext('putSpec');
    await expect(store.putSpec({ tenantId: 'tenant', spec })).rejects.toThrow('INJECTED_PUTSPEC_FAILURE');
  });
});


describe('InMemoryAgentEventStore', () => {
  const digest = (suffix: string) => `sha256:${suffix.charCodeAt(0).toString(16).repeat(64).slice(0, 64)}`;
  const writer = { tenantId: 'tenant', taskId: 'task', runId: 'run', attemptId: 'attempt', ownerToken: 'writer-a' };
  const eventFor = (sequence: number, overrides: Record<string, unknown> = {}) => ({
    schemaVersion: '2' as const, eventId: `event-${sequence}`, taskId: 'task', runId: 'run', attemptId: 'attempt', invocationId: 'invoke',
    specDigest: digest('a'), sequence, type: 'run.started' as const, payload: { source: 'test' }, receiptRefs: [], artifactRefs: [], ...overrides
  });
  const acquire = async (store: InMemoryAgentEventStore, input = writer) => {
    const result = await store.acquireWriterFence(input);
    if (result.status !== 'acquired') throw new Error('expected writer fence');
    return result.fence;
  };

  it('allows exactly one active writer and reuses its active epoch', async () => {
    const { InMemoryAgentEventStore } = await import('./index.js');
    const store = new InMemoryAgentEventStore();
    const fence = await acquire(store);
    expect((await store.acquireWriterFence(writer))).toEqual({ status: 'acquired', fence });
    expect(await store.acquireWriterFence({ ...writer, ownerToken: 'writer-b' })).toEqual({ status: 'held', code: 'EVENT_WRITER_FENCED' });
  });

  it('requires a current matching fence, strict sequence, and exact replay content', async () => {
    const { InMemoryAgentEventStore } = await import('./index.js');
    const store = new InMemoryAgentEventStore();
    const fence = await acquire(store);
    const first = eventFor(1);
    expect(await store.appendEvent({ fence, event: first })).toMatchObject({ status: 'appended', event: first });
    expect(await store.appendEvent({ fence, event: structuredClone(first) })).toMatchObject({ status: 'existing', event: first });
    expect(await store.appendEvent({ fence, event: eventFor(3) })).toEqual({ status: 'conflict', code: 'EVENT_SEQUENCE_CONFLICT' });
    expect(await store.appendEvent({ fence, event: eventFor(1, { payload: { source: 'changed' } }) })).toEqual({ status: 'conflict', code: 'EVENT_ID_CONFLICT' });
    expect(await store.appendEvent({ fence: { ...fence, epoch: fence.epoch - 1 }, event: eventFor(2) })).toEqual({ status: 'conflict', code: 'EVENT_FENCE_LOST' });
    expect(await store.appendEvent({ fence, event: eventFor(2) })).toMatchObject({ status: 'appended' });
    expect(await store.listEvents({ ...writer, fromSequence: 2 })).toEqual([eventFor(2)]);
  });

  it('injects only the selected Event-store operation then recovers', async () => {
    const { InMemoryAgentEventStore } = await import('./index.js');
    const store = new InMemoryAgentEventStore();
    store.failNext('acquireWriterFence');
    await expect(store.acquireWriterFence(writer)).rejects.toThrow('INJECTED_ACQUIREWRITERFENCE_FAILURE');
    await expect(acquire(store)).resolves.toMatchObject({ ownerToken: 'writer-a' });
  });
  it('rejects temporary, missing, cross-tenant, and unsealed reference-shaped outputs', async () => {
    const { InMemoryAgentEventStore } = await import('./index.js');
    const store = new InMemoryAgentEventStore();
    const fence = await acquire(store);
    const withRefs = eventFor(1, { artifactRefs: ['artifact://large-output'], receiptRefs: ['receipt://committed'] });
    await expect(store.appendEvent({ fence, event: eventFor(1, { artifactRefs: ['artifact-temp://pending'] }) })).rejects.toThrow('EVENT_SCHEMA_INVALID');
    await expect(store.appendEvent({ fence, event: withRefs })).rejects.toThrow('EVENT_ARTIFACT_REF_UNAVAILABLE');
    store.registerFinalizedArtifactRef('tenant', 'artifact://large-output');
    await expect(store.appendEvent({ fence, event: withRefs })).rejects.toThrow('EVENT_RECEIPT_REF_UNAVAILABLE');
    store.registerCommittedReceiptRef('other-tenant', 'receipt://committed');
    await expect(store.appendEvent({ fence, event: withRefs })).rejects.toThrow('EVENT_RECEIPT_REF_UNAVAILABLE');
    store.registerCommittedReceiptRef('tenant', 'receipt://committed');
    expect(await store.appendEvent({ fence, event: withRefs })).toMatchObject({ status: 'appended' });
  });
});

describe('InMemoryBoundedRunReceiptStore', () => {
  const digest = (suffix: string) => `sha256:${suffix.charCodeAt(0).toString(16).repeat(64).slice(0, 64)}`;
  const receiptFor = (overrides: Record<string, unknown> = {}) => ({
    schemaVersion: '1' as const, receiptRef: 'receipt://one', invocationId: 'invoke', specDigest: digest('a'), outcome: 'COMPLETED' as const,
    eventRange: { first: 1, last: 2 }, receiptRefs: [], artifactRefs: [], ...overrides
  });

  it('replays the original receipt only for the same tenant, invocation, and digest', async () => {
    const { InMemoryBoundedRunReceiptStore } = await import('./index.js');
    const store = new InMemoryBoundedRunReceiptStore();
    const receipt = receiptFor();
    expect(await store.putReceipt({ tenantId: 'tenant', receipt, receiptDigest: digest('b') })).toMatchObject({ status: 'stored', value: receipt });
    expect(await store.putReceipt({ tenantId: 'tenant', receipt: structuredClone(receipt), receiptDigest: digest('b') })).toMatchObject({ status: 'existing', value: receipt });
    expect(await store.getReceipt({ tenantId: 'tenant', invocationId: 'invoke' })).toEqual(receipt);
    expect(await store.getReceipt({ tenantId: 'other', invocationId: 'invoke' })).toBeUndefined();
    expect(await store.putReceipt({ tenantId: 'tenant', receipt: receiptFor({ receiptRef: 'receipt://other' }), receiptDigest: digest('c') })).toEqual({ status: 'conflict', code: 'RECEIPT_CONFLICT' });
  });

  it('injects selected Receipt-store failures without persisting a partial write', async () => {
    const { InMemoryBoundedRunReceiptStore } = await import('./index.js');
    const store = new InMemoryBoundedRunReceiptStore();
    const receipt = receiptFor();
    store.failNext('putReceipt');
    await expect(store.putReceipt({ tenantId: 'tenant', receipt, receiptDigest: digest('b') })).rejects.toThrow('INJECTED_PUTRECEIPT_FAILURE');
    expect(await store.getReceipt({ tenantId: 'tenant', invocationId: 'invoke' })).toBeUndefined();
    expect(await store.putReceipt({ tenantId: 'tenant', receipt, receiptDigest: digest('b') })).toMatchObject({ status: 'stored' });
  });

  it('rejects missing or cross-tenant large-output references before persisting a receipt', async () => {
    const { InMemoryBoundedRunReceiptStore } = await import('./index.js');
    const store = new InMemoryBoundedRunReceiptStore();
    const receipt = receiptFor({ artifactRefs: ['artifact://large-output'] });
    await expect(store.putReceipt({ tenantId: 'tenant', receipt, receiptDigest: digest('b') })).rejects.toThrow('RECEIPT_ARTIFACT_REF_UNAVAILABLE');
    store.registerFinalizedArtifactRef('other-tenant', 'artifact://large-output');
    await expect(store.putReceipt({ tenantId: 'tenant', receipt, receiptDigest: digest('b') })).rejects.toThrow('RECEIPT_ARTIFACT_REF_UNAVAILABLE');
    store.registerFinalizedArtifactRef('tenant', 'artifact://large-output');
    expect(await store.putReceipt({ tenantId: 'tenant', receipt, receiptDigest: digest('b') })).toMatchObject({ status: 'stored' });
    const chained = receiptFor({ invocationId: 'invoke-2', receiptRef: 'receipt://two', receiptRefs: ['receipt://one'] });
    expect(await store.putReceipt({ tenantId: 'tenant', receipt: chained, receiptDigest: digest('c') })).toMatchObject({ status: 'stored' });
    await expect(store.putReceipt({ tenantId: 'other-tenant', receipt: receiptFor({ invocationId: 'invoke-3', artifactRefs: ['artifact://other-output'] }), receiptDigest: digest('d') })).rejects.toThrow('RECEIPT_ARTIFACT_REF_UNAVAILABLE');
  });
});


describe('InMemoryCheckpointStore', () => {
  const digest = (suffix: string) => `sha256:${suffix.charCodeAt(0).toString(16).repeat(64).slice(0, 64)}`;
  const fence = { tenantId: 'tenant', taskId: 'task', runId: 'run', attemptId: 'attempt', ownerToken: 'writer-a', epoch: 1 };
  const candidateFor = (sequence: number, overrides: Record<string, unknown> = {}) => ({
    schemaVersion: '1' as const, candidateDigest: digest(String.fromCharCode(96 + sequence)), taskId: 'task', runId: 'run', attemptId: 'attempt',
    specDigest: digest('s'), sequence, state: { schemaVersion: '1' as const, observationRefs: [], receiptRefs: ['receipt://effect-usage'] },
    engineCodec: 'reference@1', runtimeContractMajor: 1, receiptRefs: ['receipt://effect-usage'], ...overrides
  });
  const resumeInput = (checkpointRef: string, overrides: Record<string, unknown> = {}) => ({
    tenantId: 'tenant', checkpointRef, taskId: 'task', runId: 'run', attemptId: 'attempt', specDigest: digest('s'), engineCodec: 'reference@1', runtimeContractMajor: 1, ...overrides
  });

  it('keeps a staged candidate non-resumable and only exposes it after an idempotent seal', async () => {
    const { InMemoryCheckpointStore } = await import('./index.js');
    const store = new InMemoryCheckpointStore();
    const candidate = candidateFor(1);
    store.registerReceiptLineage('tenant', 'receipt://effect-usage');
    expect(await store.stageCandidate({ tenantId: 'tenant', fence, candidate })).toMatchObject({ status: 'staged', candidate });
    expect(await store.getSealedCheckpoint(resumeInput('checkpoint://sealed/absent'))).toBeUndefined();
    const sealed = await store.sealCandidate({ tenantId: 'tenant', fence, candidateDigest: candidate.candidateDigest });
    expect(sealed.status).toBe('sealed');
    if (sealed.status === 'conflict') throw new Error('expected seal');
    expect(await store.sealCandidate({ tenantId: 'tenant', fence, candidateDigest: candidate.candidateDigest })).toEqual({ status: 'existing', checkpoint: sealed.checkpoint });
    expect(await store.getSealedCheckpoint(resumeInput(sealed.checkpoint.checkpointRef))).toEqual(sealed.checkpoint);
  });

  it('fails closed for tenant/identity/lineage/sequence violations and stale fences', async () => {
    const { InMemoryCheckpointStore } = await import('./index.js');
    const store = new InMemoryCheckpointStore();
    const first = candidateFor(1);
    store.registerReceiptLineage('tenant', 'receipt://effect-usage');
    expect(await store.stageCandidate({ tenantId: 'other', fence, candidate: first })).toEqual({ status: 'conflict', code: 'CHECKPOINT_FENCE_LOST' });
    expect(await store.stageCandidate({ tenantId: 'tenant', fence, candidate: candidateFor(1, { taskId: 'other-task' }) })).toEqual({ status: 'conflict', code: 'CHECKPOINT_FENCE_LOST' });
    expect(await store.stageCandidate({ tenantId: 'tenant', fence, candidate: candidateFor(1, { receiptRefs: ['receipt://uncommitted'] }) })).toEqual({ status: 'conflict', code: 'CHECKPOINT_CANDIDATE_CONFLICT' });
    expect(await store.stageCandidate({ tenantId: 'tenant', fence, candidate: first })).toMatchObject({ status: 'staged' });
    expect(await store.stageCandidate({ tenantId: 'tenant', fence, candidate: candidateFor(1, { candidateDigest: digest('z') }) })).toEqual({ status: 'conflict', code: 'CHECKPOINT_CANDIDATE_CONFLICT' });
    const newerFence = { ...fence, ownerToken: 'writer-b', epoch: 2 };
    const second = candidateFor(2);
    expect(await store.stageCandidate({ tenantId: 'tenant', fence: newerFence, candidate: second })).toMatchObject({ status: 'staged' });
    expect(await store.sealCandidate({ tenantId: 'tenant', fence, candidateDigest: first.candidateDigest })).toEqual({ status: 'conflict', code: 'CHECKPOINT_FENCE_LOST' });
  });

  it('requires exact canonical compatibility on sealed resume', async () => {
    const { InMemoryCheckpointStore } = await import('./index.js');
    const store = new InMemoryCheckpointStore();
    const candidate = candidateFor(1);
    store.registerReceiptLineage('tenant', 'receipt://effect-usage');
    await store.stageCandidate({ tenantId: 'tenant', fence, candidate });
    const result = await store.sealCandidate({ tenantId: 'tenant', fence, candidateDigest: candidate.candidateDigest });
    if (result.status === 'conflict') throw new Error('expected seal');
    await expect(store.getSealedCheckpoint(resumeInput(result.checkpoint.checkpointRef, { tenantId: 'other' }))).resolves.toBeUndefined();
    await expect(store.getSealedCheckpoint(resumeInput(result.checkpoint.checkpointRef, { specDigest: digest('x') }))).resolves.toBeUndefined();
    await expect(store.getSealedCheckpoint(resumeInput(result.checkpoint.checkpointRef, { engineCodec: 'other@1' }))).resolves.toBeUndefined();
    await expect(store.getSealedCheckpoint(resumeInput(result.checkpoint.checkpointRef, { runtimeContractMajor: 2 }))).resolves.toBeUndefined();
    await expect(store.getSealedCheckpoint(resumeInput(result.checkpoint.checkpointRef, { sequence: 2 }))).resolves.toBeUndefined();
    await expect(store.getSealedCheckpoint(resumeInput(result.checkpoint.checkpointRef, { sequence: 1 }))).resolves.toEqual(result.checkpoint);
  });

  it('requires finalized output references and verifies optional candidate body digest before staging', async () => {
    const { InMemoryCheckpointStore } = await import('./index.js');
    const store = new InMemoryCheckpointStore();
    store.registerReceiptLineage('tenant', 'receipt://effect-usage');
    const outputState = { schemaVersion: '1' as const, observationRefs: [], receiptRefs: ['receipt://effect-usage'], outputDraftRef: 'artifact://large-output' };
    const missingArtifact = candidateFor(1, { state: outputState, bodyDigest: agentStateDigest(outputState) });
    expect(await store.stageCandidate({ tenantId: 'tenant', fence, candidate: missingArtifact })).toEqual({ status: 'conflict', code: 'CHECKPOINT_CANDIDATE_CONFLICT' });
    const wrongState = { schemaVersion: '1' as const, observationRefs: [], receiptRefs: ['receipt://effect-usage'] };
    const wrongDigest = candidateFor(1, { state: wrongState, bodyDigest: digest('z') });
    expect(await store.stageCandidate({ tenantId: 'tenant', fence, candidate: wrongDigest })).toEqual({ status: 'conflict', code: 'CHECKPOINT_CANDIDATE_CONFLICT' });
    store.registerFinalizedArtifactRef('tenant', 'artifact://large-output');
    expect(await store.stageCandidate({ tenantId: 'tenant', fence, candidate: missingArtifact })).toMatchObject({ status: 'staged' });
  });
});


describe('InMemoryCheckpointStore failure matrix', () => {
  const digest = (suffix: string) => `sha256:${suffix.charCodeAt(0).toString(16).repeat(64).slice(0, 64)}`;
  const fence = { tenantId: 'tenant', taskId: 'task', runId: 'run', attemptId: 'attempt', ownerToken: 'writer', epoch: 1 };
  const candidate = (candidateDigest = digest('a')) => ({ schemaVersion: '1' as const, candidateDigest, taskId: 'task', runId: 'run', attemptId: 'attempt', specDigest: digest('s'), sequence: 1, state: { schemaVersion: '1' as const, observationRefs: [], receiptRefs: ['receipt://committed'] }, engineCodec: 'reference@1', runtimeContractMajor: 1, receiptRefs: ['receipt://committed'] });
  const resume = (checkpointRef: string) => ({ tenantId: 'tenant', checkpointRef, taskId: 'task', runId: 'run', attemptId: 'attempt', specDigest: digest('s'), engineCodec: 'reference@1', runtimeContractMajor: 1 });

  it.each(['stageBody', 'stageMetadata', 'stageCandidate'] as const)('keeps checkpoint partial writes invisible when %s fails', async (operation) => {
    const { InMemoryCheckpointStore } = await import('./index.js');
    const store = new InMemoryCheckpointStore(); const staged = candidate();
    store.registerReceiptLineage('tenant', 'receipt://committed');
    store.failNext(operation);
    await expect(store.stageCandidate({ tenantId: 'tenant', fence, candidate: staged })).rejects.toThrow(`INJECTED_${operation.toUpperCase()}_FAILURE`);
    await expect(store.getSealedCheckpoint(resume(`checkpoint://sealed/${staged.candidateDigest.slice('sha256:'.length)}`))).resolves.toBeUndefined();
    expect(await store.sealCandidate({ tenantId: 'tenant', fence, candidateDigest: staged.candidateDigest })).toEqual({ status: 'conflict', code: 'CHECKPOINT_SEAL_CONFLICT' });
  });

  it('recovers a lost seal response by replaying the same digest and rejects a conflicting identity', async () => {
    const { InMemoryCheckpointStore } = await import('./index.js');
    const store = new InMemoryCheckpointStore(); const staged = candidate();
    store.registerReceiptLineage('tenant', 'receipt://committed');
    await store.stageCandidate({ tenantId: 'tenant', fence, candidate: staged });
    await store.sealCandidate({ tenantId: 'tenant', fence, candidateDigest: staged.candidateDigest }); // caller loses this successful response
    const retry = await store.sealCandidate({ tenantId: 'tenant', fence, candidateDigest: staged.candidateDigest });
    expect(retry.status).toBe('existing');
    expect(await store.stageCandidate({ tenantId: 'tenant', fence, candidate: candidate(digest('b')) })).toEqual({ status: 'conflict', code: 'CHECKPOINT_CANDIDATE_CONFLICT' });
  });

  it('cancels before checkpoint seal without publishing a ref, then safely retries', async () => {
    const { InMemoryCheckpointStore } = await import('./index.js');
    const store = new InMemoryCheckpointStore();
    const staged = candidate();
    store.registerReceiptLineage('tenant', 'receipt://committed');
    await store.stageCandidate({ tenantId: 'tenant', fence, candidate: staged });
    store.cancelNext('sealCandidate');
    await expect(store.sealCandidate({ tenantId: 'tenant', fence, candidateDigest: staged.candidateDigest })).rejects.toThrow('CANCELLED');
    await expect(store.getSealedCheckpoint(resume(`checkpoint://sealed/${staged.candidateDigest.slice('sha256:'.length)}`))).resolves.toBeUndefined();
    const sealed = await store.sealCandidate({ tenantId: 'tenant', fence, candidateDigest: staged.candidateDigest });
    expect(sealed.status).toBe('sealed');
  });

  it('fails seal before publishing a ref and preserves resume compatibility requirements', async () => {
    const { InMemoryCheckpointStore } = await import('./index.js');
    const store = new InMemoryCheckpointStore(); const staged = candidate();
    store.registerReceiptLineage('tenant', 'receipt://committed');
    await store.stageCandidate({ tenantId: 'tenant', fence, candidate: staged });
    store.failNext('sealCandidate');
    await expect(store.sealCandidate({ tenantId: 'tenant', fence, candidateDigest: staged.candidateDigest })).rejects.toThrow('INJECTED_SEALCANDIDATE_FAILURE');
    await expect(store.getSealedCheckpoint(resume(`checkpoint://sealed/${staged.candidateDigest.slice('sha256:'.length)}`))).resolves.toBeUndefined();
    const sealed = await store.sealCandidate({ tenantId: 'tenant', fence, candidateDigest: staged.candidateDigest });
    if (sealed.status === 'conflict') throw new Error('expected seal');
    await expect(store.getSealedCheckpoint({ ...resume(sealed.checkpoint.checkpointRef), engineCodec: 'incompatible@1' })).resolves.toBeUndefined();
  });
});
