import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { Pool } from 'pg';
import { Connection } from '@temporalio/client';
import type { AuthenticatedPrincipal } from '@sage/app-contracts';
import { ChatStore } from '@sage/chat-domain';
import { InMemoryAgentTaskSpecStore, InMemoryCredentialProvider } from '@sage/local-fakes';
import { InMemoryAgentReleaseStore } from '@sage/agent-release-registry';
import { createLiveProviderAgentClient, createLocalKernelComposition, type LiveProviderRoute, type LiveProviderTurnMessage } from '@sage/local-runtime';
import { createFakeLiveInvoker } from '@sage/harness-pi';
import { LegacyAgentRunSpecV1Adapter, parseAgentExecutionFeatureConfig, runShadowEngine, selectAgentExecutionMode, type AgentExecutionMode, type AgentLifecycleOwner, type LegacyAdapterResult } from '@sage/agent-client';
import { PostgresTaskStore } from '@sage/task-store-postgres';
import { createLocalSecretBackendFromEnv } from '@sage/secret-vault';
import { CatalogServiceError, CatalogSyncManager, ProviderCatalogService, ProviderCatalogStore } from '@sage/provider-catalog';
import { TASK_NAMESPACE, TASK_QUEUE } from '@sage/task-domain';
import { createDevRegistryBundle, publishDevRegistry } from '@sage/temporal-registry';
import { TemporalClientFactory, TrustedMultiTargetTaskController, TrustedTemporalRouter } from '@sage/temporal-routing';
import { ChatPromotionAuthorizer, createChatApi, registerTaskRoutes } from './index.js';
import { startChatKernelExecution, type ChatCanonicalCompatibilityOptions } from './chat-compatibility.js';
import { registerProviderCatalogRoutes } from './catalog-api.js';
import { registerPackagesRoutes } from './packages-api.js';
import { registerAppsRoutes } from './apps-api.js';
import { registerPackageRunsRoutes, type ResolvedReleaseLockPayload } from './runs-api.js';
import { registerRunAgentSettingsRoutes } from './run-agent-settings-api.js';
import { bootstrapDeploymentEnvProviderConnection, registerProviderConnectionRoutes } from './provider-connections-api.js';
import { createRunOutputArtifactResolver } from './run-output-resolver.js';

export interface ApiRuntimeConfig {
  readonly deploymentMode: 'local';
  readonly executionMode: AgentExecutionMode;
  readonly lifecycleOwner: AgentLifecycleOwner;
  readonly executionModeAudit: ReturnType<typeof selectAgentExecutionMode>['audit'];
  readonly tenantId: string;
  readonly postgresUrl: string;
  readonly temporalAddress: string;
  readonly host: string;
  readonly port: number;
  readonly principal: AuthenticatedPrincipal;
  /** 可注入的受信 env 视图（测试用）；缺省读 process.env。 */
  readonly secretEnv?: Record<string, string | undefined>;
}

const env = (name: string, fallback?: string): string => {
  const value = process.env[name] ?? fallback;
  if (!value) throw new Error(`MISSING_RUNTIME_CONFIG:${name}`);
  return value;
};

export function readApiRuntimeConfig(): ApiRuntimeConfig {
  const deploymentMode = process.env.SAGE_DEPLOYMENT_MODE;
  if (deploymentMode !== 'local') throw new Error('LOCAL_RUNTIME_REQUIRES_SAGE_DEPLOYMENT_MODE_LOCAL');
  const tenantId = env('SAGE_TENANT_ID', 'tenant-local');
  const featureConfig = parseAgentExecutionFeatureConfig();
  const modeDecision = selectAgentExecutionMode({ config: featureConfig, tenantId, workload: 'interactive-chat' });
  const executionMode = modeDecision.mode;
  const authenticationId = env('SAGE_LOCAL_AUTHENTICATION_ID', 'local-dev-auth');
  return {
    deploymentMode: 'local', executionMode, lifecycleOwner: modeDecision.lifecycleOwner, executionModeAudit: modeDecision.audit, tenantId,
    postgresUrl: env('SAGE_POSTGRES_URL', 'postgres://sage:sage-local-only@127.0.0.1:15432/sage'),
    temporalAddress: env('SAGE_TEMPORAL_ADDRESS', '127.0.0.1:17233'),
    host: env('SAGE_HTTP_HOST', '0.0.0.0'),
    port: Number(env('SAGE_HTTP_PORT', '9610')),
    principal: {
      authenticationId, principalId: 'local-dev-principal', tenantId,
      roles: ['chat-task-promoter', 'task-operator', 'provider-catalog-admin']
    }
  };
}

function localController(config: ApiRuntimeConfig, tasks: PostgresTaskStore): TemporalClientFactory {
  void config;
  void tasks;
  return new TemporalClientFactory({
    tenantId: config.tenantId,
    credentials: localCredentials(config)
  });
}

function localCredentials(config: ApiRuntimeConfig): InMemoryCredentialProvider {
  const credentials = new InMemoryCredentialProvider();
  credentials.set('secret://temporal/sage-dev-us', new Uint8Array(), {
    scope: 'sage-dev-cluster/sage-dev', tenantId: config.tenantId, environment: 'development', purpose: 'temporal-workflow-client'
  });
  return credentials;
}

function localBundle(config: ApiRuntimeConfig) {
  const source = createDevRegistryBundle(`registry-local-${Date.now()}`);
  const sourceTarget = source.targets.find((target) => target.targetId === 'sage-dev-us');
  if (!sourceTarget) throw new Error('LOCAL_TEMPORAL_TARGET_NOT_FOUND');
  const target = {
    ...sourceTarget,
    endpoint: config.temporalAddress,
    namespace: TASK_NAMESPACE,
    taskQueue: TASK_QUEUE,
    allowedTenantIds: [config.tenantId],
    isolationKey: 'sage-dev-local-namespace-queue'
  };
  return publishDevRegistry({
    ...source,
    targets: [target],
    taskTypes: source.taskTypes.map((taskType) => ({ ...taskType, targetIds: [target.targetId] }))
  });
}

async function temporalReady(address: string): Promise<void> {
  const connection = await Connection.connect({ address });
  await connection.close();
}

async function migrateStores(connectionString: string, chat: ChatStore, tasks: PostgresTaskStore, catalog: ProviderCatalogStore): Promise<void> {
  const pool = new Pool({ connectionString, connectionTimeoutMillis: 2_000 });
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock(845231001)');
    await chat.migrate();
    await tasks.migrate();
    await catalog.migrate();
  } finally {
    await client.query('SELECT pg_advisory_unlock(845231001)').catch(() => undefined);
    client.release();
    await pool.end();
  }
}

export interface ApiRuntime {
  readonly app: FastifyInstance;
  readonly config: ApiRuntimeConfig;
  readonly close: () => Promise<void>;
}

export async function createApiRuntime(config = readApiRuntimeConfig()): Promise<ApiRuntime> {
  // 凭据密封主密钥是必选配置：缺失或非法（非 base64 的 32 字节）直接拒绝启动，不进入无凭据能力的降级运行。
  const secretBackend = createLocalSecretBackendFromEnv(config.secretEnv);
  if (secretBackend === undefined) {
    throw new Error('LOCAL_RUNTIME_REQUIRES_SAGE_SECRET_MASTER_KEY: set SAGE_SECRET_MASTER_KEY to base64 of 32 bytes (e.g. openssl rand -base64 32), shared by agent-api and agent-worker; credential sealing has no plaintext fallback');
  }
  const chat = new ChatStore({ connectionString: config.postgresUrl, connectionTimeoutMillis: 2_000 });
  const tasks = new PostgresTaskStore({ connectionString: config.postgresUrl });
  const catalog = new ProviderCatalogStore({ connectionString: config.postgresUrl, connectionTimeoutMillis: 2_000 });
  const catalogService = new ProviderCatalogService(catalog);
  const catalogManager = new CatalogSyncManager({ store: catalog });
  const temporalClients = localController(config, tasks);
  let app: FastifyInstance | undefined;
  try {
    await migrateStores(config.postgresUrl, chat, tasks, catalog);
    try { await catalogService.listProviders(config.principal, { limit: '1' }); }
    catch (cause) { if (!(cause instanceof CatalogServiceError) || cause.code !== 'CATALOG_UNAVAILABLE') throw cause; }
    await catalogService.startRevisionMonitor();
    const registry = localBundle(config);
    const controller = new TrustedMultiTargetTaskController({
      router: new TrustedTemporalRouter({ registry }), clientFactory: temporalClients,
      routingStore: tasks, projectionStore: tasks, tenantId: config.tenantId,
      actorId: config.principal.principalId, contextId: 'local-api-runtime', environment: 'development',
      region: 'us-east', residency: 'us'
    });
  const kernelComposition = config.executionMode === 'legacy' ? undefined : createLocalKernelComposition();
  const canonicalAdapter = kernelComposition === undefined ? undefined : new LegacyAgentRunSpecV1Adapter({ specs: kernelComposition.specs });
  const canonicalCompatibility: ChatCanonicalCompatibilityOptions | undefined = kernelComposition === undefined || canonicalAdapter === undefined ? undefined : {
    lifecycleOwner: config.lifecycleOwner,
    enabled: config.lifecycleOwner === 'canonical' || config.executionMode === 'shadow',
    mode: config.executionMode === 'shadow' ? 'shadow' : 'kernel',
    adapter: canonicalAdapter,
    trustedContext: (input) => ({
      legacySource: 'chat-v1', adapterBuild: 'local-chat-kernel-v1', tenantId: input.tenantId,
      principalRef: `principal://${config.principal.principalId}`, taskId: `chat-${input.sessionId}`,
      attemptId: `chat-attempt:${input.runId}:${input.attempt}`, invocationId: `chat-invocation:${input.runId}:${input.attempt}`,
      specRef: `spec://chat/${encodeURIComponent(input.runId)}/attempt-${input.attempt}`,
      goalRef: `artifact://chat-input/${encodeURIComponent(input.userMessageId)}`,
      releaseRef: 'release://local/chat-kernel', releaseDigest: `sha256:${'1'.repeat(64)}`, engineId: kernelComposition.engine.engineId,
      allowedSkillRefs: [], allowedCapabilities: ['events'] as const, modelRouteRef: 'model://local/deterministic',
      contextPlanRef: 'context://local/empty', capabilityGrantRef: 'grant://local/events', executionPolicyRef: 'policy://local/bounded',
      boundsRef: 'bounds://local/default', governanceRef: 'governance://local/default', admittedAt: new Date().toISOString()
    }),
    execute: (mapped: Extract<LegacyAdapterResult, { readonly status: 'mapped' }>, context) => startChatKernelExecution({
      client: kernelComposition.kernelClient, eventStore: kernelComposition.events, tenantId: mapped.spec.tenantId,
      ownerToken: `api:${mapped.spec.taskId}`, envelope: mapped.envelope, engine: kernelComposition.engine,
      ...(context?.deadlineAt === undefined ? {} : { deadlineAt: context.deadlineAt }),
      ...(context?.signal === undefined ? {} : { signal: context.signal })
    }),
    shadowExecute: (mapped) => runShadowEngine({ namespace: config.executionModeAudit.shadowNamespace, envelope: mapped.envelope, spec: mapped.spec, engine: kernelComposition.engine })
  };
    const authenticate = (authenticationId?: string): AuthenticatedPrincipal | undefined =>
      authenticationId === undefined || authenticationId === config.principal.authenticationId ? config.principal : undefined;
    // 受信测试开关：显式配置时 chat 的 live client 以进程内确定性 invoker 替换最终模型 HTTP 调用，
    // 设置→注册表解析→harness 路由链路保真；未配置时走真实 provider。
    const fakeLiveProvider = (config.secretEnv ?? process.env).SAGE_FAKE_LIVE_PROVIDER === 'true';
    app = await createChatApi({
      store: chat, tenantId: config.tenantId,
      ...(fakeLiveProvider
        ? { liveClientFactory: (input: { route: LiveProviderRoute; transcript: readonly LiveProviderTurnMessage[] }) =>
            createLiveProviderAgentClient({ route: input.route, transcript: input.transcript, invoker: createFakeLiveInvoker() }) }
        : {}),
      providerConnections: tasks,
      secretBackend,
      ...(canonicalCompatibility === undefined ? {} : { canonicalCompatibility }),
      promotion: {
        controller,
        authenticator: { authenticate, authenticateRequest: () => config.principal },
        authorizer: new ChatPromotionAuthorizer()
      }
    });
    const authenticator = { authenticate, authenticateRequest: () => config.principal };
    registerTaskRoutes(app, controller, {
      tenantId: config.tenantId, authenticator, authorizer: { authorize: (principal, operation) =>
        principal.tenantId === config.tenantId && (operation === 'read' || principal.roles.includes('task-operator')) },
      queryStore: tasks, deploymentMode: 'development',
      artifactResolver: createRunOutputArtifactResolver({ tenantId: config.tenantId, lookup: tasks })
    });
    const packageStore = new InMemoryAgentReleaseStore();
    const packageSpecStore = new InMemoryAgentTaskSpecStore();
    registerPackagesRoutes(app, {
      tenantId: config.tenantId, store: packageStore, ownerNamespace: 'package-platform',
      authenticator, engineIds: ['engine-local'], deploymentMode: 'local'
    });
    registerAppsRoutes(app, {
      tenantId: config.tenantId, store: packageStore, ownerNamespace: 'package-platform',
      authenticator, engineIds: ['engine-local']
    });
    registerPackageRunsRoutes(app, {
      tenantId: config.tenantId,
      controller,
      releaseResolver: {
        async resolveRelease(tenantId, releaseId): Promise<{ readonly release: ReturnType<InMemoryAgentReleaseStore['resolveImmutableRelease']>['release']; readonly lockPayload: ResolvedReleaseLockPayload } | undefined> {
          try {
            const resolution = packageStore.resolveImmutableRelease(tenantId, `release://${releaseId}`);
            const stored = packageStore.getStoredRelease(tenantId, `release://${releaseId}`);
            const lockPayload = stored === undefined ? {} : (stored.lockPayload as ResolvedReleaseLockPayload);
            return { release: resolution.release as ReturnType<InMemoryAgentReleaseStore['resolveImmutableRelease']>['release'], lockPayload };
          } catch {
            return undefined;
          }
        }
      },
      taskStore: tasks,
      specStore: packageSpecStore,
      settingsStore: tasks,
      providerConnections: tasks,
      authenticator,
      deploymentMode: 'local'
    });
    const bootstrapEnv = config.secretEnv ?? process.env;
    try {
      const bootstrap = await bootstrapDeploymentEnvProviderConnection(tasks, secretBackend, bootstrapEnv, config.tenantId);
      if (bootstrap === 'skipped' && (bootstrapEnv.SAGE_BOOTSTRAP_PROVIDER_API_KEY ?? '').trim().length > 0) {
        process.stdout.write('WARN: deployment-env provider bootstrap skipped — SAGE_BOOTSTRAP_PROVIDER_BASE_URL/SAGE_BOOTSTRAP_PROVIDER_MODEL are required (baseUrl must be a public HTTPS URL) alongside SAGE_BOOTSTRAP_PROVIDER_API_KEY\n');
      }
    } catch (cause) {
      process.stdout.write(`WARN: deployment-env provider bootstrap skipped (${cause instanceof Error ? cause.message : 'unknown cause'})\n`);
    }
    registerRunAgentSettingsRoutes(app, { tenantId: config.tenantId, settingsStore: tasks, providerConnections: tasks, authenticator });
    registerProviderConnectionRoutes(app, { tenantId: config.tenantId, store: tasks, secretBackend, authenticator });
    registerProviderCatalogRoutes(app, { service: catalogService, store: catalog, manager: catalogManager, authenticator });
    await catalogManager.start();
    app.get('/livez', async () => ({ status: 'alive' }));
    const secretBackendMode = secretBackend.describe().mode;
    app.get('/readyz', async (_request, reply) => {
      try {
        await Promise.all([
          chat.getSession(config.tenantId, 'health-sentinel'),
          tasks.listTaskViews(config.tenantId, { limit: 1 }),
          temporalReady(config.temporalAddress)
        ]);
        return { status: 'ready', secretBackend: { mode: secretBackendMode }, providerExecution: { mode: fakeLiveProvider ? 'fake' : 'live' } };
      } catch {
        return reply.code(503).send({ status: 'not_ready', dependencies: ['postgres', 'temporal'], secretBackend: { mode: secretBackendMode }, providerExecution: { mode: fakeLiveProvider ? 'fake' : 'live' } });
      }
    });
    const close = async (): Promise<void> => {
      catalogManager.beginShutdown();
      await app?.close();
      await catalogManager.close();
      await catalogService.close();
      await temporalClients.close();
      await Promise.allSettled([chat.close(), tasks.close(), catalog.close()]);
    };
    return { app, config, close };
  } catch (cause) {
    catalogManager.beginShutdown();
    await app?.close().catch(() => undefined);
    await catalogManager.close().catch(() => undefined);
    await catalogService.close().catch(() => undefined);
    await temporalClients.close().catch(() => undefined);
    await Promise.allSettled([chat.close(), tasks.close(), catalog.close()]);
    throw cause;
  }
}

export async function startApiRuntime(): Promise<void> {
  const runtime = await createApiRuntime();
  let closing: Promise<void> | undefined;
  const shutdown = (): void => { closing ??= runtime.close(); void closing.then(() => process.exit(0)); };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  await runtime.app.listen({ host: runtime.config.host, port: runtime.config.port });
  process.stdout.write(`agent-api listening on ${runtime.config.host}:${runtime.config.port}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) void startApiRuntime();
