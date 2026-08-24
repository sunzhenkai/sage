import { createServer, type Server } from 'node:http';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { bundleWorkflowCode, NativeConnection, Worker, type WorkerStatus } from '@temporalio/worker';
import { ChatStore } from '@sage/chat-domain';
import { createLivePackageAgentClient, createLocalAgentClient, createLocalKernelComposition, PACKAGE_RUN_SYSTEM_PROMPT, type LiveProviderRoute } from '@sage/local-runtime';
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

export const DEFAULT_MINIMAX_BASE_URL = 'https://api.minimaxi.com/anthropic';
export const DEFAULT_MINIMAX_MODEL = 'MiniMax-M3';

/**
 * 受信进程级 live provider 路由：MINIMAX_API_KEY 非空时启用，未配置返回 undefined（回退本地 echo）。
 * pi-ai 的 anthropic 适配走官方 SDK（baseURL 后拼 /v1/messages），故默认 baseUrl 不带 /v1 后缀。
 * key 只留在进程内存：不得写入日志、事件、spec 或任何存储。
 */
export function readLiveProviderRouteFromEnv(source: Record<string, string | undefined> = process.env): LiveProviderRoute | undefined {
  const apiKey = source.MINIMAX_API_KEY?.trim();
  if (apiKey === undefined || apiKey.length === 0) return undefined;
  return {
    adapterKind: 'anthropic',
    baseUrl: source.MINIMAX_BASE_URL?.trim() || DEFAULT_MINIMAX_BASE_URL,
    modelId: source.MINIMAX_MODEL?.trim() || DEFAULT_MINIMAX_MODEL,
    apiKey
  };
}

export function describeLiveProviderRoute(route: LiveProviderRoute): string {
  return `live provider=anthropic-compatible model=${route.modelId} baseUrl=${route.baseUrl}`;
}

/** 非敏感 provider 模式（/readyz 携带）：live/echo 与模型标识，绝不包含 key。 */
export function providerStatusOf(route: LiveProviderRoute | undefined): { readonly mode: 'echo' } | { readonly mode: 'live'; readonly modelId: string } {
  return route === undefined ? { mode: 'echo' } : { mode: 'live', modelId: route.modelId };
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
    native = await NativeConnection.connect({ address: config.temporalAddress });
    const liveRoute = readLiveProviderRouteFromEnv();
    if (liveRoute !== undefined) process.stdout.write(`agent-worker package runs use ${describeLiveProviderRoute(liveRoute)}\n`);
    else process.stdout.write('WARN: MINIMAX_API_KEY not set — package runs fall back to the local echo harness (settings defaultProvider=auto). Pin minimax in run agent settings to fail closed instead.\n');
    const providerStatus = providerStatusOf(liveRoute);
    worker = await Worker.create({
      connection: native, namespace: TASK_NAMESPACE, taskQueue: TASK_QUEUE, workflowBundle,
      activities: createAgentTaskActivities({
        agentClient: createLocalAgentClient(),
        ...(liveRoute === undefined ? {} : {
          packageAgentClient: createLivePackageAgentClient({ route: liveRoute, systemPrompt: PACKAGE_RUN_SYSTEM_PROMPT })
        }),
        settingsStore: tasks,
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
      if (stopping) return send(json(503, { status: 'not_ready', reason: 'shutting_down', provider: providerStatus }));
      const status = subject.getStatus();
      if (!workerPollersReady(status)) {
        return send(json(503, { status: 'not_ready', worker: { runState: status.runState, workflowPollerState: status.workflowPollerState, activityPollerState: status.activityPollerState }, provider: providerStatus }));
      }
      void Promise.all([chat.getSession(config.tenantId, 'health-sentinel'), tasks.listTaskViews(config.tenantId, { limit: 1 })])
        .then(() => send(json(200, { status: 'ready', namespace: TASK_NAMESPACE, taskQueue: TASK_QUEUE, provider: providerStatus, worker: { runState: status.runState, workflowPollerState: status.workflowPollerState, activityPollerState: status.activityPollerState } })))
        .catch(() => send(json(503, { status: 'not_ready', dependencies: ['postgres'], provider: providerStatus })));
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
