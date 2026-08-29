import { Connection, Client, ScheduleAlreadyRunning, ScheduleNotFoundError, type ScheduleClient, type ScheduleHandle, type ScheduleOptions } from '@temporalio/client';
import { assertScheduleDefinition, scheduleDefinitionDigest, type AdapterHealth, type ScheduleDefinition, type ScheduleError, type ScheduleErrorCode, type SchedulePort, type ScheduleRef, type ScheduleSnapshot } from '@sage/platform-ports';
import { SCHEDULE_DISPATCHER_TASK_QUEUE, SCHEDULE_TRIGGER_DISPATCHER_WORKFLOW_TYPE } from './workflows.js';

export class TemporalScheduleAdapterError extends Error implements ScheduleError {
  readonly retryable: boolean;
  constructor(readonly code: ScheduleErrorCode, readonly safeMessage: string, retryable = false) {
    super(`${code}: ${safeMessage}`);
    this.name = 'TemporalScheduleAdapterError';
    this.retryable = retryable;
  }
}

const facilityId = (ref: ScheduleRef): string => `sage-schedule:${ref.tenantId}:${ref.scheduleId}`;

const overlapMap = { SKIP: 'SKIP', ALLOW: 'ALLOW_ALL', BUFFER_ONE: 'BUFFER_ONE' } as const;

/** misfire SKIP → 不补偿（零补抓窗口）；CATCH_UP_ONE → 允许补抓一个错过的执行。 */
const catchupWindowMs = (definition: ScheduleDefinition): number => definition.misfirePolicy === 'SKIP' ? 0 : 60_000;

interface DispatcherArgs {
  readonly schemaVersion: '1';
  readonly tenantId: string;
  readonly scheduleId: string;
  readonly definitionDigest: string;
  readonly definition: ScheduleDefinition;
  readonly revision: number;
}

const mapFacilityError = (cause: unknown, ref: ScheduleRef): TemporalScheduleAdapterError => {
  if (cause instanceof TemporalScheduleAdapterError) return cause;
  if (cause instanceof ScheduleAlreadyRunning) return new TemporalScheduleAdapterError('SCHEDULE_ALREADY_EXISTS', `schedule ${ref.scheduleId} already exists`);
  if (cause instanceof ScheduleNotFoundError) return new TemporalScheduleAdapterError('SCHEDULE_NOT_FOUND', `schedule ${ref.scheduleId} not found`);
  if (cause instanceof Error && /NOT_FOUND/i.test(cause.message)) return new TemporalScheduleAdapterError('SCHEDULE_NOT_FOUND', `schedule ${ref.scheduleId} not found`);
  return new TemporalScheduleAdapterError('SCHEDULE_UNAVAILABLE', cause instanceof Error ? cause.message.slice(0, 512) : 'schedule facility unavailable', true);
};

/**
 * Temporal Schedules adapter（D2）：SchedulePort 的当前设施实现，与 durable coordinator adapter
 * 同一隔离纪律——canonical 契约不出现任何设施类型。revision 权威在控制面存储；本 adapter 把
 * 控制面 revision 镜像进 dispatcher args，describe 返回的快照仅为设施侧真相镜像。
 */
export class TemporalScheduleAdapter implements SchedulePort {
  readonly #schedules: ScheduleClient;
  readonly #taskQueue: string;
  readonly #workflowType: string;

  constructor(options: { readonly client: Client; readonly taskQueue?: string; readonly workflowType?: string }) {
    this.#schedules = options.client.schedule;
    this.#taskQueue = options.taskQueue ?? SCHEDULE_DISPATCHER_TASK_QUEUE;
    this.#workflowType = options.workflowType ?? SCHEDULE_TRIGGER_DISPATCHER_WORKFLOW_TYPE;
  }

  static async connect(options: { readonly address: string; readonly namespace: string; readonly taskQueue?: string; readonly workflowType?: string }): Promise<TemporalScheduleAdapter> {
    const connection = await Connection.connect({ address: options.address });
    const client = new Client({ connection, namespace: options.namespace });
    return new TemporalScheduleAdapter({ client, ...(options.taskQueue === undefined ? {} : { taskQueue: options.taskQueue }), ...(options.workflowType === undefined ? {} : { workflowType: options.workflowType }) });
  }

  async create(definition: ScheduleDefinition): Promise<ScheduleSnapshot> {
    assertScheduleDefinition(definition);
    const ref = { tenantId: definition.tenantId, scheduleId: definition.scheduleId };
    try {
      await this.#schedules.create(this.#options(definition, 1));
    } catch (cause) {
      throw mapFacilityError(cause, ref);
    }
    const nowMs = Date.now();
    return { schemaVersion: '1', definition, revision: 1, state: 'ACTIVE', contentDigest: scheduleDefinitionDigest(definition), createdAtMs: nowMs, updatedAtMs: nowMs };
  }

  async update(definition: ScheduleDefinition, expectedRevision: number): Promise<ScheduleSnapshot> {
    assertScheduleDefinition(definition);
    const ref = { tenantId: definition.tenantId, scheduleId: definition.scheduleId };
    try {
      await this.#handle(ref).update(previous => ({
        ...previous,
        spec: this.#spec(definition),
        policies: { overlap: overlapMap[definition.overlapPolicy], catchupWindow: catchupWindowMs(definition), pauseOnFailure: false },
        action: { ...previous.action, args: [this.#args(definition, expectedRevision + 1)] }
      }));
    } catch (cause) {
      throw mapFacilityError(cause, ref);
    }
    return { schemaVersion: '1', definition, revision: expectedRevision + 1, state: 'ACTIVE', contentDigest: scheduleDefinitionDigest(definition), createdAtMs: Date.now(), updatedAtMs: Date.now() };
  }

  async pause(ref: ScheduleRef): Promise<ScheduleSnapshot> {
    try {
      await this.#handle(ref).pause(`paused by schedule control plane: ${ref.tenantId}/${ref.scheduleId}`);
      return await this.#snapshotFromFacility(ref);
    } catch (cause) {
      throw mapFacilityError(cause, ref);
    }
  }

  async resume(ref: ScheduleRef): Promise<ScheduleSnapshot> {
    try {
      await this.#handle(ref).unpause(`resumed by schedule control plane: ${ref.tenantId}/${ref.scheduleId}`);
      return await this.#snapshotFromFacility(ref);
    } catch (cause) {
      throw mapFacilityError(cause, ref);
    }
  }

  async remove(ref: ScheduleRef): Promise<void> {
    try {
      await this.#handle(ref).delete();
    } catch (cause) {
      const mapped = mapFacilityError(cause, ref);
      // 幂等删除：设施侧已不存在视为成功，与控制面终态一致。
      if (mapped.code !== 'SCHEDULE_NOT_FOUND') throw mapped;
    }
  }

  async describe(ref: ScheduleRef): Promise<ScheduleSnapshot | undefined> {
    try {
      return await this.#snapshotFromFacility(ref);
    } catch (cause) {
      const mapped = mapFacilityError(cause, ref);
      if (mapped.code === 'SCHEDULE_NOT_FOUND') return undefined;
      throw mapped;
    }
  }

  /** 设施侧下次触发时间（UI next fire 展示）；不存在时返回 undefined。 */
  async nextFireAtMs(ref: ScheduleRef): Promise<number | undefined> {
    try {
      const description = await this.#handle(ref).describe();
      return description.state.paused ? undefined : description.info.nextActionTimes[0]?.getTime();
    } catch (cause) {
      const mapped = mapFacilityError(cause, ref);
      if (mapped.code === 'SCHEDULE_NOT_FOUND') return undefined;
      throw mapped;
    }
  }

  async health(): Promise<AdapterHealth> {
    try {
      // 轻量设施探活：列出至多一个 schedule，验证服务端可达与权限。
      for await (const _ of this.#schedules.list({ pageSize: 1 })) break;
      return { healthy: true, checkedAt: new Date().toISOString() };
    } catch (cause) {
      return { healthy: false, checkedAt: new Date().toISOString(), detail: cause instanceof Error ? cause.message.slice(0, 256) : 'SCHEDULE_FACILITY_UNAVAILABLE' };
    }
  }

  #handle(ref: ScheduleRef): ScheduleHandle {
    return this.#schedules.getHandle(facilityId(ref));
  }

  #args(definition: ScheduleDefinition, revision: number): DispatcherArgs {
    return { schemaVersion: '1', tenantId: definition.tenantId, scheduleId: definition.scheduleId, definitionDigest: scheduleDefinitionDigest(definition), definition, revision };
  }

  #options(definition: ScheduleDefinition, revision: number): ScheduleOptions {
    return {
      scheduleId: facilityId({ tenantId: definition.tenantId, scheduleId: definition.scheduleId }),
      spec: this.#spec(definition),
      action: {
        type: 'startWorkflow',
        workflowType: this.#workflowType,
        taskQueue: this.#taskQueue,
        workflowId: `schedule:${definition.scheduleId}`,
        args: [this.#args(definition, revision)],
        retry: { initialInterval: '1 second', backoffCoefficient: 2, maximumInterval: '30 seconds', maximumAttempts: 3 }
      },
      policies: { overlap: overlapMap[definition.overlapPolicy], catchupWindow: catchupWindowMs(definition), pauseOnFailure: false },
      state: { paused: false }
    };
  }

  #spec(definition: ScheduleDefinition): ScheduleOptions['spec'] {
    if (definition.trigger.kind === 'cron') {
      // Temporal cron 表达式为 6-7 段（含秒）；canonical 为 5 段，补秒位并固定为整分触发。
      return { cronExpressions: [`0 ${definition.trigger.expression}`], timezone: definition.trigger.timezone };
    }
    return { intervals: [{ every: definition.trigger.everyMs, offset: 0 }] };
  }

  async #snapshotFromFacility(ref: ScheduleRef): Promise<ScheduleSnapshot> {
    const description = await this.#handle(ref).describe();
    const args = description.action.args ?? [];
    const payload = args[0] as DispatcherArgs | undefined;
    if (payload === undefined || typeof payload !== 'object' || payload.definition === undefined) {
      throw new TemporalScheduleAdapterError('SCHEDULE_UNAVAILABLE', `schedule ${ref.scheduleId} facility action missing canonical definition`, true);
    }
    const definition = payload.definition;
    assertScheduleDefinition(definition);
    const createdAtMs = Number.isFinite(description.info.createdAt?.getTime()) ? description.info.createdAt.getTime() : Date.now();
    const updatedAtMs = description.info.lastUpdatedAt && Number.isFinite(description.info.lastUpdatedAt.getTime()) ? description.info.lastUpdatedAt.getTime() : createdAtMs;
    return {
      schemaVersion: '1', definition,
      revision: Number.isInteger(payload.revision) && payload.revision >= 1 ? payload.revision : 1,
      state: description.state.paused ? 'PAUSED' : 'ACTIVE',
      contentDigest: scheduleDefinitionDigest(definition),
      createdAtMs, updatedAtMs
    };
  }
}
