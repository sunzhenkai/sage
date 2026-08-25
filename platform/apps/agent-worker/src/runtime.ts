import { createServer, type Server } from 'node:http';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { bundleWorkflowCode, NativeConnection, Worker, type WorkerStatus } from '@temporalio/worker';
import { ChatStore } from '@sage/chat-domain';
import { CHAT_SLICE_SYSTEM_PROMPT, createLivePackageAgentClient, createLocalKernelComposition, PACKAGE_RUN_SYSTEM_PROMPT, type LiveProviderRoute } from '@sage/local-runtime';
import { createFakeLiveInvoker, type LiveProviderInvoker } from '@sage/harness-pi';
import { createLocalSecretBackendFromEnv } from '@sage/secret-vault';
import { LegacyAgentRunSpecV1Adapter, parseAgentExecutionFeatureConfig, selectAgentExecutionMode, type AgentExecutionMode, type AgentLifecycleOwner, type LegacyAdapterResult } from '@sage/agent-client';
import { PostgresTaskStore } from '@sage/task-store-postgres';
import { TASK_NAMESPACE, TASK_QUEUE, type TaskInputRef } from '@sage/task-domain';
import { createAgentTaskActivities, type TaskSliceInputResolver } from './activities.js';
import { startTaskKernelExecution, type TaskCanonicalCompatibilityOptions } from './task-compatibility.js';

export interface WorkerRuntimeConfig {
  readonly deploymentMode: 'local';
  readonly executionMode: AgentExecutionMode;
  readonly lifecycleOwner: AgentLifecycleOwner;
  readonly executionModeAudit: ReturnType<typeof selectAgentExecutionMode>['audit'];
  readonly tenantId: string;
  readonly postgresUrl: string;
  readonly temporalAddress: string;
  readonly host: string;
  readonly port: number;
}

const env = (name: string, fallback?: string): string => {
  const value = process.env[name] ?? fallback;
  if (!value) throw new Error(`MISSING_RUNTIME_CONFIG:${name}`);
  return value;
};

export function readWorkerRuntimeConfig(): WorkerRuntimeConfig {
  if (process.env.SAGE_DEPLOYMENT_MODE !== 'local') throw new Error('LOCAL_RUNTIME_REQUIRES_SAGE_DEPLOYMENT_MODE_LOCAL');
  const featureConfig = parseAgentExecutionFeatureConfig();
  const modeDecision = selectAgentExecutionMode({ config: featureConfig, tenantId: env('SAGE_TENANT_ID', 'tenant-local'), workload: 'durable-task' });
  const executionMode = modeDecision.mode;
  return {
    deploymentMode: 'local', executionMode, lifecycleOwner: modeDecision.lifecycleOwner, executionModeAudit: modeDecision.audit, tenantId: env('SAGE_TENANT_ID', 'tenant-local'),
    postgresUrl: env('SAGE_POSTGRES_URL', 'postgres://sage:sage-local-only@127.0.0.1:15432/sage'),
    temporalAddress: env('SAGE_TEMPORAL_ADDRESS', '127.0.0.1:17233'),
    host: env('SAGE_HEALTH_HOST', '0.0.0.0'), port: Number(env('SAGE_HEALTH_PORT', '9611'))
  };
}

async function migrateStores(connectionString: string, chat: ChatStore, tasks: PostgresTaskStore): Promise<void> {
  const pool = new Pool({ connectionString, connectionTimeoutMillis: 2_000 });
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock(845231001)');
    await chat.migrate();
    await tasks.migrate();
  } finally {
    await client.query('SELECT pg_advisory_unlock(845231001)').catch(() => undefined);
    client.release();
    await pool.end();
  }
}

export function workerPollersReady(status: Pick<WorkerStatus, 'runState' | 'workflowPollerState' | 'activityPollerState'>): boolean {
  return status.runState === 'RUNNING' && status.workflowPollerState === 'POLLING' && status.activityPollerState === 'POLLING';
}

export class ChatTaskInputResolver implements TaskSliceInputResolver {
  constructor(private readonly chat: ChatStore) {}

  async resolve(inputRef: TaskInputRef, tenantId: string): Promise<string> {
    const match = /^task-input:\/\/chat\/([^/]+)\/([^/]+)$/.exec(inputRef);
    if (!match) throw new Error('TASK_INPUT_REF_UNSUPPORTED');
    const refTenant = decodeURIComponent(match[1]!);
    const messageId = decodeURIComponent(match[2]!);
    if (refTenant !== tenantId) throw new Error('TASK_INPUT_REF_TENANT_MISMATCH');
    const message = await this.chat.getMessage(tenantId, messageId);
    if (!message || message.role !== 'user') throw new Error('TASK_INPUT_REF_NOT_FOUND');
    return message.parts.map((part) => part.kind === 'text' ? part.text : `[Artifact ${part.artifact.artifactRef}]`).join('\n');
  }
}

/** 包运行输入 resolver：读取物化的 task_package_input 记录，缺行返回稳定错误且不回退其他输入源。 */
export class PackageTaskInputResolver implements TaskSliceInputResolver {
  constructor(private readonly tasks: Pick<PostgresTaskStore, 'getPackageInput'>) {}

  async resolve(inputRef: TaskInputRef, tenantId: string): Promise<string> {
    const match = /^task-input:\/\/package\/([^/]+)\/([^/]+)$/.exec(inputRef);
    if (!match) throw new Error('TASK_INPUT_REF_UNSUPPORTED');
    const refTenant = decodeURIComponent(match[1]!);
    const taskId = decodeURIComponent(match[2]!);
    if (refTenant !== tenantId) throw new Error('TASK_INPUT_REF_TENANT_MISMATCH');
    const record = await this.tasks.getPackageInput(tenantId, taskId);
    if (record === undefined) throw new Error('TASK_PACKAGE_INPUT_NOT_FOUND');
    return record.assembledInput;
  }
}

/** 按 scheme 分发的组合 resolver：chat 路径不动，package 路径新增。 */
export class CompositeTaskInputResolver implements TaskSliceInputResolver {
  constructor(private readonly resolvers: ReadonlyArray<{ readonly scheme: string; readonly resolver: TaskSliceInputResolver }>) {}

  async resolve(inputRef: TaskInputRef, tenantId: string): Promise<string> {
    const scheme = inputRef.match(/^task-input:\/\/([a-z]+)\//)?.[1];
    const entry = scheme === undefined ? undefined : this.resolvers.find((item) => item.scheme === scheme);
    if (entry === undefined) throw new Error('TASK_INPUT_REF_UNSUPPORTED');
    return entry.resolver.resolve(inputRef, tenantId);
  }
}

function json(statusCode: number, body: Record<string, unknown>): { statusCode: number; body: string } {
  return { statusCode, body: JSON.stringify(body) };
}

export interface WorkerRuntime {
  readonly config: WorkerRuntimeConfig;
  readonly worker: Worker;
  readonly server: Server;
  readonly running: Promise<void>;
  readonly close: () => Promise<void>;
}

export async function createWorkerRuntime(config = readWorkerRuntimeConfig()): Promise<WorkerRuntime> {
  // 凭据密封主密钥是必选配置：缺失或非法（非 base64 的 32 字节）直接拒绝启动；执行边界解密没有绕过路径。
  const secretBackend = createLocalSecretBackendFromEnv();
  if (secretBackend === undefined) {
    throw new Error('LOCAL_RUNTIME_REQUIRES_SAGE_SECRET_MASTER_KEY: set SAGE_SECRET_MASTER_KEY to base64 of 32 bytes (e.g. openssl rand -base64 32), shared by agent-api and agent-worker; credential sealing has no plaintext fallback');
  }
  const chat = new ChatStore({ connectionString: config.postgresUrl, connectionTimeoutMillis: 2_000 });
  const tasks = new PostgresTaskStore({ connectionString: config.postgresUrl });
  let native: NativeConnection | undefined;
  let worker: Worker | undefined;
  let running: Promise<void> | undefined;
  let stopping = false;
  try {
    await migrateStores(config.postgresUrl, chat, tasks);
    const workflowBundle = await bundleWorkflowCode({

      workflowsPath: fileURLToPath(new URL('../../../packages/temporal-workflows/src/workflows.ts', import.meta.url))
    });
    const kernelComposition = config.executionMode === 'kernel' ? createLocalKernelComposition() : undefined;
    const canonicalAdapter = kernelComposition === undefined ? undefined : new LegacyAgentRunSpecV1Adapter({ specs: kernelComposition.specs });
    const canonicalCompatibility: TaskCanonicalCompatibilityOptions | undefined = kernelComposition === undefined || canonicalAdapter === undefined ? undefined : {
      lifecycleOwner: config.lifecycleOwner,
      enabled: config.lifecycleOwner === 'canonical',
      adapter: canonicalAdapter,
      trustedContext: (input) => ({
        legacySource: 'task-v1', adapterBuild: 'local-worker-kernel-v1', tenantId: input.tenantId,
        principalRef: 'principal://worker', taskId: input.taskId,
        attemptId: input.identity.attemptId, invocationId: input.identity.invocationId, specRef: input.identity.specRef,
        goalRef: `artifact://task-input/${encodeURIComponent(input.taskId)}`,
        releaseRef: 'release://local/worker-kernel', releaseDigest: `sha256:${'2'.repeat(64)}`, engineId: kernelComposition.engine.engineId,
        allowedSkillRefs: [], allowedCapabilities: ['events'] as const, modelRouteRef: 'model://local/deterministic',
        contextPlanRef: 'context://local/empty', capabilityGrantRef: 'grant://local/events', executionPolicyRef: 'policy://local/bounded',
        boundsRef: 'bounds://local/default', governanceRef: 'governance://local/default', admittedAt: new Date().toISOString()
      }),
      execute: (mapped: Extract<LegacyAdapterResult, { readonly status: 'mapped' }>, context) => startTaskKernelExecution({
        client: kernelComposition.kernelClient, eventStore: kernelComposition.events, tenantId: mapped.spec.tenantId,
        ownerToken: `worker:${mapped.spec.taskId}`, envelope: mapped.envelope, engine: kernelComposition.engine,
        ...(context?.deadlineAt === undefined ? {} : { deadlineAt: context.deadlineAt }),
        ...(context?.signal === undefined ? {} : { signal: context.signal })
      })
    };
    const fakeInvoker: LiveProviderInvoker | undefined = process.env.SAGE_FAKE_LIVE_PROVIDER === 'true' ? createFakeLiveInvoker() : undefined;
    native = await NativeConnection.connect({ address: config.temporalAddress });
    const secretBackendMode = secretBackend.describe().mode;
    worker = await Worker.create({
      connection: native, namespace: TASK_NAMESPACE, taskQueue: TASK_QUEUE, workflowBundle,
      activities: createAgentTaskActivities({
        settingsStore: tasks,
        providerConnections: tasks,
        secretBackend,
        // 受信测试开关由 fakeInvoker 捕获：显式配置时以进程内确定性 invoker 替换最终模型 HTTP 调用，
        // 设置→注册表解析→harness 路由链路保真；未配置时走真实 provider。
        liveClientFactory: (route: LiveProviderRoute, mode: 'package' | 'chat') => createLivePackageAgentClient({
          route,
          systemPrompt: mode === 'package' ? PACKAGE_RUN_SYSTEM_PROMPT : CHAT_SLICE_SYSTEM_PROMPT,
          ...(fakeInvoker === undefined ? {} : { invoker: fakeInvoker })
        }),
        ...(canonicalCompatibility === undefined ? {} : { canonicalCompatibility }),
        store: tasks, outputStore: tasks, inputResolver: new CompositeTaskInputResolver([
          { scheme: 'chat', resolver: new ChatTaskInputResolver(chat) },
          { scheme: 'package', resolver: new PackageTaskInputResolver(tasks) }
        ])
      }),
      buildId: env('SAGE_WORKER_BUILD_ID', 'sage-local-worker-v1')
    });
    const subject = worker;
    const server = createServer((request, response) => {
      const path = new URL(request.url ?? '/', 'http://localhost').pathname;
      const send = (result: { statusCode: number; body: string }): void => {
        response.statusCode = result.statusCode;
        response.setHeader('content-type', 'application/json; charset=utf-8');
        response.end(result.body);
      };
      if (path === '/livez') return send(json(stopping ? 503 : 200, { status: stopping ? 'stopping' : 'alive' }));
      if (path !== '/readyz') { response.statusCode = 404; response.end(); return; }
      const providerExecution = { mode: fakeInvoker === undefined ? 'live' : 'fake' };
      if (stopping) return send(json(503, { status: 'not_ready', reason: 'shutting_down', secretBackend: { mode: secretBackendMode }, providerExecution }));
      const status = subject.getStatus();
      if (!workerPollersReady(status)) {
        return send(json(503, { status: 'not_ready', worker: { runState: status.runState, workflowPollerState: status.workflowPollerState, activityPollerState: status.activityPollerState }, secretBackend: { mode: secretBackendMode }, providerExecution }));
      }
      void Promise.all([chat.getSession(config.tenantId, 'health-sentinel'), tasks.listTaskViews(config.tenantId, { limit: 1 })])
        .then(() => send(json(200, { status: 'ready', namespace: TASK_NAMESPACE, taskQueue: TASK_QUEUE, secretBackend: { mode: secretBackendMode }, providerExecution, worker: { runState: status.runState, workflowPollerState: status.workflowPollerState, activityPollerState: status.activityPollerState } })))
        .catch(() => send(json(503, { status: 'not_ready', dependencies: ['postgres'], secretBackend: { mode: secretBackendMode } })));
    });
    const runningPromise = subject.run();
    running = runningPromise;
    const close = async (): Promise<void> => {
      if (stopping) return;
      stopping = true;
      await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
      subject.shutdown();
      await running?.catch(() => undefined);
      await Promise.allSettled([chat.close(), tasks.close()]);
      await native?.close();
    };
    return { config, worker: subject, server, running: runningPromise, close };
  } catch (cause) {
    worker?.shutdown();
    await running?.catch(() => undefined);
    await Promise.allSettled([chat.close(), tasks.close()]);
    await native?.close();
    throw cause;
  }
}

export async function startWorkerRuntime(): Promise<void> {
  const runtime = await createWorkerRuntime();
  let closing: Promise<void> | undefined;
  const shutdown = (): void => { closing ??= runtime.close(); void closing.then(() => process.exit(0)); };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  await new Promise<void>((resolveListen, reject) => {
    runtime.server.once('error', reject);
    runtime.server.listen(runtime.config.port, runtime.config.host, () => resolveListen());
  });
  runtime.running.catch((cause) => { process.stderr.write(`agent-worker stopped: ${cause instanceof Error ? cause.message : String(cause)}\n`); shutdown(); });
  process.stdout.write(`agent-worker health listening on ${runtime.config.host}:${runtime.config.port}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) void startWorkerRuntime();
