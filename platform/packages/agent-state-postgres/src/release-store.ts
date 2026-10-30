import { Pool, type PoolConfig, type QueryResultRow } from 'pg';
import {
  InMemoryAgentReleaseStore,
  type AgentApp,
  type CreateAppRequest,
  type PublishAppReleaseInput,
  type PutAppDraftInput,
  type PutAppDraftResult,
  type ReleaseChannelPointer,
  type ReleasePublicationVerificationInput,
  type ReleaseSubmitRequest,
  type ReleaseSubmitResult,
  type UpdateAppMetadataInput,
  type UpdateAppMetadataResult
} from '@sage/agent-release-registry';
import type { AdapterHealth, AgentTaskSpecStorePort } from '@sage/platform-ports';

/** 会改变状态的 AgentReleaseStore 方法；读方法不入日志。 */
export type ReleaseStoreOperation =
  | 'submit' | 'publish' | 'rollback' | 'createApp' | 'softDeleteApp'
  | 'putAppDraft' | 'updateAppMetadata' | 'publishAppRelease';

interface JournalRow extends QueryResultRow { seq: string; operation: ReleaseStoreOperation; args: unknown[]; clock: string[] }
interface AppRow extends QueryResultRow {
  tenant_id: string; app_id: string; owner_namespace: string; name: string | null; description: string | null;
  status: string; draft: { files?: unknown } | null
}

interface PendingEntry { readonly operation: ReleaseStoreOperation; readonly args: readonly unknown[]; readonly clock: readonly string[]; readonly tenantId: string | undefined; readonly appIds: readonly string[] }

export interface PostgresAgentReleaseStoreOptions {
  readonly now?: () => Date;
  /** 启动时把 agent_apps 中存在、但日志里没有的历史行导入为真实 App（不删除原行）。默认 true。 */
  readonly importLegacyApps?: boolean;
  readonly log?: (message: string) => void;
}

const appIdOf = (operation: ReleaseStoreOperation, args: readonly unknown[]): string | undefined => {
  const first = args[0] as Record<string, unknown> | undefined;
  if (operation === 'softDeleteApp') return typeof args[1] === 'string' ? args[1] : undefined;
  if (operation === 'submit' || operation === 'publish' || operation === 'rollback') return typeof first?.packageId === 'string' ? first.packageId : undefined;
  return typeof first?.appId === 'string' ? first.appId : undefined;
};
const tenantOf = (args: readonly unknown[]): string | undefined => {
  const first = args[0];
  if (typeof first === 'string') return first;
  const tenantId = (first as Record<string, unknown> | undefined)?.tenantId;
  return typeof tenantId === 'string' ? tenantId : undefined;
};

/**
 * PostgreSQL 持久化的 AgentReleaseStore。
 *
 * 语义完全复用 InMemoryAgentReleaseStore（继承，不复制任何校验/冲突逻辑）；每次改变状态的调用（含失败调用，
 * 因为失败也会写审计）连同其读取到的时钟值一起追加到 agent_release_store_journal，启动时按序重放、并回放
 * 原时钟值，因此重启后的 Apps / Releases / Channels / 审计与重启前逐字节一致。agent_apps 同步维护一份可查询镜像。
 *
 * 接口是同步的，写库异步排队；调用方在响应前 await flush()（agent-api 在 onSend 钩子里做），保证返回成功即已落盘。
 */
export class PostgresAgentReleaseStore extends InMemoryAgentReleaseStore {
  readonly #pool: Pool;
  readonly #ownsPool: boolean;
  readonly #baseClock: () => Date;
  #capture: string[] | undefined;
  #replay: string[] | undefined;
  #replaying = false;
  #chain: Promise<void> = Promise.resolve();
  #failure: unknown;
  readonly #log: (message: string) => void;

  private constructor(pool: Pool, ownsPool: boolean, options: PostgresAgentReleaseStoreOptions) {
    // 父类构造期间不读时钟；构造完成后把时钟改接到 #tick（捕获/回放）。
    const clock = { now: (): Date => new Date() };
    super({ now: () => clock.now() });
    clock.now = () => this.#tick();
    this.#pool = pool;
    this.#ownsPool = ownsPool;
    this.#baseClock = options.now ?? (() => new Date());
    this.#log = options.log ?? (() => undefined);
  }

  /** 打开并从日志重建状态。调用方需先执行 PostgresAgentStateAdapter.migrate()（含 010 迁移）。 */
  static async open(config: PoolConfig | Pool, options: PostgresAgentReleaseStoreOptions = {}): Promise<PostgresAgentReleaseStore> {
    const ownsPool = !(config instanceof Pool);
    const pool = config instanceof Pool ? config : new Pool(config);
    const store = new PostgresAgentReleaseStore(pool, ownsPool, options);
    await store.#load(options.importLegacyApps ?? true);
    return store;
  }

  #tick(): Date {
    if (this.#replay !== undefined) {
      const next = this.#replay.shift();
      if (next !== undefined) return new Date(next);
      this.#log('release-store replay: journal clock exhausted; using wall clock');
    }
    const value = this.#baseClock();
    this.#capture?.push(value.toISOString());
    return value;
  }

  async #load(importLegacyApps: boolean): Promise<void> {
    const rows = (await this.#pool.query<JournalRow>('SELECT seq, operation, args, clock FROM agent_release_store_journal ORDER BY seq')).rows;
    this.#replaying = true;
    try {
      for (const row of rows) {
        this.#replay = [...row.clock];
        try { this.#apply(row.operation, row.args); } catch { /* 失败调用同样重放以复原其拒绝审计 */ }
        this.#replay = undefined;
      }
    } finally { this.#replaying = false; this.#replay = undefined; }
    if (importLegacyApps) await this.#importLegacyApps();
    await this.flush();
  }

  /** agent_apps 中日志未覆盖的行（例如本存储上线前写入的 finance-briefing）作为真实 App 导入一次。 */
  async #importLegacyApps(): Promise<void> {
    const rows = (await this.#pool.query<AppRow>('SELECT tenant_id, app_id, owner_namespace, name, description, status, draft FROM agent_apps ORDER BY created_at, app_id')).rows;
    for (const row of rows) {
      if (this.#hasApp(row.tenant_id, row.app_id)) continue;
      try {
        this.createApp({
          tenantId: row.tenant_id, ownerNamespace: row.owner_namespace, appId: row.app_id,
          ...(row.name === null ? {} : { name: row.name }),
          ...(row.description === null || row.description === '' ? {} : { description: row.description })
        });
        const files = row.draft?.files;
        if (files !== undefined && files !== null && typeof files === 'object' && Object.keys(files).length > 0) {
          this.putAppDraft({ tenantId: row.tenant_id, appId: row.app_id, expectedRevision: 0, files: files as Record<string, string> });
        }
        if (row.status === 'deleted') this.softDeleteApp(row.tenant_id, row.app_id, 'legacy row imported as deleted');
        this.#log(`release-store: imported legacy agent_apps row ${row.tenant_id}/${row.app_id}`);
      } catch (cause) {
        this.#log(`release-store: skipped legacy agent_apps row ${row.tenant_id}/${row.app_id}: ${cause instanceof Error ? cause.message : String(cause)}`);
      }
    }
  }

  #hasApp(tenantId: string, appId: string): boolean {
    if (super.getApp(tenantId, appId) !== undefined) return true;
    // getApp 不返回已软删 App；此时 softDeleteApp 对“已删”幂等返回快照、对“不存在”返回 undefined，均不改状态。
    return super.softDeleteApp(tenantId, appId) !== undefined;
  }

  #apply(operation: ReleaseStoreOperation, args: readonly unknown[]): unknown {
    switch (operation) {
      case 'submit': return super.submit(args[0] as ReleaseSubmitRequest);
      case 'publish': return super.publish(args[0] as ReleasePublicationVerificationInput);
      case 'rollback': return super.rollback(args[0] as ReleasePublicationVerificationInput);
      case 'createApp': return super.createApp(args[0] as CreateAppRequest);
      case 'softDeleteApp': return super.softDeleteApp(args[0] as string, args[1] as string, ...(args.length > 2 ? [args[2] as string] : []));
      case 'putAppDraft': return super.putAppDraft(args[0] as PutAppDraftInput);
      case 'updateAppMetadata': return super.updateAppMetadata(args[0] as UpdateAppMetadataInput);
      case 'publishAppRelease': return super.publishAppRelease(args[0] as PublishAppReleaseInput);
    }
  }

  #mutate<T>(operation: ReleaseStoreOperation, args: readonly unknown[]): T {
    if (this.#replaying) return this.#apply(operation, args) as T;
    if (this.#failure !== undefined) throw new Error('RELEASE_STORE_PERSISTENCE_FAILED', { cause: this.#failure });
    // 先做 JSON 往返：日志存的正是重放时会拿到的输入。
    const stored = JSON.parse(JSON.stringify(args)) as unknown[];
    this.#capture = [];
    let result: unknown;
    let error: unknown;
    try { result = this.#apply(operation, stored); } catch (cause) { error = cause; }
    const clock = this.#capture;
    this.#capture = undefined;
    const appId = appIdOf(operation, stored);
    this.#enqueue({ operation, args: stored, clock, tenantId: tenantOf(stored), appIds: appId === undefined ? [] : [appId] });
    if (error !== undefined) throw error;
    return result as T;
  }

  #enqueue(entry: PendingEntry): void {
    const mirrors = entry.tenantId === undefined ? [] : entry.appIds.map((appId) => this.#mirrorRow(entry.tenantId!, appId));
    this.#chain = this.#chain.then(async () => {
      if (this.#failure !== undefined) return;
      const client = await this.#pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('INSERT INTO agent_release_store_journal (tenant_id, operation, args, clock) VALUES ($1,$2,$3,$4)',
          [entry.tenantId ?? null, entry.operation, JSON.stringify(entry.args), JSON.stringify(entry.clock)]);
        for (const app of mirrors) {
          if (app === undefined) continue;
          await client.query(`INSERT INTO agent_apps (tenant_id, app_id, owner_namespace, name, description, status, draft, created_at, updated_at, deleted_at)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
            ON CONFLICT (tenant_id, app_id) DO UPDATE SET owner_namespace=EXCLUDED.owner_namespace, name=EXCLUDED.name,
              description=EXCLUDED.description, status=EXCLUDED.status, draft=EXCLUDED.draft, created_at=EXCLUDED.created_at,
              updated_at=EXCLUDED.updated_at, deleted_at=EXCLUDED.deleted_at`,
          [app.tenantId, app.appId, app.ownerNamespace, app.name ?? null, app.description ?? null, app.status,
            JSON.stringify(app.draft), app.createdAt, app.updatedAt, app.deletedAt ?? null]);
        }
        await client.query('COMMIT');
      } catch (cause) {
        await client.query('ROLLBACK').catch(() => undefined);
        // 内存已前进而库未写入：之后拒绝所有写，避免内存与库分叉；进程重启后从库恢复到最后一致点。
        this.#failure = cause;
        this.#log(`release-store: persistence failed, store is now read-only until restart: ${cause instanceof Error ? cause.message : String(cause)}`);
      } finally { client.release(); }
    });
  }

  #mirrorRow(tenantId: string, appId: string): AgentApp | undefined {
    const active = super.getApp(tenantId, appId)?.app;
    if (active !== undefined) return active;
    // 软删后 getApp 返回 undefined；softDeleteApp 对已删 App 幂等返回快照且不改状态（不入审计/不读时钟）。
    return super.softDeleteApp(tenantId, appId);
  }

  /** 等待所有已排队写入落盘；任一写失败则抛出。 */
  async flush(): Promise<void> {
    await this.#chain;
    if (this.#failure !== undefined) throw new Error('RELEASE_STORE_PERSISTENCE_FAILED', { cause: this.#failure });
  }

  async health(): Promise<AdapterHealth> {
    try { await this.#pool.query('SELECT 1'); } catch { return { healthy: false, checkedAt: new Date().toISOString(), detail: 'RELEASE_STORE_BACKEND_UNAVAILABLE' }; }
    return this.#failure === undefined
      ? { healthy: true, checkedAt: new Date().toISOString() }
      : { healthy: false, checkedAt: new Date().toISOString(), detail: 'RELEASE_STORE_PERSISTENCE_FAILED' };
  }

  async close(): Promise<void> {
    await this.#chain;
    if (this.#ownsPool) await this.#pool.end();
  }

  override submit(request: ReleaseSubmitRequest): ReleaseSubmitResult { return this.#mutate('submit', [request]); }
  override publish(input: ReleasePublicationVerificationInput): ReleaseChannelPointer { return this.#mutate('publish', [input]); }
  override rollback(input: ReleasePublicationVerificationInput): ReleaseChannelPointer { return this.#mutate('rollback', [input]); }
  override createApp(request: CreateAppRequest): AgentApp { return this.#mutate('createApp', [request]); }
  override softDeleteApp(tenantId: string, appId: string, reason?: string): AgentApp | undefined {
    return this.#mutate('softDeleteApp', reason === undefined ? [tenantId, appId] : [tenantId, appId, reason]);
  }
  override putAppDraft(input: PutAppDraftInput): PutAppDraftResult { return this.#mutate('putAppDraft', [input]); }
  override updateAppMetadata(input: UpdateAppMetadataInput): UpdateAppMetadataResult { return this.#mutate('updateAppMetadata', [input]); }
  override publishAppRelease(input: PublishAppReleaseInput): ReleaseSubmitResult { return this.#mutate('publishAppRelease', [input]); }
}

type SpecPut = Parameters<AgentTaskSpecStorePort['putSpec']>[0];
type SpecResult = Awaited<ReturnType<AgentTaskSpecStorePort['putSpec']>>;
type Spec = SpecPut['spec'];

/**
 * agent_task_specs 上的 AgentTaskSpecStorePort，判定顺序与 InMemoryAgentTaskSpecStore 一致：
 * 租户不符抛错 → 同 attempt 不同 ref 为 ATTEMPT_SPEC_CONFLICT → 同 ref 同 digest 为 existing、不同 digest 为 SPEC_REF_CONFLICT。
 * 唯一差异：specRef 在 Postgres 中按租户隔离（主键 (tenant_id, spec_ref)），内存实现为全局。
 */
export class PostgresAgentTaskSpecStore implements AgentTaskSpecStorePort {
  readonly #pool: Pool;
  readonly #ownsPool: boolean;
  constructor(config: PoolConfig | Pool) {
    this.#ownsPool = !(config instanceof Pool);
    this.#pool = config instanceof Pool ? config : new Pool(config);
  }

  async putSpec(input: SpecPut): Promise<SpecResult> {
    if (input.spec.tenantId !== input.tenantId) throw new Error('SPEC_TENANT_MISMATCH');
    const { spec } = input;
    const byAttempt = (await this.#pool.query<{ spec_ref: string }>('SELECT spec_ref FROM agent_task_specs WHERE tenant_id=$1 AND attempt_id=$2', [input.tenantId, spec.attemptId])).rows[0];
    if (byAttempt !== undefined && byAttempt.spec_ref !== spec.specRef) return { status: 'conflict', code: 'ATTEMPT_SPEC_CONFLICT' };
    const inserted = await this.#pool.query(`INSERT INTO agent_task_specs (tenant_id,spec_ref,spec_digest,task_id,run_id,attempt_id,spec)
      VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING RETURNING spec_ref`,
    [input.tenantId, spec.specRef, spec.specDigest, spec.taskId, spec.runId, spec.attemptId, JSON.stringify(spec)]);
    if (inserted.rowCount === 1) return { status: 'stored', value: structuredClone(spec) };
    const byRef = (await this.#pool.query<{ spec_digest: string; spec: Spec }>('SELECT spec_digest, spec FROM agent_task_specs WHERE tenant_id=$1 AND spec_ref=$2', [input.tenantId, spec.specRef])).rows[0];
    if (byRef === undefined) return { status: 'conflict', code: 'ATTEMPT_SPEC_CONFLICT' };
    return byRef.spec_digest === spec.specDigest ? { status: 'existing', value: byRef.spec } : { status: 'conflict', code: 'SPEC_REF_CONFLICT' };
  }

  async getSpec(input: Parameters<AgentTaskSpecStorePort['getSpec']>[0]): Promise<Spec | undefined> {
    const row = (await this.#pool.query<{ spec: Spec }>('SELECT spec FROM agent_task_specs WHERE tenant_id=$1 AND spec_ref=$2 AND spec_digest=$3', [input.tenantId, input.specRef, input.expectedDigest])).rows[0];
    return row?.spec;
  }

  async health(): Promise<AdapterHealth> {
    try { await this.#pool.query('SELECT 1'); return { healthy: true, checkedAt: new Date().toISOString() }; }
    catch { return { healthy: false, checkedAt: new Date().toISOString(), detail: 'SPEC_STORE_BACKEND_UNAVAILABLE' }; }
  }

  async close(): Promise<void> { if (this.#ownsPool) await this.#pool.end(); }
}
