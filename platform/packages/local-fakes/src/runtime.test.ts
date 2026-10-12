import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

const sha256Digest = (value: unknown): string => `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
const sha256Bytes = (value: string): string => `sha256:${createHash('sha256').update(value).digest('hex')}`;
import { DeterministicCapabilityBroker, DeterministicContextResolver, DeterministicModelBroker, InMemoryArtifactFinalizeStore, InMemoryConsumptionLedger } from './index.js';
import type { RuntimeIdentity, UsageReceipt } from '@sage/platform-ports';

const identity: RuntimeIdentity = { principalRef: 'principal://one', tenantId: 'tenant-1', taskId: 'task-1', runId: 'run-1', attemptId: 'attempt-1', invocationId: 'invocation-1', specDigest: sha256Digest('spec') };
const receipt = (digest: string): UsageReceipt => ({ receiptRef: 'usage-receipt://invocation-1', receiptDigest: digest, invocationId: identity.invocationId, reservationRef: 'usage-reservation://invocation-1', actual: { tokens: 1, cost: 1 }, cost: 1 });

describe('runtime kernel deterministic fakes', () => {
  it('reserves and commits usage at most once, returning conflict for a different digest', async () => {
    const ledger = new InMemoryConsumptionLedger();
    ledger.seed('account-1', identity.tenantId, { tokens: 3, cost: 3 });
    const first = await ledger.reserve({ identity, accountRef: 'account-1', upperBound: { tokens: 2, cost: 2 }, leaseMs: 10_000 });
    const duplicate = await ledger.reserve({ identity, accountRef: 'account-1', upperBound: { tokens: 2, cost: 2 }, leaseMs: 10_000 });
    expect(first.status).toBe('reserved');
    expect(duplicate.status).toBe('existing');
    const reservation = first.status === 'reserved' ? first.reservation : duplicate.status === 'existing' ? duplicate.reservation : undefined;
    const committed = await ledger.commit({ identity, receipt: receipt(sha256Digest('receipt-a')) });
    const replay = await ledger.commit({ identity, receipt: receipt(sha256Digest('receipt-a')) });
    const conflict = await ledger.commit({ identity, receipt: receipt(sha256Digest('receipt-b')) });
    expect(committed.status).toBe('committed');
    expect(replay.status).toBe('existing');
    expect(conflict).toEqual({ status: 'conflict', code: 'USAGE_CONFLICT' });
    expect(reservation?.invocationId).toBe(identity.invocationId);
  });

  it('rejects insufficient, cross-tenant, and conflicting duplicate reservations without changing authority balance', async () => {
    const ledger = new InMemoryConsumptionLedger();
    ledger.seed('account-1', identity.tenantId, { tokens: 3, cost: 3 });
    const insufficient = await ledger.reserve({ identity: { ...identity, invocationId: 'insufficient' }, accountRef: 'account-1', upperBound: { tokens: 4, cost: 1 }, leaseMs: 10_000 });
    expect(insufficient).toEqual({ status: 'rejected', code: 'LEDGER_INSUFFICIENT' });
    expect((await ledger.getBalance({ accountRef: 'account-1', tenantId: identity.tenantId })).remaining).toEqual({ tokens: 3, cost: 3 });

    const crossTenant = await ledger.reserve({ identity: { ...identity, tenantId: 'tenant-2', invocationId: 'cross-tenant' }, accountRef: 'account-1', upperBound: { tokens: 1 }, leaseMs: 10_000 });
    expect(crossTenant).toEqual({ status: 'rejected', code: 'LEDGER_TENANT_MISMATCH' });

    const first = await ledger.reserve({ identity: { ...identity, invocationId: 'conflict' }, accountRef: 'account-1', upperBound: { tokens: 1 }, leaseMs: 10_000 });
    expect(first.status).toBe('reserved');
    const differentBound = await ledger.reserve({ identity: { ...identity, invocationId: 'conflict' }, accountRef: 'account-1', upperBound: { tokens: 2 }, leaseMs: 10_000 });
    const differentAccount = await ledger.reserve({ identity: { ...identity, invocationId: 'conflict' }, accountRef: 'other-account', upperBound: { tokens: 1 }, leaseMs: 10_000 });
    expect(differentBound).toEqual({ status: 'rejected', code: 'LEDGER_RESERVATION_CONFLICT' });
    expect(differentAccount).toEqual({ status: 'rejected', code: 'LEDGER_RESERVATION_CONFLICT' });
    expect((await ledger.getBalance({ accountRef: 'account-1', tenantId: identity.tenantId })).remaining).toEqual({ tokens: 2, cost: 3 });
  });

  it('commits only bound, non-negative usage and releases unused reservation exactly once', async () => {
    const ledger = new InMemoryConsumptionLedger();
    ledger.seed('account-1', identity.tenantId, { tokens: 5, cost: 5 });
    const reserved = await ledger.reserve({ identity, accountRef: 'account-1', upperBound: { tokens: 3, cost: 3 }, leaseMs: 10_000 });
    expect(reserved.status).toBe('reserved');
    if (reserved.status !== 'reserved') return;

    const wrongInvocation = await ledger.commit({ identity: { ...identity, invocationId: 'other-invocation' }, receipt: receipt(sha256Digest('wrong-binding')) });
    expect(wrongInvocation).toEqual({ status: 'conflict', code: 'RESERVATION_FENCE_LOST' });
    const overConsumed = await ledger.commit({ identity, receipt: { ...receipt(sha256Digest('over-consumed')), actual: { tokens: 4, cost: 1 }, cost: 1 } });
    expect(overConsumed).toEqual({ status: 'conflict', code: 'USAGE_CONFLICT' });
    const negative = await ledger.commit({ identity, receipt: { ...receipt(sha256Digest('negative')), actual: { tokens: -1, cost: 0 }, cost: 0 } });
    expect(negative).toEqual({ status: 'conflict', code: 'USAGE_CONFLICT' });
    expect((await ledger.getBalance({ accountRef: 'account-1', tenantId: identity.tenantId })).remaining).toEqual({ tokens: 2, cost: 2 });

    const released = await ledger.release({ identity, reservation: reserved.reservation, reason: 'test-release' });
    const replayedRelease = await ledger.release({ identity, reservation: reserved.reservation, reason: 'test-release-replay' });
    expect(released.status).toBe('released');
    expect(replayedRelease).toEqual({ status: 'existing' });
    expect((await ledger.getBalance({ accountRef: 'account-1', tenantId: identity.tenantId })).remaining).toEqual({ tokens: 5, cost: 5 });
  });

  it('reconciles orphan leases and serializes commit/release races without double release or negative balance', async () => {
    const ledger = new InMemoryConsumptionLedger();
    ledger.seed('account-1', identity.tenantId, { tokens: 3, cost: 3 });
    const first = await ledger.reserve({ identity: { ...identity, invocationId: 'race-a' }, accountRef: 'account-1', upperBound: { tokens: 2, cost: 2 }, leaseMs: 10_000 });
    const second = await ledger.reserve({ identity: { ...identity, invocationId: 'race-b' }, accountRef: 'account-1', upperBound: { tokens: 2, cost: 2 }, leaseMs: 10_000 });
    expect([first.status, second.status].sort()).toEqual(['rejected', 'reserved']);
    expect((await ledger.getBalance({ accountRef: 'account-1', tenantId: identity.tenantId })).remaining).toEqual({ tokens: 1, cost: 1 });

    const expiryLedger = new InMemoryConsumptionLedger();
    expiryLedger.seed('account-expiry', identity.tenantId, { tokens: 2, cost: 2 });
    const expiring = await expiryLedger.reserve({ identity, accountRef: 'account-expiry', upperBound: { tokens: 1, cost: 1 }, leaseMs: 1 });
    expect(expiring.status).toBe('reserved');
    await new Promise((resolve) => setTimeout(resolve, 3));
    const reconciled = await expiryLedger.reconcile({ now: new Date().toISOString(), limit: 10 });
    expect(reconciled).toHaveLength(1);
    expect((await expiryLedger.getBalance({ accountRef: 'account-expiry', tenantId: identity.tenantId })).remaining).toEqual({ tokens: 2, cost: 2 });

    const raceLedger = new InMemoryConsumptionLedger();
    raceLedger.seed('account-race', identity.tenantId, { tokens: 5, cost: 5 });
    const reserved = await raceLedger.reserve({ identity, accountRef: 'account-race', upperBound: { tokens: 3, cost: 3 }, leaseMs: 10_000 });
    expect(reserved.status).toBe('reserved');
    if (reserved.status !== 'reserved') return;
    const [committed, released] = await Promise.all([
      raceLedger.commit({ identity, receipt: { ...receipt(sha256Digest('race-commit')), reservationRef: reserved.reservation.reservationRef, actual: { tokens: 1, cost: 1 }, cost: 1 } }),
      raceLedger.release({ identity, reservation: reserved.reservation, reason: 'race-release' })
    ]);
    expect(['committed', 'conflict'].includes(committed.status) || ['released', 'existing'].includes(released.status)).toBe(true);
    const finalBalance = await raceLedger.getBalance({ accountRef: 'account-race', tenantId: identity.tenantId });
    expect(finalBalance.remaining.tokens).toBeGreaterThanOrEqual(4);
    expect(finalBalance.remaining.cost).toBeGreaterThanOrEqual(4);
  });

  it('retries timeout and response-loss from Ledger authority without duplicating settlement', async () => {
    const ledger = new InMemoryConsumptionLedger();
    ledger.seed('account-faults', identity.tenantId, { tokens: 4, cost: 4 });
    ledger.timeoutNext('reserve');
    await expect(ledger.reserve({ identity, accountRef: 'account-faults', upperBound: { tokens: 2, cost: 2 }, leaseMs: 10_000 })).rejects.toThrow('TIMEOUT');
    const reserved = await ledger.reserve({ identity, accountRef: 'account-faults', upperBound: { tokens: 2, cost: 2 }, leaseMs: 10_000 });
    expect(reserved.status).toBe('reserved');
    ledger.loseResponseNext('commit');
    await expect(ledger.commit({ identity, receipt: { ...receipt(sha256Digest('response-loss')), reservationRef: 'usage-reservation://invocation-1', actual: { tokens: 1, cost: 1 }, cost: 1 } })).rejects.toThrow('RESPONSE_LOST');
    expect((await ledger.getBalance({ accountRef: 'account-faults', tenantId: identity.tenantId })).remaining).toEqual({ tokens: 2, cost: 2 });
    const committed = await ledger.commit({ identity, receipt: { ...receipt(sha256Digest('response-loss')), reservationRef: 'usage-reservation://invocation-1', actual: { tokens: 1, cost: 1 }, cost: 1 } });
    const replay = await ledger.commit({ identity, receipt: { ...receipt(sha256Digest('response-loss')), reservationRef: 'usage-reservation://invocation-1', actual: { tokens: 1, cost: 1 }, cost: 1 } });
    expect(committed.status).toBe('committed');
    expect(replay.status).toBe('existing');
    expect((await ledger.getBalance({ accountRef: 'account-faults', tenantId: identity.tenantId })).remaining).toEqual({ tokens: 3, cost: 3 });
  });

  it('records model/tool calls, finalizes artifacts before exposing refs, and supports named faults', async () => {
    const model = new DeterministicModelBroker();
    model.timeoutNext('invoke');
    await expect(model.invoke({ identity, modelRouteRef: 'model://fixed', input: { prompt: 'x' }, upperBound: { tokens: 1 }, timeoutMs: 1, signal: new AbortController().signal })).rejects.toThrow('TIMEOUT');
    const call = await model.invoke({ identity, modelRouteRef: 'model://fixed', input: { prompt: 'x' }, upperBound: { tokens: 1 }, timeoutMs: 1, signal: new AbortController().signal });
    expect(model.calls).toHaveLength(1);
    expect(call.usageReceipt.invocationId).toBe(identity.invocationId);

    const context = new DeterministicContextResolver([{ ref: 'artifact://source', revision: 'r1', content: { title: 'source' }, tenantId: identity.tenantId }]);
    const resolved = await context.resolve({ identity, contextPlanRef: 'context://plan', allowedSourceRefs: ['artifact://source'], maxBytes: 1024, maxTokens: 10, signal: new AbortController().signal });
    expect(resolved.receipt.sourceRefs).toEqual(['artifact://source']);

    const capability = new DeterministicCapabilityBroker([{ toolRef: 'tool://read', providerRef: 'provider://one', schemaVersion: '1', access: 'read' }]);
    const effect = await capability.invoke({ identity, capabilityGrantRef: 'grant://one', toolRef: 'tool://read', providerRef: 'provider://one', schemaVersion: '1', input: {}, actionId: 'action-1', signal: new AbortController().signal });
    expect(effect.status).toBe('committed');
    expect(capability.calls).toHaveLength(1);

    const artifacts = new InMemoryArtifactFinalizeStore();
    expect(await artifacts.finalize({ identity, operationId: 'op-1' })).toMatchObject({ status: 'conflict', code: 'ARTIFACT_NOT_STAGED' });
    await expect(artifacts.stage({ identity, operationId: 'op-invalid', mediaType: 'text/plain', bytes: new TextEncoder().encode('body'), digest: sha256Digest('body'), sensitivity: 'internal', lineageRefs: [] })).rejects.toThrow('ARTIFACT_DIGEST_MISMATCH');
    const body = new TextEncoder().encode('body');
    await artifacts.stage({ identity, operationId: 'op-1', mediaType: 'text/plain', bytes: body, digest: sha256Bytes('body'), sensitivity: 'internal', lineageRefs: ['usage-receipt://usage-1'] });
    expect(await artifacts.get({ identity, artifactRef: 'artifact://finalized/not-yet' })).toBeUndefined();
    const finalized = await artifacts.finalize({ identity, operationId: 'op-1' });
    expect(finalized.status).toBe('finalized');
    if (finalized.status === 'finalized' || finalized.status === 'existing') {
      expect(finalized.artifact.artifactRef).toMatch(/^artifact:\/\/finalized\/[a-f0-9]{64}$/);
      expect(finalized.artifact.digest).toBe(sha256Bytes('body'));
      expect(finalized.artifact.sizeBytes).toBe(body.byteLength);
      await expect(artifacts.get({ identity, artifactRef: finalized.artifact.artifactRef })).resolves.toEqual(body);
      await expect(artifacts.get({ identity: { ...identity, tenantId: 'tenant-other' }, artifactRef: finalized.artifact.artifactRef })).resolves.toBeUndefined();
      await expect(artifacts.finalize({ identity, operationId: 'op-1' })).resolves.toMatchObject({ status: 'existing', artifact: finalized.artifact });
    }
  });

  it('cancels before artifact finalize without publishing a ref, then safely retries', async () => {
    const store = new InMemoryArtifactFinalizeStore();
    const body = new TextEncoder().encode('cancel-race-body');
    const request = { identity, operationId: 'cancel-race-operation', mediaType: 'text/plain' as const, bytes: body, digest: sha256Bytes('cancel-race-body'), sensitivity: 'internal' as const, lineageRefs: [] };
    await store.stage(request);
    store.cancelNext('finalize');
    await expect(store.finalize({ identity, operationId: request.operationId })).rejects.toThrow('CANCELLED');
    expect(await store.get({ identity, artifactRef: `artifact://finalized/${sha256Digest({ tenantId: identity.tenantId, operationId: request.operationId }).slice(7)}` })).toBeUndefined();
    const finalized = await store.finalize({ identity, operationId: request.operationId });
    expect(finalized.status).toBe('finalized');
  });

  it('reconciles staged temporary bodies and finalized metadata/body loss without exposing unsafe refs', async () => {
    const artifacts = new InMemoryArtifactFinalizeStore();
    const body = new TextEncoder().encode('reconcile-body');
    const request = (operationId: string) => ({ identity: { ...identity, invocationId: `${identity.invocationId}-${operationId}` }, operationId, mediaType: 'text/plain', bytes: body, digest: sha256Bytes('reconcile-body'), sensitivity: 'internal' as const, lineageRefs: ['usage-receipt://usage-reconcile'] });

    await artifacts.stage(request('orphan-operation'));
    await expect(artifacts.reconcile({ now: new Date().toISOString(), limit: 1 })).resolves.toEqual(['orphan-operation']);
    await expect(artifacts.finalize({ identity: request('orphan-operation').identity, operationId: 'orphan-operation' })).resolves.toEqual({ status: 'conflict', code: 'ARTIFACT_NOT_STAGED' });

    await artifacts.stage(request('response-loss-operation'));
    artifacts.loseResponseAfter('finalize');
    await expect(artifacts.finalize({ identity: request('response-loss-operation').identity, operationId: 'response-loss-operation' })).rejects.toThrow('RESPONSE_LOST');
    const recovered = await artifacts.finalize({ identity: request('response-loss-operation').identity, operationId: 'response-loss-operation' });
    expect(recovered.status).toBe('existing');

    await artifacts.stage(request('body-loss-operation'));
    const committed = await artifacts.finalize({ identity: request('body-loss-operation').identity, operationId: 'body-loss-operation' });
    if (committed.status !== 'finalized' && committed.status !== 'existing') throw new Error('expected finalized artifact');
    artifacts.injectBodyLoss({ tenantId: identity.tenantId, operationId: 'body-loss-operation' });
    await expect(artifacts.reconcile({ now: new Date().toISOString(), limit: 10 })).resolves.toEqual([committed.artifact.artifactRef]);
    await expect(artifacts.get({ identity: request('body-loss-operation').identity, artifactRef: committed.artifact.artifactRef })).resolves.toBeUndefined();
  });
});
