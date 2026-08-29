import { bundleWorkflowCode, NativeConnection, Worker, type WorkerStatus } from '@temporalio/worker';
import { WorkflowClient } from '@temporalio/client';
import { PostgresAgentAuthorityStore, PostgresConsumptionLedger, PostgresScheduleStore } from '@sage/agent-state-postgres';
import type { AgentTaskSpecStorePort } from '@sage/platform-ports';
import { TASK_NAMESPACE, TASK_QUEUE, TASK_TARGET, TASK_TYPE } from '@sage/task-domain';
import { buildSnapshotEgressConnector } from '@sage/tool-runtime';
import { SCHEDULE_DISPATCHER_TASK_QUEUE } from '@sage/temporal-schedules';
import { createScheduleDispatcherActivities, type DispatcherReleaseResolution, type DispatcherReleaseResolver } from './schedule-activities.js';
import type { PostgresTaskStore } from '@sage/task-store-postgres';

/**
 * P8 dispatcher worker：轮询 `sage-schedule-dispatcher-v1` 队列执行 ScheduleTriggerDispatcher.v1。
 * 控制面数据（schedule 记录/触发事件/账本/spec）与 API 共享 Postgres 权威；
 * Release 解析经 API 内部端点（service token），保持 registry 单一写入方。
 */

export interface ScheduleDispatcherConfig {
  readonly enabled: boolean;
  readonly tenantId: string;
  readonly postgresUrl: string;
  readonly temporalAddress: string;
  readonly apiBaseUrl: string;
  readonly serviceToken?: string;
  readonly egressAllowlist?: string;
  readonly buildId: string;
}

export const readScheduleDispatcherConfig = (environment: Readonly<Record<string, string | undefined>>, fallback: { readonly tenantId: string; readonly postgresUrl: string; readonly temporalAddress: string }): ScheduleDispatcherConfig => ({
  enabled: environment.SAGE_SCHEDULE_DISPATCH_ENABLED === '1',
  tenantId: environment.SAGE_TENANT_ID ?? fallback.tenantId,
  postgresUrl: environment.SAGE_POSTGRES_URL ?? fallback.postgresUrl,
  temporalAddress: environment.SAGE_TEMPORAL_ADDRESS ?? fallback.temporalAddress,
  apiBaseUrl: environment.SAGE_API_BASE_URL ?? 'http://127.0.0.1:9610',
  ...(environment.SAGE_SERVICE_TOKEN === undefined || environment.SAGE_SERVICE_TOKEN === '' ? {} : { serviceToken: environment.SAGE_SERVICE_TOKEN }),
  ...(environment.SAGE_PACKAGE_SNAPSHOT_EGRESS_ALLOWLIST === undefined ? {} : { egressAllowlist: environment.SAGE_PACKAGE_SNAPSHOT_EGRESS_ALLOWLIST }),
  buildId: environment.SAGE_SCHEDULE_DISPATCHER_BUILD_ID ?? 'sage-schedule-dispatcher-v1'
});

const httpReleaseResolver = (config: ScheduleDispatcherConfig): DispatcherReleaseResolver => {
  const resolve = async (tenantId: string, releaseId: string, follow: boolean): Promise<DispatcherReleaseResolution | undefined> => {
    const response = await fetch(`${config.apiBaseUrl}/internal/schedule-dispatch/releases/${encodeURIComponent(releaseId)}${follow ? '?follow=1' : ''}`, {
      headers: { ...(config.serviceToken === undefined ? {} : { authorization: `Bearer ${config.serviceToken}` }) },
      signal: AbortSignal.timeout(10_000)
    });
    if (response.status === 404) return undefined;
    if (!response.ok) throw new Error(`SCHEDULE_RELEASE_UNRESOLVABLE: dispatch resolver HTTP ${response.status}`);
    return await response.json() as DispatcherReleaseResolution;
  };
  return {
    resolveRelease: (tenantId, releaseId) => resolve(tenantId, releaseId, false),
    resolveFollowRelease: (tenantId, anchorReleaseId) => resolve(tenantId, anchorReleaseId, true)
  };
};

export interface ScheduleDispatcherRuntime {
  readonly worker: Worker;
  readonly ready: (status: WorkerStatus) => boolean;
  readonly shutdown: () => void;
}

export async function createScheduleDispatcher(config: ScheduleDispatcherConfig, tasks: PostgresTaskStore, native: NativeConnection): Promise<ScheduleDispatcherRuntime> {
  const scheduleStore = new PostgresScheduleStore({ connectionString: config.postgresUrl });
  const ledger = new PostgresConsumptionLedger({ connectionString: config.postgresUrl });
  const specStore: AgentTaskSpecStorePort = new PostgresAgentAuthorityStore({ connectionString: config.postgresUrl });
  const workflowBundle = await bundleWorkflowCode({
    workflowsPath: new URL('../../../packages/temporal-schedules/src/workflows.ts', import.meta.url).pathname
  });
  const workflowClient = new WorkflowClient({ connection: native, namespace: TASK_NAMESPACE });
  const activities = createScheduleDispatcherActivities({
    scheduleStore,
    ledger,
    releaseResolver: httpReleaseResolver(config),
    ...(config.egressAllowlist === undefined ? {} : { snapshotConnector: buildSnapshotEgressConnector(config.egressAllowlist) }),
    specStore,
    idempotencyStore: {
      // 进程内 admission 幂等：durable 层由确定性 taskId（occurrence 键 + 固化输入哈希）与
      // spec store create-only / task store 唯一约束承载（D3 三层幂等的第二、三层）。
      async get() { return undefined; },
      async putIfAbsent(input) { return { status: 'created' as const, record: input.record }; },
      async putTerminal(input) { return { status: 'stored' as const, record: input.record }; }
    },
    auditOutbox: { async append(input) { process.stdout.write(`[schedule-admission-audit] ${JSON.stringify(input.record)}\n`); return 'stored' as const; } },
    writePackageInput: async (record) => { await tasks.writePackageInput(record as never); },
    startRun: async ({ taskId, inputRef }) => {
      // 与 temporal-routing 的 workflowIdFor 同构（worker 不依赖控制面路由包）。
      const workflowId = `${config.tenantId}:${taskId}`;
      const input = {
        schemaVersion: '1' as const, taskType: TASK_TYPE, taskId, tenantId: config.tenantId,
        workflowId, targetId: TASK_TARGET, inputRef, attempt: 1
      };
      await workflowClient.start('AgentTaskWorkflow', { workflowId, taskQueue: TASK_QUEUE, args: [input] });
    },
    now: () => new Date()
  });
  const worker = await Worker.create({
    connection: native,
    namespace: TASK_NAMESPACE,
    taskQueue: SCHEDULE_DISPATCHER_TASK_QUEUE,
    workflowBundle,
    activities,
    buildId: config.buildId
  });
  return {
    worker,
    ready: (status) => status.runState === 'RUNNING' && status.workflowPollerState === 'POLLING' && status.activityPollerState === 'POLLING',
    shutdown: () => worker.shutdown()
  };
}
