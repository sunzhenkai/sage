import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

export interface QueryResultRow { readonly [column: string]: unknown }

export interface PostgresMigration {
  readonly version: string;
  readonly url: URL;
  readonly checksumSha256?: string;
}

export interface AppliedPostgresMigration {
  readonly component: string;
  readonly version: string;
  readonly checksumSha256: string;
  readonly appliedAt: string;
}

export class PostgresMigrationError extends Error {
  readonly code: 'MIGRATION_MANIFEST_INVALID' | 'MIGRATION_CHECKSUM_DRIFT' | 'MIGRATION_FAILED';
  constructor(code: PostgresMigrationError['code'], message: string, options?: ErrorOptions) {
    super(message, options);
    this.code = code;
  }
}

interface LedgerRow extends QueryResultRow {
  component: string;
  version: string;
  checksum_sha256: string;
  applied_at: Date | string;
}

interface MigrationClient {
  query<R extends QueryResultRow = QueryResultRow>(text: string, values?: unknown[]): Promise<{ rows: R[] }>;
  release(): void;
}

export interface MigrationPool {
  connect(): Promise<MigrationClient>;
}

export const migrationChecksum = (sql: string | Buffer): string =>
  createHash('sha256').update(sql).digest('hex');

export async function loadMigration(migration: PostgresMigration): Promise<{ readonly version: string; readonly sql: string; readonly checksumSha256: string }> {
  const sql = await readFile(migration.url, 'utf8');
  const checksumSha256 = migrationChecksum(sql);
  if (migration.checksumSha256 !== undefined && migration.checksumSha256 !== checksumSha256) {
    throw new PostgresMigrationError('MIGRATION_CHECKSUM_DRIFT', `Migration ${migration.version} file checksum does not match its immutable manifest`);
  }
  return { version: migration.version, sql, checksumSha256 };
}

export async function runPostgresMigrations(
  pool: MigrationPool,
  component: string,
  manifest: readonly PostgresMigration[]
): Promise<readonly AppliedPostgresMigration[]> {
  assertManifest(component, manifest);
  const loaded = await Promise.all(manifest.map(loadMigration));
  const client = await pool.connect();
  let locked = false;
  try {
    await client.query(`CREATE TABLE IF NOT EXISTS sage_schema_migrations (
      component text NOT NULL,
      version text NOT NULL,
      checksum_sha256 text NOT NULL CHECK (checksum_sha256 ~ '^[0-9a-f]{64}$'),
      applied_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      PRIMARY KEY (component, version)
    )`);
    await client.query("SELECT pg_advisory_lock(hashtextextended('sage-schema-migration:' || $1, 0))", [component]);
    locked = true;
    const existing = (await client.query<LedgerRow>(
      'SELECT component,version,checksum_sha256,applied_at FROM sage_schema_migrations WHERE component=$1 ORDER BY version',
      [component]
    )).rows;
    const byVersion = new Map(existing.map((row) => [row.version, row]));
    for (const migration of loaded) {
      const applied = byVersion.get(migration.version);
      if (applied !== undefined && applied.checksum_sha256 !== migration.checksumSha256) {
        throw new PostgresMigrationError(
          'MIGRATION_CHECKSUM_DRIFT',
          `Applied ${component}/${migration.version} checksum differs from the immutable manifest`
        );
      }
      if (applied !== undefined) continue;
      try {
        // Migration SQL is independently idempotent. Ledger insertion intentionally follows
        // successful SQL so a crash in between safely retries the SQL on the next startup.
        await client.query(migration.sql);
        await client.query(
          `INSERT INTO sage_schema_migrations(component,version,checksum_sha256,applied_at)
           VALUES ($1,$2,$3,clock_timestamp()) ON CONFLICT (component,version) DO NOTHING`,
          [component, migration.version, migration.checksumSha256]
        );
        const recorded = (await client.query<LedgerRow>(
          'SELECT component,version,checksum_sha256,applied_at FROM sage_schema_migrations WHERE component=$1 AND version=$2',
          [component, migration.version]
        )).rows[0];
        if (recorded === undefined || recorded.checksum_sha256 !== migration.checksumSha256) {
          throw new PostgresMigrationError('MIGRATION_CHECKSUM_DRIFT', `Could not record immutable checksum for ${component}/${migration.version}`);
        }
        byVersion.set(migration.version, recorded);
      } catch (cause) {
        if (cause instanceof PostgresMigrationError) throw cause;
        throw new PostgresMigrationError('MIGRATION_FAILED', `Migration ${component}/${migration.version} failed`, { cause });
      }
    }
    return [...byVersion.values()].sort((a, b) => a.version.localeCompare(b.version)).map((row) => ({
      component: row.component,
      version: row.version,
      checksumSha256: row.checksum_sha256,
      appliedAt: row.applied_at instanceof Date ? row.applied_at.toISOString() : new Date(row.applied_at).toISOString()
    }));
  } finally {
    if (locked) await client.query("SELECT pg_advisory_unlock(hashtextextended('sage-schema-migration:' || $1, 0))", [component]).catch(() => undefined);
    client.release();
  }
}

function assertManifest(component: string, manifest: readonly PostgresMigration[]): void {
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(component)) {
    throw new PostgresMigrationError('MIGRATION_MANIFEST_INVALID', `Invalid migration component: ${component}`);
  }
  let previous = '';
  const seen = new Set<string>();
  for (const migration of manifest) {
    if (!/^[0-9]{3,}_[a-z0-9_]+$/.test(migration.version) || seen.has(migration.version) || migration.version <= previous) {
      throw new PostgresMigrationError('MIGRATION_MANIFEST_INVALID', `Manifest for ${component} must have unique, strictly ordered versions`);
    }
    if (migration.url.protocol !== 'file:') {
      throw new PostgresMigrationError('MIGRATION_MANIFEST_INVALID', `Migration ${migration.version} must use a local file URL`);
    }
    seen.add(migration.version);
    previous = migration.version;
  }
}
