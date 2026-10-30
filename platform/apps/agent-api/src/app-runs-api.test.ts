import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import type { AuthenticatedPrincipal } from '@sage/app-contracts';
import { InMemoryAgentReleaseStore } from '@sage/agent-release-registry';
import type { TaskPackageInputRecord, TaskPackageRunIndexEntry, TaskProjectionView, TaskStatus } from '@sage/task-domain';
import { registerAppsRoutes } from './apps-api.js';
import { registerAppRunsRoutes } from './app-runs-api.js';

const principal: AuthenticatedPrincipal = {
  authenticationId: 'auth-registrar',
  principalId: 'registrar',
  tenantId: 'tenant-local',
  roles: ['package-registrar']
};

const filesFor = (id: string, version = '1.0.0') => ({
  'app.yaml': [
    "schemaVersion: '1'",
    `id: ${id}`,
    `version: ${version}`,
    'description: 一个演示用 ai app 源包',
    'entry: prompts/system.md',
    'modelRoute:',
    '  provider: anthropic',
    '  model: claude-sonnet-4-5',
    ''
  ].join('\n'),
  'prompts/system.md': `# ${id}\n你是演示助手。\n`
});

const view = (taskId: string, status: TaskStatus, overrides: Partial<TaskProjectionView> = {}): TaskProjectionView =>
  ({ taskId, status, freshness: 'fresh', ...overrides }) as TaskProjectionView;

interface Harness {
  readonly entries: TaskPackageRunIndexEntry[];
  readonly inputs: Map<string, TaskPackageInputRecord>;
  readonly views: Map<string, TaskProjectionView>;
  readonly listCalls: { readonly releaseIds: readonly string[]; readonly limit: number }[];
  listFailure?: Error | undefined;
  viewFailure?: Error | undefined;
}

async function api(options: { readonly authenticated?: boolean; readonly harness?: Harness } = {}) {
  const harness: Harness = options.harness ?? { entries: [], inputs: new Map(), views: new Map(), listCalls: [] };
  const app = Fastify({ logger: false });
  const store = new InMemoryAgentReleaseStore({ now: () => new Date('2026-10-20T00:00:00.000Z') });
  registerAppsRoutes(app, {
    tenantId: 'tenant-local', store, ownerNamespace: 'package-platform',
    authenticator: { authenticateRequest: () => options.authenticated === false ? undefined : principal },
    engineIds: ['engine-local']
  });
  registerAppRunsRoutes(app, {
    tenantId: 'tenant-local', store,
    packageRuns: {
      async listPackageRuns(tenantId: string, filter) {
        expect(tenantId).toBe('tenant-local');
        harness.listCalls.push(filter);
        if (harness.listFailure !== undefined) throw harness.listFailure;
        return harness.entries
          .filter((entry) => filter.releaseIds.includes(entry.releaseId))
          .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.taskId.localeCompare(left.taskId))
          .slice(0, filter.limit);
      }
    },
    packageInputs: {
      async getPackageInput(tenantId: string, taskId: string) {
        return harness.inputs.get(`${tenantId}:${taskId}`);
      }
    },
    taskViews: {
      async listTaskViews() { return []; },
      async listTaskEvents() { return []; },
      async listTaskArtifacts() { return []; },
      async getTaskView(_tenantId: string, taskId: string) {
        if (harness.viewFailure !== undefined) throw harness.viewFailure;
        return harness.views.get(taskId);
      }
    },
    authenticator: { authenticateRequest: () => options.authenticated === false ? undefined : principal },
    now: () => new Date('2026-10-20T01:00:00.000Z')
  });
  await app.ready();
  return { app, store, harness };
}

async function publishVersion(app: Awaited<ReturnType<typeof api>>['app'], appId: string, version: string) {
  const draft = await app.inject({ method: 'PUT', url: `/v1/apps/${appId}/draft`, payload: { files: filesFor(appId, version) } });
  const baseRevision = (draft.json() as { revision: number }).revision;
  return app.inject({ method: 'POST', url: `/v1/apps/${appId}/releases`, payload: { baseRevision } });
}

async function seedApp(app: Awaited<ReturnType<typeof api>>['app']) {
  await app.inject({ method: 'POST', url: '/v1/apps', payload: { appId: 'demo-app', name: 'Demo' } });
  const v1 = await publishVersion(app, 'demo-app', '1.0.0');
  const v2 = await publishVersion(app, 'demo-app', '2.0.0');
  return {
    v1: v1.json() as { releaseId: string },
    v2: v2.json() as { releaseId: string }
  };
}

function entry(taskId: string, releaseId: string, createdAt: string): TaskPackageRunIndexEntry {
  return { taskId, releaseId, releaseDigest: `sha256:${'a'.repeat(64)}`, createdAt };
}

describe('App run history API', () => {
  it('requires authentication', async () => {
    const { app } = await api({ authenticated: false });
    expect((await app.inject('/v1/apps/demo-app/runs')).statusCode).toBe(401);
    expect((await app.inject('/v1/apps/demo-app/runs/task-1')).statusCode).toBe(401);
    await app.close();
  });

  it('returns manual and schedule runs with projection status and release versions', async () => {
    const harness: Harness = { entries: [], inputs: new Map(), views: new Map(), listCalls: [] };
    const { app } = await api({ harness });
    const releases = await seedApp(app);
    harness.entries.push(
      entry('task-manual', releases.v2.releaseId, '2026-10-20T00:02:00.000Z'),
      entry('pkg-sched-daily-1', releases.v1.releaseId, '2026-10-20T00:01:00.000Z'),
      entry('task-pending', releases.v1.releaseId, '2026-10-20T00:00:00.000Z')
    );
    harness.views.set('task-manual', view('task-manual', 'running', {
      freshness: 'stale', failureCode: 'PROVIDER_TIMEOUT', projectionUpdatedAt: '2026-10-20T00:02:30.000Z'
    }));
    harness.views.set('pkg-sched-daily-1', view('pkg-sched-daily-1', 'succeeded'));

    const response = await app.inject('/v1/apps/demo-app/runs');
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      schemaVersion: 'AppRunList.v1',
      appId: 'demo-app',
      runs: [
        { taskId: 'task-manual', releaseVersion: '2.0.0', source: 'manual', status: 'running', freshness: 'stale', failureCode: 'PROVIDER_TIMEOUT', updatedAt: '2026-10-20T00:02:30.000Z' },
        { taskId: 'pkg-sched-daily-1', releaseVersion: '1.0.0', source: 'schedule', status: 'succeeded' },
        { taskId: 'task-pending', releaseVersion: '1.0.0', source: 'manual', status: 'pending' }
      ]
    });
    expect(harness.listCalls[0]).toEqual({ releaseIds: [releases.v2.releaseId, releases.v1.releaseId], limit: 50 });
    await app.close();
  });

  it('filters by release and validates query boundaries', async () => {
    const harness: Harness = { entries: [], inputs: new Map(), views: new Map(), listCalls: [] };
    const { app } = await api({ harness });
    const releases = await seedApp(app);
    harness.entries.push(
      entry('task-v1', releases.v1.releaseId, '2026-10-20T00:00:00.000Z'),
      entry('task-v2', releases.v2.releaseId, '2026-10-20T00:01:00.000Z')
    );

    const filtered = await app.inject(`/v1/apps/demo-app/runs?releaseId=${encodeURIComponent(releases.v1.releaseId)}&limit=10`);
    expect(filtered.statusCode).toBe(200);
    expect(filtered.json().runs).toMatchObject([{ taskId: 'task-v1' }]);
    expect(harness.listCalls.at(-1)).toEqual({ releaseIds: [releases.v1.releaseId], limit: 10 });

    expect((await app.inject('/v1/apps/demo-app/runs?limit=0')).json().error.code).toBe('INVALID_APP_RUN_QUERY');
    expect((await app.inject('/v1/apps/demo-app/runs?limit=101')).statusCode).toBe(400);
    expect((await app.inject('/v1/apps/demo-app/runs?limit=abc')).statusCode).toBe(400);
    expect((await app.inject('/v1/apps/demo-app/runs?unknown=1')).statusCode).toBe(400);
    expect((await app.inject('/v1/apps/demo-app/runs?releaseId=not-a-release')).statusCode).toBe(400);
    expect((await app.inject(`/v1/apps/demo-app/runs?releaseId=sha256:${'b'.repeat(64)}`)).json().error.code).toBe('APP_RELEASE_NOT_FOUND');
    expect((await app.inject('/v1/apps/missing/runs')).json().error.code).toBe('APP_NOT_FOUND');

    const empty = await api({ harness: { entries: [], inputs: new Map(), views: new Map(), listCalls: [] } });
    await empty.app.inject({ method: 'POST', url: '/v1/apps', payload: { appId: 'empty-app', name: 'Empty' } });
    expect((await empty.app.inject('/v1/apps/empty-app/runs')).json()).toMatchObject({ schemaVersion: 'AppRunList.v1', runs: [] });
    expect((await empty.app.inject('/v1/apps/empty-app/runs')).statusCode).toBe(200);
    await empty.app.close();
    await app.close();
  });

  it('returns run detail and hides runs from other apps', async () => {
    const harness: Harness = { entries: [], inputs: new Map(), views: new Map(), listCalls: [] };
    const { app } = await api({ harness });
    const releases = await seedApp(app);
    await app.inject({ method: 'POST', url: '/v1/apps', payload: { appId: 'other-app', name: 'Other' } });
    const other = await publishVersion(app, 'other-app', '1.0.0');
    const otherReleaseId = (other.json() as { releaseId: string }).releaseId;

    harness.inputs.set('tenant-local:task-detail', {
      tenantId: 'tenant-local', taskId: 'task-detail', releaseId: releases.v1.releaseId,
      releaseDigest: `sha256:${'a'.repeat(64)}`, assembledInput: 'prompt', assetDigests: {}, createdAt: '2026-10-20T00:00:00.000Z'
    });
    harness.inputs.set('tenant-local:task-foreign', {
      tenantId: 'tenant-local', taskId: 'task-foreign', releaseId: otherReleaseId,
      releaseDigest: `sha256:${'a'.repeat(64)}`, assembledInput: 'prompt', assetDigests: {}, createdAt: '2026-10-20T00:00:00.000Z'
    });
    harness.views.set('task-detail', view('task-detail', 'failed', { failureCode: 'AGENT_FAILED', failureDetail: 'AGENT_FAILED: model refused' }));

    const detail = await app.inject('/v1/apps/demo-app/runs/task-detail');
    expect(detail.statusCode).toBe(200);
    expect(detail.json()).toMatchObject({
      schemaVersion: 'AppRunDetail.v1', appId: 'demo-app',
      run: { taskId: 'task-detail', releaseId: releases.v1.releaseId, releaseVersion: '1.0.0', source: 'manual', status: 'failed', failureCode: 'AGENT_FAILED', failureDetail: 'AGENT_FAILED: model refused' }
    });

    harness.inputs.delete('tenant-local:task-detail');
    expect((await app.inject('/v1/apps/demo-app/runs/task-detail')).json().error.code).toBe('APP_RUN_NOT_FOUND');
    expect((await app.inject('/v1/apps/demo-app/runs/task-foreign')).json().error.code).toBe('APP_RUN_NOT_FOUND');
    await app.close();
  });

  it('maps store and projection outages to retryable 503', async () => {
    const harness: Harness = { entries: [], inputs: new Map(), views: new Map(), listCalls: [] };
    const { app } = await api({ harness });
    const releases = await seedApp(app);
    harness.entries.push(entry('task-1', releases.v1.releaseId, '2026-10-20T00:00:00.000Z'));
    harness.listFailure = new Error('down');
    const list = await app.inject('/v1/apps/demo-app/runs');
    expect(list.statusCode).toBe(503);
    expect(list.json()).toMatchObject({ error: { code: 'APP_RUN_HISTORY_UNAVAILABLE', retryable: true } });

    harness.listFailure = undefined;
    harness.inputs.set('tenant-local:task-1', {
      tenantId: 'tenant-local', taskId: 'task-1', releaseId: releases.v1.releaseId,
      releaseDigest: `sha256:${'a'.repeat(64)}`, assembledInput: 'prompt', assetDigests: {}, createdAt: '2026-10-20T00:00:00.000Z'
    });
    harness.viewFailure = new Error('down');
    expect((await app.inject('/v1/apps/demo-app/runs/task-1')).statusCode).toBe(503);
    await app.close();
  });
});
