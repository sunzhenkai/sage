import { fileURLToPath } from 'node:url';
import { bundleWorkflowCode, NativeConnection, Worker } from '@temporalio/worker';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { HarnessCapabilities, HarnessPort, HarnessTurnRequest, HarnessTurnResult } from '@sage/agent-contracts';
import { LocalAgentClient } from '@sage/agent-client';
import { createAgentTaskActivities, PackageTaskInputResolver } from '@sage/agent-worker';
import { registerPackagesRoutes } from '@sage/agent-api';
import { registerPackageRunsRoutes, type ResolvedReleaseLockPayload } from '@sage/agent-api';
import { InMemoryAgentTaskSpecStore } from '@sage/local-fakes';
import { InMemoryAgentReleaseStore } from '@sage/agent-release-registry';
import type { CredentialProvider } from '@sage/platform-ports';
import { PostgresTaskStore } from '@sage/task-store-postgres';
import { LocalAesGcmSecretBackend } from '@sage/secret-vault';
import { randomBytes } from 'node:crypto';
import { createDevRegistryBundle, publishDevRegistry } from '@sage/temporal-registry';
import { DefaultTemporalClientConnector, TemporalClientFactory, TrustedMultiTargetTaskController, TrustedTemporalRouter } from '@sage/temporal-routing';
import Fastify from 'fastify';

const databaseUrl = process.env.P6_POSTGRES_URL;
const temporalAddress = process.env.SAGE_TEMPORAL_ADDRESS;
const integration = describe.skipIf(!databaseUrl);
const tenantId = 'tenant-pkg-e2e';
const workflowsPath = fileURLToPath(new URL('../../../packages/temporal-workflows/src/workflows.ts', import.meta.url));

class PackageE2EHarness implements HarnessPort {
  readonly capabilities: HarnessCapabilities = { harness: 'pkg-e2e', version: '1', supported: ['events', 'checkpoint'] };
  readonly effects: string[] = [];
  async executeTurn(request: HarnessTurnRequest): Promise<HarnessTurnResult> {
    this.effects.push(request.input);
    return { output: `package:${request.input}`, done: true, toolCalls: 0, tokens: 1, checkpointRef: `checkpoint://pkg/${request.runId}` };
  }
}

const credentials: CredentialProvider = {
  async resolveCredential(request) { return { value: new Uint8Array(), expiresAt: '2099-01-01T00:00:00.000Z', scope: request.scope }; },
  async health() { return { healthy: true, checkedAt: new Date().toISOString() }; },
};

const validFiles = {
  'app.yaml': [
    "schemaVersion: '1'",
    'id: e2e-assistant',
    'version: 1.0.0',
    'description: 端到端测试 ai app',
    'entry: prompts/system.md',
    'modelRoute:',
    '  provider: anthropic',
    '  model: claude-sonnet-4-5',
    'budgets:',
    '  maxTokens: 4000',
    '  maxToolCalls: 20',
    'skillRefs:',
    '  - skill://writer/v1',
    '',
  ].join('\n'),
  'prompts/system.md': '# e2e-assistant\n你是端到端测试助手。\n',
  'references/product.md': '# 产品说明\n端到端测试参考资产。\n',
};

let tasks: PostgresTaskStore;
let admin: Pool;
let native: NativeConnection;
let bundle: Awaited<ReturnType<typeof bundleWorkflowCode>>;
const secretBackend = new LocalAesGcmSecretBackend([randomBytes(32)]);

/** seed 工作区 provider + 运行 agent 设置：包运行准入与执行均硬要求 provider（无本地兜底路径）。 */
async function seedProvider() {
  const sealed = secretBackend.seal('pkg-e2e-provider-key');
  await tasks.createProviderConnection(tenantId, 'conn-pkg-e2e', {
    name: 'pkg-e2e provider', source: 'user', adapterKind: 'anthropic',
    baseUrl: 'https://api.minimaxi.com/anthropic', modelId: 'MiniMax-M3', enabled: true,
    updatedBy: 'principal://pkg-e2e',
    credential: { ciphertext: sealed.ciphertext, keyVersion: sealed.keyVersion, updatedAt: '2026-08-25T00:00:00.000Z' }
  }, '2026-08-25T00:00:00.000Z');
  await tasks.upsertRunAgentSettings({ tenantId, providerConnectionId: 'conn-pkg-e2e', updatedAt: '2026-08-25T00:00:00.000Z', updatedBy: 'principal://pkg-e2e' });
}

function registry(address: string) {
  const value = createDevRegistryBundle('registry-pkg-e2e');
  value.targets = value.targets.map((target) => ({
    ...target,
    endpoint: target.targetId === 'sage-dev-us' ? address : target.endpoint,
    allowedTenantIds: [...target.allowedTenantIds, tenantId],
  }));
  return publishDevRegistry(value);
}

beforeAll(async () => {
  if (!databaseUrl) return;
  if (!temporalAddress) throw new Error('SAGE_TEMPORAL_ADDRESS_REQUIRED');
  bundle = await bundleWorkflowCode({ workflowsPath });
  native = await NativeConnection.connect({ address: temporalAddress });
  tasks = new PostgresTaskStore({ connectionString: databaseUrl });
  admin = new Pool({ connectionString: databaseUrl });
  await tasks.migrate();
}, 60_000);

afterAll(async () => {
  if (!databaseUrl) return;
  if (tasks) await tasks.close();
  if (admin) await admin.end();
  if (native) await native.close();
});

integration.sequential('Package run e2e acceptance', () => {
  it('registers a package, starts a run, and the workflow succeeds with a queryable projection', async () => {
    const harness = new PackageE2EHarness();
    await seedProvider();
    const worker = await Worker.create({
      connection: native,
      namespace: 'sage-dev',
      taskQueue: 'sage-agent-task-us-v1',
      workflowBundle: bundle,
      activities: createAgentTaskActivities({
        liveClientFactory: () => new LocalAgentClient({ harness }),
        settingsStore: tasks,
        providerConnections: tasks,
        secretBackend,
        store: tasks,
        inputResolver: new PackageTaskInputResolver(tasks),
      }),
      buildId: 'sage-pkg-e2e-worker-v1',
    });
    const running = worker.run();

    const factory = new TemporalClientFactory({ credentials, connector: new DefaultTemporalClientConnector(), tenantId });
    const controller = new TrustedMultiTargetTaskController({
      router: new TrustedTemporalRouter({ registry: registry(temporalAddress!) }),
      clientFactory: factory,
      routingStore: tasks,
      projectionStore: tasks,
      tenantId,
      actorId: 'pkg-e2e-api',
      contextId: 'pkg-e2e',
      environment: 'development',
      region: 'us-east',
      residency: 'us',
      projectionFreshnessThresholdMs: 1000,
    });

    const packageStore = new InMemoryAgentReleaseStore();
    const specStore = new InMemoryAgentTaskSpecStore();
    const app = Fastify({ logger: false, ajv: { customOptions: { removeAdditional: false } } });
    const principal = { authenticationId: 'auth-pkg', principalId: 'pkg-user', tenantId, roles: ['package-registrar', 'task-operator'] };
    const authenticator = { authenticateRequest: () => principal };
    registerPackagesRoutes(app, {
      tenantId, store: packageStore, ownerNamespace: 'package-platform', authenticator, engineIds: ['engine-local'], deploymentMode: 'local',
    });
    registerPackageRunsRoutes(app, {
      tenantId,
      controller,
      releaseResolver: {
        async resolveRelease(refTenantId: string, releaseId: string) {
          try {
            const resolution = packageStore.resolveImmutableRelease(refTenantId, `release://${releaseId}`);
            const stored = packageStore.getStoredRelease(refTenantId, `release://${releaseId}`);
            const lockPayload: ResolvedReleaseLockPayload = stored === undefined
              ? {}
              : (stored.lockPayload as unknown as ResolvedReleaseLockPayload);
            return { release: resolution.release, lockPayload };
          } catch {
            return undefined;
          }
        },
      },
      taskStore: tasks,
      specStore,
      settingsStore: tasks,
      providerConnections: tasks,
      authenticator,
      deploymentMode: 'local',
    });

    try {
      const registered = await app.inject({ method: 'POST', url: '/v1/packages/e2e-assistant/releases', payload: { files: validFiles } });
      expect(registered.statusCode).toBe(201);
      const releaseId = registered.json().releaseId as string;

      const started = await app.inject({ method: 'POST', url: `/v1/releases/${releaseId}/runs`, payload: { input: '运行一次端到端测试' } });
      expect(started.statusCode).toBe(202);
      const body = started.json();
      expect(body.status).toBe('admitted');
      expect(body.taskId).toMatch(/^pkg-/);

      const resolvedInput = await tasks.getPackageInput(tenantId, body.taskId);
      expect(resolvedInput?.assembledInput).toContain('运行一次端到端测试');

      // 等待 workflow 完成。
      const routing = await tasks.getTaskRouting(tenantId, body.taskId);
      expect(routing?.workflowId).toBeTruthy();
      const client = await factory.forSnapshot(routing!.snapshot);
      const final = await client.getHandle(routing!.workflowId).result();
      expect(final).toMatchObject({ status: 'succeeded' });

      // 幂等重投返回既有结果。
      const replay = await app.inject({ method: 'POST', url: `/v1/releases/${releaseId}/runs`, payload: { input: '运行一次端到端测试', taskId: body.taskId } });
      expect(replay.statusCode).toBe(200);
      expect(replay.json().status).toBe('existing');

      // projection 可查。
      const projection = await tasks.getProjection(tenantId, body.taskId);
      expect(projection?.status).toBe('succeeded');
      if (resolvedInput !== undefined) expect(harness.effects).toContain(resolvedInput.assembledInput);
    } finally {
      await app.close();
      worker.shutdown();
      await running.catch(() => undefined);
      await factory.close();
    }
  }, 90_000);
});
