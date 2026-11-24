import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import type { NetProbeRuleRecord, NetProbeRuleStore, NetProbeRuleWrite } from '@sage/task-domain';
import { registerNetProbeRulesRoutes } from './net-probe-rules-api.js';

function createMemoryRuleStore(): NetProbeRuleStore {
  const rules = new Map<string, NetProbeRuleRecord>();
  return {
    async listNetProbeRules(tenantId) {
      return [...rules.values()].filter((r) => r.tenantId === tenantId);
    },
    async upsertNetProbeRule(tenantId, id, write: NetProbeRuleWrite, nowIso: string) {
      const key = `${tenantId}/${id}`;
      const existing = rules.get(key);
      const record: NetProbeRuleRecord = {
        tenantId,
        id,
        pattern: write.pattern,
        ports: write.ports,
        enabled: write.enabled,
        ...(write.description === undefined ? {} : { description: write.description }),
        createdAt: existing?.createdAt ?? nowIso,
        updatedAt: nowIso,
        ...(write.updatedBy === undefined ? {} : { updatedBy: write.updatedBy }),
      };
      rules.set(key, record);
      return record;
    },
    async deleteNetProbeRule(tenantId, id) {
      return rules.delete(`${tenantId}/${id}`);
    },
  };
}

describe('net-probe-rules API', () => {
  async function buildApp() {
    const app = Fastify({ logger: false });
    registerNetProbeRulesRoutes(app, {
      tenantId: 'tenant-local',
      store: createMemoryRuleStore(),
      authenticator: { authenticateRequest: () => ({ principalId: 'op-1', tenantId: 'tenant-local' }) },
      now: () => new Date('2026-11-24T12:00:00.000Z'),
    });
    return app;
  }

  it('creates, updates, lists, and deletes wildcard probe rules dynamically', async () => {
    const app = await buildApp();
    const putRes = await app.inject({
      method: 'PUT',
      url: '/v1/net-probe-rules/primary-domain',
      payload: { pattern: '*.example.com', ports: [443, 8443], description: 'wildcard rule' },
    });
    expect(putRes.statusCode).toBe(200);
    expect(putRes.json()).toMatchObject({
      id: 'primary-domain',
      pattern: '*.example.com',
      ports: [443, 8443],
      enabled: true,
    });

    const listRes = await app.inject({ method: 'GET', url: '/v1/net-probe-rules' });
    expect(listRes.statusCode).toBe(200);
    expect(listRes.json().items).toHaveLength(1);

    const delRes = await app.inject({ method: 'DELETE', url: '/v1/net-probe-rules/primary-domain' });
    expect(delRes.statusCode).toBe(200);
    expect(delRes.json()).toEqual({ deleted: true, id: 'primary-domain' });
  });

  it('rejects overly broad wildcards, private hosts, and invalid ports/ids', async () => {
    const app = await buildApp();
    for (const pattern of ['*', '*.com', 'localhost', '127.0.0.1', 'internal.internal']) {
      const res = await app.inject({
        method: 'PUT',
        url: '/v1/net-probe-rules/bad-rule',
        payload: { pattern },
      });
      expect(res.statusCode).toBe(400);
    }
    const badPort = await app.inject({
      method: 'PUT',
      url: '/v1/net-probe-rules/bad-port',
      payload: { pattern: '*.example.com', ports: [70000] },
    });
    expect(badPort.statusCode).toBe(400);
  });
});
