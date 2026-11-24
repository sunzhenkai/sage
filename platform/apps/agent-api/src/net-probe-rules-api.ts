import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { NET_PROBE_RULE_ID_PATTERN, type NetProbeRuleRecord, type NetProbeRuleStore } from '@sage/task-domain';
import { isValidNetProbePattern } from '@sage/tool-runtime';

export interface NetProbeRulesPrincipalAuthenticator {
  authenticateRequest?(request: FastifyRequest): { readonly principalId: string; readonly tenantId: string } | undefined;
}

export interface RegisterNetProbeRulesRoutesOptions {
  readonly tenantId: string;
  readonly store: NetProbeRuleStore;
  readonly authenticator: NetProbeRulesPrincipalAuthenticator;
  readonly now?: () => Date;
}

const MAX_PORTS = 16;
const ALLOWED_FIELDS = new Set(['pattern', 'ports', 'enabled', 'description']);

const sendError = (reply: FastifyReply, status: number, code: string, message: string): FastifyReply =>
  reply.code(status).send({ error: { code, message, retryable: false } });

interface ParsedRuleWrite {
  readonly pattern: string;
  readonly ports: readonly number[];
  readonly enabled: boolean;
  readonly description?: string;
}

const parseWrite = (body: unknown): { readonly write?: ParsedRuleWrite; readonly error?: string } => {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return { error: 'body must be an object' };
  const raw = body as Record<string, unknown>;
  for (const key of Object.keys(raw)) {
    if (!ALLOWED_FIELDS.has(key)) return { error: `unsupported field '${key}'` };
  }
  if (typeof raw.pattern !== 'string' || !isValidNetProbePattern(raw.pattern)) {
    return { error: 'pattern must be a valid public hostname or subdomain wildcard (e.g. *.example.com)' };
  }
  const pattern = raw.pattern.trim().toLowerCase();

  let ports: number[] = [443];
  if (raw.ports !== undefined) {
    if (!Array.isArray(raw.ports) || raw.ports.length === 0 || raw.ports.length > MAX_PORTS) {
      return { error: `ports must be an array of 1-${MAX_PORTS} integers` };
    }
    const deduped: number[] = [];
    for (const p of raw.ports) {
      if (typeof p !== 'number' || !Number.isInteger(p) || p < 1 || p > 65_535) {
        return { error: 'each port must be an integer between 1 and 65535' };
      }
      if (!deduped.includes(p)) deduped.push(p);
    }
    ports = deduped;
  }

  const enabled = raw.enabled === undefined ? true : raw.enabled;
  if (typeof enabled !== 'boolean') return { error: 'enabled must be a boolean' };

  let description: string | undefined;
  if (raw.description !== undefined) {
    if (typeof raw.description !== 'string' || raw.description.length > 256) {
      return { error: 'description must be <= 256 characters' };
    }
    const trimmed = raw.description.trim();
    if (trimmed.length > 0) description = trimmed;
  }

  return {
    write: {
      pattern,
      ports,
      enabled,
      ...(description === undefined ? {} : { description }),
    },
  };
};

export function registerNetProbeRulesRoutes(app: FastifyInstance, options: RegisterNetProbeRulesRoutesOptions): void {
  const now = options.now ?? (() => new Date());

  const principalOf = (request: FastifyRequest, reply: FastifyReply) => {
    const principal = options.authenticator.authenticateRequest?.(request);
    if (!principal || principal.tenantId !== options.tenantId) {
      void sendError(reply, 401, 'NET_PROBE_RULES_AUTH_REQUIRED', 'Authentication required');
      return undefined;
    }
    return principal;
  };

  app.get('/v1/net-probe-rules', async (request, reply) => {
    if (!principalOf(request, reply)) return;
    const items: readonly NetProbeRuleRecord[] = await options.store.listNetProbeRules(options.tenantId);
    return reply.code(200).send({ items });
  });

  app.put<{ Params: { id: string } }>('/v1/net-probe-rules/:id', async (request, reply) => {
    const principal = principalOf(request, reply);
    if (!principal) return;
    const id = request.params.id;
    if (!NET_PROBE_RULE_ID_PATTERN.test(id)) {
      return sendError(reply, 400, 'NET_PROBE_RULE_INVALID', 'id must match ^[a-z0-9][a-z0-9-]{0,63}$');
    }
    const parsed = parseWrite(request.body);
    if (parsed.error !== undefined || parsed.write === undefined) {
      return sendError(reply, 400, 'NET_PROBE_RULE_INVALID', parsed.error ?? 'invalid body');
    }
    const saved = await options.store.upsertNetProbeRule(
      options.tenantId,
      id,
      { ...parsed.write, updatedBy: principal.principalId },
      now().toISOString()
    );
    return reply.code(200).send(saved);
  });

  app.delete<{ Params: { id: string } }>('/v1/net-probe-rules/:id', async (request, reply) => {
    if (!principalOf(request, reply)) return;
    const id = request.params.id;
    if (!NET_PROBE_RULE_ID_PATTERN.test(id)) {
      return sendError(reply, 400, 'NET_PROBE_RULE_INVALID', 'id must match ^[a-z0-9][a-z0-9-]{0,63}$');
    }
    const deleted = await options.store.deleteNetProbeRule(options.tenantId, id);
    if (!deleted) {
      return sendError(reply, 404, 'NET_PROBE_RULE_NOT_FOUND', `Net probe rule '${id}' not found`);
    }
    return reply.code(200).send({ deleted: true, id });
  });
}
