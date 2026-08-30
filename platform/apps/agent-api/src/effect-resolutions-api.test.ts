import Fastify from 'fastify';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { EffectClaim } from '@sage/agent-contracts';
import type { ToolEffectLedgerPort, TrustedPrincipal } from '@sage/platform-ports';
import { EffectResolutionService } from './effect-resolution.js';
import { registerEffectResolutionsRoute } from './effect-resolutions-api.js';

const digest = (value: unknown): string => `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;

const claim: EffectClaim = {
  schemaVersion: '1', tenantId: 'tenant-a', semanticActionId: digest('action-1'), taskId: 'task-1',
  attemptCompatibleActionKey: 'action-1', toolRef: 'tool://webhook', toolVersion: '1',
  providerRef: 'provider://http', providerBuildDigest: digest('p'), canonicalInputDigest: digest('i'),
  invocationId: 'inv-1', leaseOwner: 'principal://worker-1', leaseExpiresAt: new Date(Date.now() + 60_000).toISOString()
};

class LedgerStub implements ToolEffectLedgerPort {
  claims = new Map<string, EffectClaim>([[claim.semanticActionId, claim]]);
  states = new Map<string, string>([[claim.semanticActionId, 'EFFECT_UNKNOWN']]);
  resolutions: Parameters<ToolEffectLedgerPort['resolve']>[0]['resolution'][] = [];
  async claim(input: EffectClaim): Promise<Awaited<ReturnType<ToolEffectLedgerPort['claim']>>> { this.claims.set(input.semanticActionId, input); return { status: 'claimed', fenceEpoch: 1, leaseExpiresAt: input.leaseExpiresAt }; }
  async commit() { return { status: 'conflict', code: 'EFFECT_CONFLICT' } as const; }
  async markUnknown(input: { readonly claim: EffectClaim }): Promise<Awaited<ReturnType<ToolEffectLedgerPort['markUnknown']>>> { this.states.set(input.claim.semanticActionId, 'EFFECT_UNKNOWN'); return { schemaVersion: '1', receiptRef: 'r', receiptDigest: digest('r'), tenantId: input.claim.tenantId, semanticActionId: input.claim.semanticActionId, state: 'EFFECT_UNKNOWN' as const, canonicalInputDigest: input.claim.canonicalInputDigest, toolVersion: input.claim.toolVersion, providerBuildDigest: input.claim.providerBuildDigest, fenceEpoch: 1, outcomeDigest: digest('o'), normalizedResult: {}, committedAt: new Date().toISOString() }; }
  async resolve(input: Parameters<ToolEffectLedgerPort['resolve']>[0]): Promise<Awaited<ReturnType<ToolEffectLedgerPort['resolve']>>> {
    if (!input.resolverScopes.includes('effect:resolve')) return { status: 'denied', code: 'EFFECT_RESOLUTION_DENIED' } as const;
    if (input.resolution.resolverRef === input.resolution.originalExecutorRef) return { status: 'denied', code: 'APPROVER_SEPARATION_REQUIRED' } as const;
    const state = this.states.get(input.resolution.semanticActionId);
    if (state === 'RESOLVED') {
      const prior = this.resolutions.find(item => item.semanticActionId === input.resolution.semanticActionId);
      return prior !== undefined && prior.resolverRef === input.resolution.resolverRef && prior.reason === input.resolution.reason
        ? { status: 'existing', resolution: prior } as const
        : { status: 'conflict', code: 'EFFECT_RESOLUTION_CONFLICT' } as const;
    }
    if (state !== 'EFFECT_UNKNOWN') return { status: 'conflict', code: 'EFFECT_NOT_UNKNOWN' } as const;
    this.states.set(input.resolution.semanticActionId, 'RESOLVED');
    this.resolutions.push(input.resolution);
    return { status: 'resolved', resolution: input.resolution } as const;
  }
  async reconcile() { return []; }
  async health() { return { healthy: true, checkedAt: new Date().toISOString() }; }
  async getClaim(input: { readonly tenantId: string; readonly semanticActionId: string }) { return this.claims.get(input.semanticActionId); }
}

const principal = (scopes: readonly string[]): TrustedPrincipal => ({
  principalRef: 'principal://sre-1', identityType: 'service', tenantId: 'tenant-a', maximumScopes: [...scopes],
  roles: ['sre'], issuedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 300_000).toISOString(), issuer: 'test', subject: 'sre-1', audience: 'sage-api'
} as unknown as TrustedPrincipal);

const build = (scopes: readonly string[] = ['effect:resolve']) => {
  const app = Fastify();
  const ledger = new LedgerStub();
  const retried: string[] = [];
  const cancelled: string[] = [];
  registerEffectResolutionsRoute(app, {
    service: new EffectResolutionService(ledger, { append: async () => ({ auditRef: 'audit://1' }), query: async () => ({ records: [] }), health: async () => ({ healthy: true, checkedAt: new Date().toISOString() }) } as never),
    ledger,
    authenticator: { authenticate: async (input) => {
      if (input.authorization !== 'Bearer sre-token') throw new Error('IDENTITY_INVALID');
      return principal(scopes);
    } },
    expectedAudience: 'sage-api',
    taskControl: {
      retry: async (taskId) => { retried.push(taskId); return {}; },
      cancel: async (taskId) => { cancelled.push(taskId); return {}; }
    }
  });
  return { app, ledger, retried, cancelled };
};

const submit = {
  schemaVersion: '1' as const,
  semanticActionId: claim.semanticActionId,
  originalExecutorRef: 'principal://worker-1',
  decision: 'CONFIRMED_NOT_COMMITTED' as const,
  action: 'CONTINUE_NEW_ATTEMPT' as const,
  evidenceDigest: digest('evidence'),
  reason: '外部动作确认未提交，准予重试',
  policyVersion: 'pilot-v1'
};

describe('POST /v1/effects/resolutions', () => {
  it('records the resolution and continues with a new attempt', async () => {
    const { app, ledger, retried } = build();
    const response = await app.inject({ method: 'POST', url: '/v1/effects/resolutions', headers: { authorization: 'Bearer sre-token' }, payload: submit });
    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body).toMatchObject({ schemaVersion: 'EffectResolutionResult.v1', status: 'resolved', decision: 'CONFIRMED_NOT_COMMITTED', action: 'CONTINUE_NEW_ATTEMPT', actionState: 'COMPLETED', taskId: 'task-1' });
    expect(retried).toEqual(['task-1']);
    expect(ledger.states.get(claim.semanticActionId)).toBe('RESOLVED');
    const replay = await app.inject({ method: 'POST', url: '/v1/effects/resolutions', headers: { authorization: 'Bearer sre-token' }, payload: submit });
    expect(replay.statusCode).toBe(200);
    expect(replay.json().status).toBe('existing');
  });

  it('terminates the task when the decision abandons the action', async () => {
    const { app, cancelled } = build();
    const response = await app.inject({ method: 'POST', url: '/v1/effects/resolutions', headers: { authorization: 'Bearer sre-token' }, payload: { ...submit, action: 'TERMINATE' } });
    expect(response.statusCode).toBe(201);
    expect(response.json().action).toBe('TERMINATE');
    expect(cancelled).toEqual(['task-1']);
  });

  it('rejects unauthenticated, scope-less, and malformed submissions without recording anything', async () => {
    const noAuth = build();
    const rejected = await noAuth.app.inject({ method: 'POST', url: '/v1/effects/resolutions', payload: submit });
    expect(rejected.statusCode).toBe(400);
    expect(rejected.json().error.code).toBe('IDENTITY_INVALID');

    const noScope = build([]);
    const denied = await noScope.app.inject({ method: 'POST', url: '/v1/effects/resolutions', headers: { authorization: 'Bearer sre-token' }, payload: submit });
    expect(denied.statusCode).toBe(403);
    expect(denied.json().error.code).toBe('EFFECT_RESOLUTION_DENIED');
    expect(noScope.ledger.resolutions).toHaveLength(0);

    const malformed = build();
    const bad = await malformed.app.inject({ method: 'POST', url: '/v1/effects/resolutions', headers: { authorization: 'Bearer sre-token' }, payload: { ...submit, semanticActionId: 'sha256:short' } });
    expect(bad.statusCode).toBe(400);
    expect(malformed.ledger.resolutions).toHaveLength(0);
  });
});
