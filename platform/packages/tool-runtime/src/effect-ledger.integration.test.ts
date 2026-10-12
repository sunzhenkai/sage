import { describe, expect, it } from 'vitest';
import { Type } from 'typebox';
import { createHash } from 'node:crypto';
import type { EffectClaimResult, ToolEffectLedgerPort } from '@sage/platform-ports';
import { ToolPipeline, ToolRegistry, type ToolCall } from './index.js';
const canonical = (value: unknown): string => { if (value === null || typeof value === 'boolean' || typeof value === 'string' || typeof value === 'number') return JSON.stringify(value); if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`; return `{${Object.keys(value as Record<string, unknown>).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`; };
const sha256Digest = (value: unknown): `sha256:${string}` => `sha256:${createHash('sha256').update(canonical(value)).digest('hex')}`;
type EffectClaim = Parameters<ToolEffectLedgerPort['claim']>[0]; type EffectReceipt = Awaited<ReturnType<ToolEffectLedgerPort['markUnknown']>>;

describe('Tool Effect Ledger pipeline', () => {
  it('executes one sandboxed write across 100 serial deliveries and replays the exact immutable receipt/result', async () => {
    let executions = 0; let inProcess = 0; let receipt: EffectReceipt | undefined; let binding: EffectClaim | undefined;
    const ledger: ToolEffectLedgerPort = {
      claim: async claim => { if (binding && binding.canonicalInputDigest !== claim.canonicalInputDigest) return { status: 'conflict', code: 'EFFECT_CONFLICT' }; binding ??= claim; return receipt ? { status: 'replay', receipt } : { status: 'claimed', fenceEpoch: 1, leaseExpiresAt: claim.leaseExpiresAt } as EffectClaimResult; },
      commit: async ({ receipt: value }) => (receipt = value, { status: 'committed', receipt: value }),
      markUnknown: async ({ receipt: value }) => (receipt = value, value), resolve: async () => ({ status: 'denied', code: 'unused' }),
      reconcile: async () => [], health: async () => ({ healthy: true, checkedAt: new Date().toISOString() })
    };
    const registry = new ToolRegistry();
    registry.registerTool({ id: 'tool://write/v1', version: '1', access: 'write', risk: 'high', defaultAllowlisted: false, timeoutMs: 100, restrictedOutput: false, requiresCredential: false, inputSchema: Type.Object({ value: Type.Number() }), production: { executableRef: 'oci://write', network: 'none' }, execute: async () => { inProcess += 1; return { bypass: true }; } });
    const productionAuthorizer = { authorize: async (request: Parameters<NonNullable<ConstructorParameters<typeof ToolPipeline>[0]['productionAuthorizer']>['authorize']>[0]) => ({ schemaVersion: '1' as const, receiptRef: 'authorization://one', decisionDigest: sha256Digest(request), tenantId: request.tenantId, principalRef: request.principalRef, specRef: request.specRef, grantRef: request.grantRef, toolRef: request.toolRef, providerRef: request.providerRef, semanticActionId: request.semanticActionId, decision: 'ALLOW' as const, reasonCode: 'AUTHORIZED' as const, policyVersion: 'p1', grantRevision: 1, revocationRevision: 1, approvalRevision: 1, ledgerRevision: request.ledgerRevision, evaluatedAt: request.now, freshnessDeadline: new Date(Date.now() + 60_000).toISOString() }) };
    const consumptionLedger = {
      getAuthoritativeBalance: async () => ({ available: { calls: 100 }, reserved: {}, revision: 1 }),
      reserve: async (input: Parameters<NonNullable<ConstructorParameters<typeof ToolPipeline>[0]['consumptionLedger']>['reserve']>[0]) => ({ ...input, reservationRef: 'usage-reservation://one', state: 'RESERVED' as const, fenceEpoch: 1, createdAt: new Date().toISOString() }),
      release: async () => 'released' as const, commit: async () => { throw new Error('unused'); }, reconcile: async () => [], health: async () => ({ healthy: true, checkedAt: new Date().toISOString() })
    };
    const pipeline = new ToolPipeline({ registry, eventRecorder: { record: async () => {} }, telemetry: { record() {} }, productionAuthorizer, consumptionLedger, effectLedger: ledger, productionExecutor: { execute: async () => { executions += 1; return { exact: { ok: true }, execution: executions }; }, health: async () => ({ healthy: true, checkedAt: new Date().toISOString() }) } });
    const providerDigest = `sha256:${'a'.repeat(64)}` as const; const input = { value: 1 }; const canonicalInputDigest = sha256Digest(input); const semanticActionId = sha256Digest(['tenant-a', 't', 'once', '1', canonicalInputDigest]);
    const call: ToolCall = {
      toolId: 'tool://write/v1', input, tenantId: 'tenant-a', environment: 'production', correlation: { run_id: 'r', task_id: 't', attempt: 1, tool_call_id: 'c' },
      effectIdentity: { semanticActionId, taskId: 't', attemptCompatibleActionKey: 'once', toolVersion: '1', providerRef: 'provider://p', providerBuildDigest: providerDigest, canonicalInputDigest, invocationId: 'i', executorRef: 'principal://e' },
      productionAuthority: { principalRef: 'principal://e', specRef: 'spec://one', grantRef: 'grant://one', approvalRef: 'approval://one', resourceScopes: ['resource://one'], accountRef: 'account://one', upperBound: { calls: 1 }, requestedCount: 1, requestedCost: 1 }
    };
    const results = [];
    for (let index = 0; index < 100; index += 1) results.push(await pipeline.call(call));
    expect(executions).toBe(1); expect(inProcess).toBe(0);
    expect(results[0]).toMatchObject({ status: 'succeeded', output: { exact: { ok: true }, execution: 1 }, effectReceiptRef: receipt?.receiptRef });
    expect(results.slice(1).every(result => result.status === 'succeeded' && result.duplicate && result.effectReceiptRef === receipt?.receiptRef && JSON.stringify(result.output) === JSON.stringify({ exact: { ok: true }, execution: 1 }))).toBe(true);
    const conflict = await pipeline.call({ ...call, effectIdentity: { ...call.effectIdentity!, canonicalInputDigest: `sha256:${'b'.repeat(64)}` } });
    expect(conflict).toMatchObject({ status: 'denied', code: 'EFFECT_IDENTITY_INVALID' }); expect(executions).toBe(1);
  });
});
