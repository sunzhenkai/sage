import { Pool, type PoolClient, type PoolConfig, type QueryResultRow } from 'pg';
import {
  InMemoryAgentReleaseStore,
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

const iso = (value: Date | string): string => (value instanceof Date ? value.toISOString() : new Date(value).toISOString());

/**
 * App/Release Postgres 写穿：域逻辑仍走 InMemoryAgentReleaseStore，
 * 每次变更后落库；启动时水合，使 agent-api 重启后 App/Release 仍在。
 */
export class PostgresBackedAgentReleaseStore implements AsyncAgentReleaseStore {
  readonly #memory = new InMemoryAgentReleaseStore();
  readonly #pool: Pool;

  private constructor(pool: Pool) {
    this.#pool = pool;
  }

  static async open(config: PoolConfig | string | Pool): Promise<PostgresBackedAgentReleaseStore> {
    const pool = typeof config === 'string'
      ? new Pool({ connectionString: config })
      : config instanceof Pool ? config : new Pool(config);
    const store = new PostgresBackedAgentReleaseStore(pool);
    await store.#hydrate();
    return store;
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
    this.#memory.hydrateSnapshot({ apps, releases });
  }

  async #upsertApp(app: AgentApp): Promise<void> {
    await this.#tx(app.tenantId, async (client) => {
      await client.query(
        `INSERT INTO agent_apps(
          tenant_id, app_id, owner_namespace, name, description, status, draft, created_at, updated_at, deleted_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
        ON CONFLICT (tenant_id, app_id) DO UPDATE SET
          owner_namespace = EXCLUDED.owner_namespace,
          name = EXCLUDED.name,
          description = EXCLUDED.description,
          status = EXCLUDED.status,
          draft = EXCLUDED.draft,
          updated_at = EXCLUDED.updated_at,
          deleted_at = EXCLUDED.deleted_at`,
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
    });
  }

  async #insertRelease(record: StoredRelease): Promise<void> {
    const attestationRefs = [...record.release.attestationRefs];
    if (attestationRefs.length === 0) attestationRefs.push(`attestation://bootstrap/${record.release.releaseId}`);
    await this.#tx(record.tenantId, async (client) => {
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
    });
  }

  submit(request: Parameters<AsyncAgentReleaseStore['submit']>[0]) {
    return Promise.resolve(this.#memory.submit(request));
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
    return Promise.resolve(this.#memory.publish(input));
  }
  rollback(input: ReleasePublicationVerificationInput) {
    return Promise.resolve(this.#memory.rollback(input));
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

  async createApp(request: CreateAppRequest) {
    const app = this.#memory.createApp(request);
    await this.#upsertApp(app);
    return app;
  }

  async listApps(tenantId: string, options?: { readonly limit?: number }) {
    return this.#memory.listApps(tenantId, options);
  }

  async getApp(tenantId: string, appId: string) {
    return this.#memory.getApp(tenantId, appId);
  }

  async softDeleteApp(tenantId: string, appId: string, reason?: string) {
    const deleted = this.#memory.softDeleteApp(tenantId, appId, reason);
    if (deleted !== undefined) await this.#upsertApp(deleted);
    return deleted;
  }

  async putAppDraft(input: PutAppDraftInput) {
    const result = this.#memory.putAppDraft(input);
    if (result.status === 'stored') {
      const detail = this.#memory.getApp(input.tenantId, input.appId);
      if (detail !== undefined) await this.#upsertApp(detail.app);
    }
    return result;
  }

  async updateAppMetadata(input: UpdateAppMetadataInput) {
    const result = this.#memory.updateAppMetadata(input);
    if (result.status === 'updated') await this.#upsertApp(result.app);
    return result;
  }

  async publishAppRelease(input: PublishAppReleaseInput) {
    const result = this.#memory.publishAppRelease(input);
    const detail = this.#memory.getApp(input.tenantId, input.appId);
    if (detail !== undefined) await this.#upsertApp(detail.app);
    if (result.status === 'stored') await this.#insertRelease(result.record);
    return result;
  }
}
