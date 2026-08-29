import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import type { AuthenticatedPrincipal } from '@sage/app-contracts';
import type { FastifyRequest } from 'fastify';
import { InMemoryScheduleControlStore } from '@sage/local-fakes';
import type { SchedulePort, ScheduleSnapshot } from '@sage/platform-ports';
import { registerSchedulesRoutes, type ScheduleApiAuditPort } from './schedules-api.js';

const definition = {
  schemaVersion: '1' as const,
  scheduleId: 'daily-brief',
  tenantId: 'tenant-a',
  trigger: { kind: 'cron', expression: '0 9 * * *', timezone: 'Asia/Shanghai' },
  overlapPolicy: 'SKIP' as const,
  misfirePolicy: 'SKIP' as const,
  releaseBinding: { strategy: 'FIXED', releaseId: 'release-1', contentDigest: `sha256:${'a'.repeat(64)}` },
  targetConstraints: { allowedEnvironments: ['local'] },
  budget: { limits: [{ dimension: 'runs', limit: 100 }] },
  invocation: { task: 'daily', params: { window: 7 } }
};

class FakeFacility implements SchedulePort {
  readonly #records = new Map<string, ScheduleSnapshot>();
  async create(snap: ScheduleSnapshot['definition']): Promise<ScheduleSnapshot> {
    const key = `${snap.tenantId}\u0000${snap.scheduleId}`;
    if (this.#records.has(key)) throw new Error('SCHEDULE_ALREADY_EXISTS: dup');
    const snapshot: ScheduleSnapshot = { schemaVersion: '1', definition: snap, revision: 1, state: 'ACTIVE', contentDigest: `sha256:${'f'.repeat(64)}`, createdAtMs: 1, updatedAtMs: 1 };
    this.#records.set(key, snapshot);
    return snapshot;
  }
  async update() { throw new Error('unsupported'); }
  async pause(ref: { tenantId: string; scheduleId: string }) { return this.#transition(ref, 'PAUSED'); }
  async resume(ref: { tenantId: string; scheduleId: string }) { return this.#transition(ref, 'ACTIVE'); }
  async remove(ref: { tenantId: string; scheduleId: string }) { this.#records.delete(`${ref.tenantId}\u0000${ref.scheduleId}`); }
  async describe(ref: { tenantId: string; scheduleId: string }) { return this.#records.get(`${ref.tenantId}\u0000${ref.scheduleId}`); }
  async nextFireAtMs(ref: { tenantId: string; scheduleId: string }) { const snap = await this.describe(ref); return snap?.state === 'ACTIVE' ? 5_000 : undefined; }
  async health() { return { healthy: true, checkedAt: new Date().toISOString() }; }
  #transition(ref: { tenantId: string; scheduleId: string }, state: ScheduleSnapshot['state']): ScheduleSnapshot {
    const snapshot = this.#records.get(`${ref.tenantId}\u0000${ref.scheduleId}`);
    if (snapshot === undefined) throw new Error('SCHEDULE_NOT_FOUND: missing');
    const next = { ...snapshot, state, updatedAtMs: 2 };
    this.#records.set(`${ref.tenantId}\u0000${ref.scheduleId}`, next);
    return next;
  }
}

interface Harness { app: ReturnType<typeof Fastify>; audit: { records: { decision: string }[] }; token: string }

const build = (options: { readonly token?: string } = {}): Harness => {
  const app = Fastify();
  const store = new InMemoryScheduleControlStore();
  const audit: { records: { decision: string }[] } = { records: [] };
  const auditPort: ScheduleApiAuditPort = { append: async (input) => { audit.records.push({ decision: input.decision }); } };
  registerSchedulesRoutes(app, {
    tenantId: 'tenant-a',
    store,
    adapter: new FakeFacility(),
    releaseResolver: {
      resolveRelease: async (_tenant, releaseId) => releaseId === 'release-1' ? {
        release: { releaseRef: 'release://release-1', releaseId, contentDigest: `sha256:${'a'.repeat(64)}` },
        manifest: { tasks: [{ name: 'daily' }], inputs: [{ name: 'window', type: 'number', required: false, default: 7 }] }
      } : undefined
    },
    authenticator: {
      authenticateRequest: (request: FastifyRequest): AuthenticatedPrincipal | undefined => {
        const header = request.headers.authorization;
        if (header !== `Bearer ${options.token ?? 'dev-token'}`) return undefined;
        return { authenticationId: 'service-token://abc', principalId: 'service-token://abc', tenantId: 'tenant-a', roles: ['schedule-operator'] };
      }
    },
    audit: auditPort
  });
  return { app, audit, token: options.token ?? 'dev-token' };
};

describe('P8 /v1/schedules API', () => {
  it('requires service token authentication on every management operation', async () => {
    const { app } = build();
    for (const [method, url] of [['POST', '/v1/schedules'], ['GET', '/v1/schedules'], ['GET', '/v1/schedules/daily-brief'], ['POST', '/v1/schedules/daily-brief/pause'], ['DELETE', '/v1/schedules/daily-brief']] as const) {
      const response = await app.inject({ method, url, ...(method === 'POST' ? { payload: { definition, releaseId: 'release-1' } } : {}) });
      expect(response.statusCode, `${method} ${url}`).toBe(401);
      expect(response.json().error.code).toBe('SCHEDULE_AUTHENTICATION_REQUIRED');
    }
    // stub 信任头不再提权：仅带 x-authentication-id 的请求与未认证一致。
    const stubbed = await app.inject({ method: 'GET', url: '/v1/schedules', headers: { 'x-authentication-id': 'admin' } });
    expect(stubbed.statusCode).toBe(401);
  });

  it('creates a schedule after binding validation and returns next fire time', async () => {
    const { app } = build();
    const created = await app.inject({ method: 'POST', url: '/v1/schedules', headers: { authorization: 'Bearer dev-token' }, payload: { definition, releaseId: 'release-1' } });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ schemaVersion: '1', state: 'ACTIVE', nextFireAtMs: 5_000 });
    const duplicate = await app.inject({ method: 'POST', url: '/v1/schedules', headers: { authorization: 'Bearer dev-token' }, payload: { definition, releaseId: 'release-1' } });
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json().error.code).toBe('SCHEDULE_ALREADY_EXISTS');
  });

  it('rejects creation when the bound task or params are not declared by the anchor release', async () => {
    const { app } = build();
    const badTask = await app.inject({ method: 'POST', url: '/v1/schedules', headers: { authorization: 'Bearer dev-token' }, payload: { definition: { ...definition, invocation: { task: 'unknown-task' } }, releaseId: 'release-1' } });
    expect(badTask.statusCode).toBe(400);
    expect(badTask.json().error.code).toBe('SCHEDULE_VALIDATION_FAILED');
    expect(badTask.json().error.message).toContain("task 'unknown-task' not declared");
    const badParams = await app.inject({ method: 'POST', url: '/v1/schedules', headers: { authorization: 'Bearer dev-token' }, payload: { definition: { ...definition, invocation: { task: 'daily', params: { mystery: 1 } } }, releaseId: 'release-1' } });
    expect(badParams.statusCode).toBe(400);
    expect(badParams.json().error.message).toContain("param 'mystery' not declared");
    const badDigest = await app.inject({ method: 'POST', url: '/v1/schedules', headers: { authorization: 'Bearer dev-token' }, payload: { definition: { ...definition, releaseBinding: { strategy: 'FIXED', releaseId: 'release-1', contentDigest: `sha256:${'d'.repeat(64)}` } }, releaseId: 'release-1' } });
    expect(badDigest.statusCode).toBe(400);
    expect(badDigest.json().error.message).toContain('FIXED binding digest');
    const unknownRelease = await app.inject({ method: 'POST', url: '/v1/schedules', headers: { authorization: 'Bearer dev-token' }, payload: { definition, releaseId: 'release-404' } });
    expect(unknownRelease.statusCode).toBe(404);
  });

  it('pauses, resumes and deletes with immutable audit records', async () => {
    const { app, audit } = build();
    await app.inject({ method: 'POST', url: '/v1/schedules', headers: { authorization: 'Bearer dev-token' }, payload: { definition, releaseId: 'release-1' } });
    const paused = await app.inject({ method: 'POST', url: '/v1/schedules/daily-brief/pause', headers: { authorization: 'Bearer dev-token' } });
    expect(paused.json().state).toBe('PAUSED');
    const resumed = await app.inject({ method: 'POST', url: '/v1/schedules/daily-brief/resume', headers: { authorization: 'Bearer dev-token' } });
    expect(resumed.json().state).toBe('ACTIVE');
    const deleted = await app.inject({ method: 'DELETE', url: '/v1/schedules/daily-brief', headers: { authorization: 'Bearer dev-token' } });
    expect(deleted.json().state).toBe('DELETED');
    const gone = await app.inject({ method: 'GET', url: '/v1/schedules/daily-brief', headers: { authorization: 'Bearer dev-token' } });
    expect(gone.statusCode).toBe(404);
    expect(audit.records.map(record => record.decision)).toEqual(['CREATED', 'PAUSED', 'RESUMED', 'DELETED']);
  });

  it('serves trigger history', async () => {
    const { app } = build();
    await app.inject({ method: 'POST', url: '/v1/schedules', headers: { authorization: 'Bearer dev-token' }, payload: { definition, releaseId: 'release-1' } });
    // 直接触发历史端点（空历史）——事件由 dispatcher 管道写入。
    const history = await app.inject({ method: 'GET', url: '/v1/schedules/daily-brief/triggers', headers: { authorization: 'Bearer dev-token' } });
    expect(history.statusCode).toBe(200);
    expect(history.json()).toMatchObject({ schemaVersion: 'ScheduleTriggerHistory.v1', scheduleId: 'daily-brief', events: [] });
  });
});
