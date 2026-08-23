import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import type { AuthenticatedPrincipal } from '@sage/app-contracts';
import { InMemoryAgentTaskSpecStore } from '@sage/local-fakes';
import type { AgentTaskSpecStorePort } from '@sage/platform-ports';
import type { TaskPackageInputRecord } from '@sage/task-domain';
import {
  registerPackageRunsRoutes,
  type PackageReleaseResolver,
  type RegisterPackageRunsRoutesOptions,
} from './runs-api.js';
import type { TaskControllerPort } from './task-api.js';
import type { TaskQueryResult } from '@sage/task-domain';

const operator: AuthenticatedPrincipal = {
  authenticationId: 'auth-op',
  principalId: 'op',
  tenantId: 'tenant-local',
  roles: ['task-operator'],
};

const releasePayload = {
  schemaVersion: '1' as const,
  releaseRef: 'release://sha256:' + 'a'.repeat(64),
  releaseId: 'sha256:' + 'a'.repeat(64),
  packageRef: 'package://package-platform/demo-assistant',
  packageId: 'demo-assistant',
  packageVersion: '1.0.0',
  packageDigest: 'sha256:' + 'b'.repeat(64),
  contentDigest: 'sha256:' + 'c'.repeat(64),
  lockDigest: 'sha256:' + 'd'.repeat(64),
  ownerRef: 'owner://package-platform',
  compatibility: {
    kernelContractMajor: 1,
    engineIds: ['engine-local'],
    engineCompatibilityDigests: ['sha256:' + 'e'.repeat(64)],
  },
  provenance: {
    compilerRef: 'compiler://local',
    compilerDigest: 'sha256:' + 'f'.repeat(64),
    compilerBuild: 'local-dev',
    sourceDigest: 'sha256:' + 'b'.repeat(64),
    lockDigest: 'sha256:' + 'd'.repeat(64),
    sbomDigest: 'sha256:' + '1'.repeat(64),
    provenanceDigest: 'sha256:' + '2'.repeat(64),
    policyDigest: 'sha256:' + '3'.repeat(64),
    signatureDigest: 'sha256:' + '4'.repeat(64),
  },
  signatureRefs: ['signature://release/1'],
  attestationRefs: ['sbom://release/1', 'provenance://release/1', 'signature://release/1'],
  dependencyDigests: ['sha256:' + '5'.repeat(64)],
};

const lockPayload = {
  schemaVersion: '1',
  packageId: 'demo-assistant',
  packageVersion: '1.0.0',
  manifest: {
    id: 'demo-assistant',
    version: '1.0.0',
    entry: 'prompts/system.md',
    modelRoute: { provider: 'anthropic', model: 'claude-sonnet-4-5' },
    skillRefs: ['skill://writer/v1'],
    capabilityRefs: ['capability://file-reader/v1'],
    budgets: { maxTokens: 4000, maxToolCalls: 20 },
  },
  assets: [
    { relativePath: 'prompts/system.md', kind: 'prompt', content: '你是演示助手。' },
    { relativePath: 'references/product.md', kind: 'reference', content: '# 产品说明\n演示包。' },
  ],
};

class FakeTaskStore {
  readonly records = new Map<string, TaskPackageInputRecord>();
  async writePackageInput(record: TaskPackageInputRecord): Promise<{ readonly status: 'stored' | 'existing' }> {
    this.records.set(`${record.tenantId}/${record.taskId}`, record);
    return { status: 'stored' };
  }
  async getPackageInput(tenantId: string, taskId: string): Promise<TaskPackageInputRecord | undefined> {
    return this.records.get(`${tenantId}/${taskId}`);
  }
}

class FakeController implements TaskControllerPort {
  readonly created: Array<{ taskId: string; inputRef: string }> = [];
  readonly #result = { workflow: { status: 'running' } } as unknown as TaskQueryResult;
  async create(request: { taskId: string; inputRef: string }): Promise<TaskQueryResult> {
    this.created.push(request);
    return this.#result;
  }
  async query(): Promise<TaskQueryResult> { return this.#result; }
  async signal(): Promise<TaskQueryResult> { return this.#result; }
  async cancel(): Promise<TaskQueryResult> { return this.#result; }
  async retry(): Promise<TaskQueryResult> { return this.#result; }
}

const resolver: PackageReleaseResolver = {
  async resolveRelease(tenantId, releaseId) {
    if (releaseId !== 'a'.repeat(64)) return undefined;
    return { release: releasePayload, lockPayload };
  },
};

async function api(options: { readonly principal?: AuthenticatedPrincipal; readonly specStore?: AgentTaskSpecStorePort; readonly deploymentMode?: 'local' | 'production'; readonly controller?: FakeController; readonly taskStore?: FakeTaskStore } = {}) {
  const app = Fastify({ logger: false, ajv: { customOptions: { removeAdditional: false } } });
  const controller = options.controller ?? new FakeController();
  const taskStore = options.taskStore ?? new FakeTaskStore();
  registerPackageRunsRoutes(app, {
    tenantId: 'tenant-local',
    controller,
    releaseResolver: resolver,
    taskStore,
    specStore: options.specStore ?? new InMemoryAgentTaskSpecStore(),
    authenticator: { authenticateRequest: () => options.principal },
    deploymentMode: options.deploymentMode ?? 'local',
    now: () => new Date('2026-08-17T00:00:00.000Z'),
  } satisfies RegisterPackageRunsRoutesOptions);
  return { app, controller, taskStore };
}

describe('Package run API boundaries', () => {
  it('requires authentication and rejects unknown fields', async () => {
    const { app } = await api({});
    expect((await app.inject({ method: 'POST', url: `/v1/releases/${'a'.repeat(64)}/runs`, payload: { input: 'hi' } })).statusCode).toBe(401);
    const authed = await api({ principal: operator });
    const untrusted = await authed.app.inject({ method: 'POST', url: `/v1/releases/${'a'.repeat(64)}/runs`, payload: { input: 'hi', ownerId: 'leak' } });
    expect(untrusted.statusCode).toBe(400);
    expect(untrusted.json().error.code).toBe('PACKAGE_RUN_UNTRUSTED_FIELD');
    await app.close();
    await authed.app.close();
  });

  it('starts a run from a release and materializes package input', async () => {
    const { app, controller, taskStore } = await api({ principal: operator });
    const response = await app.inject({ method: 'POST', url: `/v1/releases/${'a'.repeat(64)}/runs`, payload: { input: '请介绍产品' } });
    expect(response.statusCode).toBe(202);
    const body = response.json();
    expect(body).toMatchObject({
      schemaVersion: 'PackageRunResult.v1',
      status: 'admitted',
      releaseRef: releasePayload.releaseRef,
      releaseId: releasePayload.releaseId,
    });
    expect(body.taskId).toMatch(/^pkg-/);
    expect(body.inputRef).toBe(`task-input://package/tenant-local/${body.taskId}`);
    expect(controller.created).toHaveLength(1);
    expect(controller.created[0]?.taskId).toBe(body.taskId);
    const stored = await taskStore.getPackageInput('tenant-local', body.taskId);
    expect(stored?.assembledInput).toContain('你是演示助手。');
    expect(stored?.assembledInput).toContain('--- user input ---');
    expect(stored?.assetDigests['references/product.md']).toMatch(/^sha256:[a-f0-9]{64}$/);
    await app.close();
  });

  it('is idempotent for the same release and input', async () => {
    const { app, controller } = await api({ principal: operator });
    const first = await app.inject({ method: 'POST', url: `/v1/releases/${'a'.repeat(64)}/runs`, payload: { input: 'hi', taskId: 'pkg-fixed' } });
    const second = await app.inject({ method: 'POST', url: `/v1/releases/${'a'.repeat(64)}/runs`, payload: { input: 'hi', taskId: 'pkg-fixed' } });
    expect(first.statusCode).toBe(202);
    expect(second.statusCode).toBe(200);
    expect(second.json().status).toBe('existing');
    expect(second.json().taskId).toBe('pkg-fixed');
    expect(controller.created).toHaveLength(1);
    await app.close();
  });

  it('fails closed with 501 in production mode', async () => {
    const { app } = await api({ principal: operator, deploymentMode: 'production' });
    const response = await app.inject({ method: 'POST', url: `/v1/releases/${'a'.repeat(64)}/runs`, payload: { input: 'hi' } });
    expect(response.statusCode).toBe(501);
    expect(response.json().error.code).toBe('PACKAGE_RUN_ADMISSION_NOT_AVAILABLE');
    await app.close();
  });

  it('returns 404 for an unknown release', async () => {
    const { app } = await api({ principal: operator });
    const response = await app.inject({ method: 'POST', url: `/v1/releases/${'f'.repeat(64)}/runs`, payload: { input: 'hi' } });
    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('RELEASE_NOT_FOUND');
    await app.close();
  });
});
