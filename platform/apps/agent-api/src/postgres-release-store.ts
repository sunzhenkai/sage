import { Pool, type PoolClient, type PoolConfig, type QueryResultRow } from 'pg';
import {
  InMemoryAgentReleaseStore,
  ReleaseRegistryError,
  type ReleaseChannelPointer,
  type AgentApp,
  type AsyncAgentReleaseStore,
  type CreateAppRequest,
  type PublishAppReleaseInput,
  type PutAppDraftInput,
  type ReleasePayload,
  type ReleasePublicationVerificationInput,
  type StoredRelease,
  type UpdateAppMetadataInput
} from '@sage/agent-release-registry';

interface AppRow extends QueryResultRow {
  tenant_id: string;
  app_id: string;
  owner_namespace: string;
  name: string | null;
  description: string | null;
  status: 'active' | 'deleted';
  draft: AgentApp['draft'];
  created_at: Date | string;
  updated_at: Date | string;
  deleted_at: Date | string | null;
}

interface ReleaseRow extends QueryResultRow {
  tenant_id: string;
  owner_namespace: string;
  package_id: string;
  package_version: string;
  release_ref: string;
  release_id: string;
  content_digest: string;
  lock_digest: string;
  release_payload: ReleasePayload;
  lock_payload: Record<string, unknown>;
  attestation_refs: string[];
  idempotency_key: string | null;
  source_files: Record<string, string> | null;
  source_files_digest: string | null;
  created_at: Date | string;
}

interface ChannelHistoryRow extends QueryResultRow {
  tenant_id: string;
  owner_namespace: string;
  package_id: string;
  channel: string;
  pointer_revision: string | number;
  release_ref: string;
}

const iso = (value: Date | string): string => (value instanceof Date ? value.toISOString() : new Date(value).toISOString());

/**
 * App/Release Postgres 写穿：域逻辑仍走 InMemoryAgentReleaseStore，
 * 每次变更后落库；启动时水合，使 agent-api 重启后 App/Release 仍在。
 */
export class PostgresBackedAgentReleaseStore implements AsyncAgentReleaseStore {
  readonly #memory = new InMemoryAgentReleaseStore();
  readonly #pool: Pool;
  #queue: Promise<void> = Promise.resolve();
  readonly #ownsPool: boolean;

  private constructor(pool: Pool, ownsPool: boolean) {
    this.#pool = pool;
    this.#ownsPool = ownsPool;
  }

  static async open(config: PoolConfig | string | Pool): Promise<PostgresBackedAgentReleaseStore> {
    const pool = typeof config === 'string'
      ? new Pool({ connectionString: config })
      : config instanceof Pool ? config : new Pool(config);
    const store = new PostgresBackedAgentReleaseStore(pool, !(config instanceof Pool));
    await store.#hydrate();
    return store;
  }

  async close(): Promise<void> {
    if (this.#ownsPool) await this.#pool.end();
  }

  /** 同步读侧（AppStatusLookup / schedule resolver）复用已水合内存。 */
  get sync(): InMemoryAgentReleaseStore {
    return this.#memory;
  }

  async #tx<T>(tenantId: string, fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT sage_security.set_request_context($1,$2)', [tenantId, 'principal://release-registry']);
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (cause) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw cause;
    } finally {
      client.release();
    }
  }

  async #hydrate(): Promise<void> {
    const apps = (await this.#pool.query<AppRow>('SELECT * FROM agent_apps')).rows.map((row): AgentApp => ({
      tenantId: row.tenant_id,
      ownerNamespace: row.owner_namespace,
      appId: row.app_id,
      ...(row.name === null ? {} : { name: row.name }),
      ...(row.description === null ? {} : { description: row.description }),
      status: row.status,
      draft: row.draft,
      createdAt: iso(row.created_at),
      updatedAt: iso(row.updated_at),
      ...(row.deleted_at === null ? {} : { deletedAt: iso(row.deleted_at) })
    }));
    const releases = (await this.#pool.query<ReleaseRow>('SELECT * FROM agent_package_releases')).rows.map((row): StoredRelease => ({
      tenantId: row.tenant_id,
      ownerNamespace: row.owner_namespace,
      packageId: row.package_id,
      packageVersion: row.package_version,
      idempotencyKey: row.idempotency_key ?? row.release_id,
      release: row.release_payload,
      lockPayload: row.lock_payload,
      ...(row.source_files === null ? {} : { sourceFiles: row.source_files }),
      ...(row.source_files_digest === null ? {} : { sourceFilesDigest: row.source_files_digest }),
      createdAt: iso(row.created_at)
    }));
    const channelHistory = (await this.#pool.query<ChannelHistoryRow>(
      'SELECT * FROM agent_release_channel_history ORDER BY tenant_id, owner_namespace, package_id, channel, pointer_revision'
    )).rows.map((row): ReleaseChannelPointer => ({
      tenantId: row.tenant_id,
      ownerNamespace: row.owner_namespace,
      packageId: row.package_id,
      channel: row.channel,
      releaseRef: row.release_ref,
      pointerRevision: Number(row.pointer_revision)
    }));
    this.#memory.hydrateSnapshot({ apps, releases, channelHistory });
  }

  async #upsertApp(client: PoolClient, app: AgentApp, onConflict: 'update' | 'nothing' = 'update'): Promise<void> {
      await client.query(
        `INSERT INTO agent_apps(
          tenant_id, app_id, owner_namespace, name, description, status, draft, created_at, updated_at, deleted_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
        ON CONFLICT (tenant_id, app_id) DO ${onConflict === 'nothing' ? 'NOTHING' : `UPDATE SET
          owner_namespace = EXCLUDED.owner_namespace,
          name = EXCLUDED.name,
          description = EXCLUDED.description,
          status = EXCLUDED.status,
          draft = EXCLUDED.draft,
          updated_at = EXCLUDED.updated_at,
          deleted_at = EXCLUDED.deleted_at`}`,
        [
          app.tenantId,
          app.appId,
          app.ownerNamespace,
          app.name ?? null,
          app.description ?? null,
          app.status,
          JSON.stringify(app.draft),
          new Date(app.createdAt),
          new Date(app.updatedAt),
          app.deletedAt === undefined ? null : new Date(app.deletedAt)
        ]
      );
  }

  async #insertRelease(client: PoolClient, record: StoredRelease): Promise<void> {
    const attestationRefs = [...record.release.attestationRefs];
    if (attestationRefs.length === 0) attestationRefs.push(`attestation://bootstrap/${record.release.releaseId}`);
      await client.query(
        `INSERT INTO agent_package_releases(
          tenant_id, owner_namespace, package_id, package_version, release_ref, release_id,
          content_digest, lock_digest, release_payload, lock_payload, attestation_refs,
          idempotency_key, source_files, source_files_digest, created_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
        ON CONFLICT (tenant_id, release_ref) DO NOTHING`,
        [
          record.tenantId,
          record.ownerNamespace,
          record.packageId,
          record.packageVersion,
          record.release.releaseRef,
          record.release.releaseId,
          record.release.contentDigest,
          record.release.lockDigest,
          JSON.stringify(record.release),
          JSON.stringify(record.lockPayload),
          attestationRefs,
          record.idempotencyKey,
          record.sourceFiles === undefined ? null : JSON.stringify(record.sourceFiles),
          record.sourceFilesDigest ?? null,
          new Date(record.createdAt)
        ]
      );
  }

  async #recordChannel(client: PoolClient, pointer: ReleaseChannelPointer, action: 'publish' | 'rollback'): Promise<void> {
    await client.query(
      `INSERT INTO agent_release_channel_history(
        tenant_id, owner_namespace, package_id, channel, pointer_revision, release_ref, action
      ) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [pointer.tenantId, pointer.ownerNamespace, pointer.packageId, pointer.channel, pointer.pointerRevision, pointer.releaseRef, action]
    );
    await client.query(
      `INSERT INTO agent_release_channels(tenant_id, owner_namespace, package_id, channel, release_ref, pointer_revision, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,clock_timestamp())
       ON CONFLICT (tenant_id, owner_namespace, package_id, channel) DO UPDATE SET
         release_ref = EXCLUDED.release_ref, pointer_revision = EXCLUDED.pointer_revision, updated_at = EXCLUDED.updated_at`,
      [pointer.tenantId, pointer.ownerNamespace, pointer.packageId, pointer.channel, pointer.releaseRef, pointer.pointerRevision]
    );
  }

  /**
   * 一致性：变更串行化 → 内存域逻辑校验并产出结果（域错误照常抛出、不写库）→
   * 单事务写库 → 失败则把内存恢复到变更前并抛 RELEASE_STORE_PERSISTENCE_FAILED（API 映射 503）。
   */
  async #mutate<T>(tenantId: string, apply: () => T, persist: (client: PoolClient, result: T) => Promise<void>): Promise<T> {
    const run = this.#queue.then(async () => {
      const checkpoint = this.#memory.captureState();
      const result = apply();
      try {
        await this.#tx(tenantId, (client) => persist(client, result));
      } catch (cause) {
        this.#memory.restoreState(checkpoint);
        const error = new ReleaseRegistryError('RELEASE_STORE_PERSISTENCE_FAILED', 'release store persistence failed; change was not applied');
        (error as Error & { cause?: unknown }).cause = cause;
        throw error;
      }
      return result;
    });
    this.#queue = run.then(() => undefined, () => undefined);
    return run;
  }

  submit(request: Parameters<AsyncAgentReleaseStore['submit']>[0]) {
    return this.#mutate(request.tenantId, () => this.#memory.submit(request), async (client, result) => {
      if (result.status !== 'stored') return;
      // 旧 submit 路径会隐式登记占位 App：先落占位 App（已存在则不覆盖），再落 Release。
      const placeholder = this.#memory.getAppRecord(request.tenantId, request.packageId);
      if (placeholder !== undefined) await this.#upsertApp(client, placeholder, 'nothing');
      await this.#insertRelease(client, result.record);
    });
  }
  getByRef(tenantId: string, releaseRef: string) {
    return Promise.resolve(this.#memory.getByRef(tenantId, releaseRef));
  }
  getStoredRelease(tenantId: string, releaseRef: string) {
    return Promise.resolve(this.#memory.getStoredRelease(tenantId, releaseRef));
  }
  getByContentDigest(tenantId: string, contentDigest: string) {
    return Promise.resolve(this.#memory.getByContentDigest(tenantId, contentDigest));
  }
  publish(input: ReleasePublicationVerificationInput) {
    return this.#mutate(input.tenantId, () => this.#memory.publish(input), (client, pointer) => this.#recordChannel(client, pointer, 'publish'));
  }
  rollback(input: ReleasePublicationVerificationInput) {
    return this.#mutate(input.tenantId, () => this.#memory.rollback(input), (client, pointer) => this.#recordChannel(client, pointer, 'rollback'));
  }
  /** 渠道指针历史（含当前指针，按 revision 升序）。 */
  getChannelHistory(tenantId: string, ownerNamespace: string, packageId: string, channel: string) {
    return Promise.resolve(this.#memory.getChannelHistory(tenantId, ownerNamespace, packageId, channel));
  }
  getChannel(tenantId: string, ownerNamespace: string, packageId: string, channel: string) {
    return Promise.resolve(this.#memory.getChannel(tenantId, ownerNamespace, packageId, channel));
  }
  resolveImmutableRelease(tenantId: string, releaseRef: string) {
    return Promise.resolve(this.#memory.resolveImmutableRelease(tenantId, releaseRef));
  }
  resolveChannelRelease(tenantId: string, ownerNamespace: string, packageId: string, channel: string) {
    return Promise.resolve(this.#memory.resolveChannelRelease(tenantId, ownerNamespace, packageId, channel));
  }
  listPackages(tenantId: string, options?: { readonly limit?: number }) {
    return Promise.resolve(this.#memory.listPackages(tenantId, options));
  }
  getPackageDetail(tenantId: string, packageId: string) {
    return Promise.resolve(this.#memory.getPackageDetail(tenantId, packageId));
  }
  listAppReleases(tenantId: string, appId: string) {
    return Promise.resolve(this.#memory.listAppReleases(tenantId, appId));
  }
  auditLog() {
    return Promise.resolve(this.#memory.auditLog());
  }

  createApp(request: CreateAppRequest) {
    return this.#mutate(request.tenantId, () => this.#memory.createApp(request), (client, app) => this.#upsertApp(client, app));
  }

  async listApps(tenantId: string, options?: { readonly limit?: number }) {
    return this.#memory.listApps(tenantId, options);
  }

  async getApp(tenantId: string, appId: string) {
    return this.#memory.getApp(tenantId, appId);
  }

  softDeleteApp(tenantId: string, appId: string, reason?: string) {
    return this.#mutate(tenantId, () => this.#memory.softDeleteApp(tenantId, appId, reason), async (client, deleted) => {
      if (deleted !== undefined) await this.#upsertApp(client, deleted);
    });
  }

  putAppDraft(input: PutAppDraftInput) {
    return this.#mutate(input.tenantId, () => this.#memory.putAppDraft(input), async (client, result) => {
      if (result.status !== 'stored') return;
      const app = this.#memory.getAppRecord(input.tenantId, input.appId);
      if (app !== undefined) await this.#upsertApp(client, app);
    });
  }

  updateAppMetadata(input: UpdateAppMetadataInput) {
    return this.#mutate(input.tenantId, () => this.#memory.updateAppMetadata(input), async (client, result) => {
      if (result.status === 'updated') await this.#upsertApp(client, result.app);
    });
  }

  publishAppRelease(input: PublishAppReleaseInput) {
    return this.#mutate(input.tenantId, () => this.#memory.publishAppRelease(input), async (client, result) => {
      // App 行与 Release 行同一事务：要么都落库，要么内存一并回滚。
      if (result.status !== 'stored') return;
      const app = this.#memory.getAppRecord(input.tenantId, input.appId);
      if (app !== undefined) await this.#upsertApp(client, app);
      await this.#insertRelease(client, result.record);
    });
  }
}
