import type { FastifyInstance } from 'fastify';
import type { EffectResolution } from '@sage/agent-contracts';
import { sha256Digest } from '@sage/agent-contracts';
import type { SecurityAuditPort, ToolEffectLedgerPort, TrustedPrincipal } from '@sage/platform-ports';

export class EffectResolutionService {
  constructor(private readonly ledger: ToolEffectLedgerPort, private readonly audit: SecurityAuditPort) {}
  async resolve(input: { readonly principal: TrustedPrincipal; readonly originalExecutorRef: string; readonly semanticActionId: string; readonly decision: EffectResolution['decision']; readonly evidenceDigest: string; readonly reason: string; readonly policyVersion: string; readonly now?: () => Date }) {
    const occurredAt = (input.now ?? (() => new Date()))().toISOString();
    const deny = async (code: string): Promise<never> => { await this.audit.append({ tenantId: input.principal.tenantId, occurredAt, category: 'resolution', decision: 'DENY', reasonCode: code, actorRef: input.principal.principalRef, correlation: { semantic_action_id: input.semanticActionId }, authorityDigest: sha256Digest([code, input.semanticActionId, input.principal.principalRef]) }); throw new Error(code); };
    if (!input.principal.maximumScopes.includes('effect:resolve')) return deny('EFFECT_RESOLUTION_DENIED');
    if (input.principal.principalRef === input.originalExecutorRef) return deny('APPROVER_SEPARATION_REQUIRED');
    if (!/^sha256:[a-f0-9]{64}$/.test(input.semanticActionId) || !/^sha256:[a-f0-9]{64}$/.test(input.evidenceDigest) || input.reason.trim().length < 1 || input.reason.length > 2048 || input.policyVersion.trim().length < 1) return deny('EFFECT_RESOLUTION_INVALID');
    const resolution: EffectResolution = { schemaVersion: '1', resolutionRef: `effect-resolution://${input.semanticActionId.slice(7)}/${encodeURIComponent(input.principal.principalRef)}`, tenantId: input.principal.tenantId, semanticActionId: input.semanticActionId, decision: input.decision, evidenceDigest: input.evidenceDigest, resolverRef: input.principal.principalRef, originalExecutorRef: input.originalExecutorRef, reason: input.reason, policyVersion: input.policyVersion, resolvedAt: occurredAt };
    await this.audit.append({ tenantId: input.principal.tenantId, occurredAt, category: 'resolution', decision: 'PENDING', reasonCode: 'EFFECT_RESOLUTION_FENCED', actorRef: input.principal.principalRef, correlation: { semantic_action_id: input.semanticActionId, resolution_ref: resolution.resolutionRef }, authorityDigest: input.evidenceDigest });
    const result = await this.ledger.resolve({ resolution, resolverScopes: input.principal.maximumScopes });
    if (result.status === 'denied' || result.status === 'conflict') return deny(result.code);
    await this.audit.append({ tenantId: input.principal.tenantId, occurredAt, category: 'resolution', decision: input.decision, reasonCode: result.status === 'existing' ? 'EFFECT_RESOLUTION_EXISTING' : 'EFFECT_RESOLUTION_RECORDED', actorRef: input.principal.principalRef, correlation: { semantic_action_id: input.semanticActionId, resolution_ref: resolution.resolutionRef }, authorityDigest: input.evidenceDigest });
    return result;
  }
}

export interface EffectResolutionAuthenticator { authenticate(input: { readonly authorization?: string; readonly expectedAudience: string }): Promise<TrustedPrincipal> }
export function registerEffectResolutionRoute(app: FastifyInstance, options: { readonly service: EffectResolutionService; readonly authenticator: EffectResolutionAuthenticator; readonly expectedAudience: string }): void {
  app.post<{ Params: { semanticActionId: string }; Body: { originalExecutorRef?: string; decision?: EffectResolution['decision']; evidenceDigest?: string; reason?: string; policyVersion?: string } }>('/v1/production/effects/:semanticActionId/resolution', async (request, reply) => {
    try {
      const principal = await options.authenticator.authenticate({ expectedAudience: options.expectedAudience, ...(request.headers.authorization === undefined ? {} : { authorization: request.headers.authorization }) });
      const body = request.body ?? {};
      if (!body.originalExecutorRef || !body.decision || !body.evidenceDigest || !body.reason || !body.policyVersion || !['CONFIRMED_COMMITTED', 'CONFIRMED_NOT_COMMITTED', 'ABANDONED'].includes(body.decision)) throw new Error('EFFECT_RESOLUTION_INVALID');
      const result = await options.service.resolve({ principal, originalExecutorRef: body.originalExecutorRef, semanticActionId: request.params.semanticActionId, decision: body.decision, evidenceDigest: body.evidenceDigest, reason: body.reason, policyVersion: body.policyVersion });
      return reply.code(result.status === 'existing' ? 200 : 201).send(result);
    } catch (cause) {
      const code = cause instanceof Error ? cause.message : 'EFFECT_RESOLUTION_DENIED';
      const status = code === 'EFFECT_RESOLUTION_DENIED' || code === 'APPROVER_SEPARATION_REQUIRED' ? 403 : code.includes('CONFLICT') || code === 'EFFECT_NOT_UNKNOWN' ? 409 : 400;
      return reply.code(status).send({ error: { code, retryable: false } });
    }
  });
}
