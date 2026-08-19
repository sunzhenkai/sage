import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  PostgresMigrationError,
  migrationChecksum,
  runPostgresMigrations,
  type MigrationPool,
  type PostgresMigration,
  type QueryResultRow
} from './index.js';

interface Ledger { component: string; version: string; checksum_sha256: string; applied_at: string }

class FakeMigrationPool implements MigrationPool {
  readonly ledger = new Map<string, Ledger>();
  readonly executed: string[] = [];
  failNextLedgerInsert = false;

  async connect() {
    return {
      query: async <R extends QueryResultRow = QueryResultRow>(text: string, values: unknown[] = []) => {
        const normalized = text.trim();
        if (normalized.startsWith('CREATE TABLE') || normalized.includes('pg_advisory_lock') || normalized.includes('pg_advisory_unlock')) return { rows: [] as R[] };
        if (normalized.startsWith('SELECT component,version') && normalized.includes('version=$2')) {
          const row = this.ledger.get(`${String(values[0])}/${String(values[1])}`);
          return { rows: (row === undefined ? [] : [row]) as unknown as R[] };
        }
        if (normalized.startsWith('SELECT component,version')) {
          return { rows: [...this.ledger.values()].filter((row) => row.component === values[0]).sort((a, b) => a.version.localeCompare(b.version)) as unknown as R[] };
        }
        if (normalized.startsWith('INSERT INTO sage_schema_migrations')) {
          if (this.failNextLedgerInsert) {
            this.failNextLedgerInsert = false;
            throw new Error('simulated ledger outage');
          }
          const component = String(values[0]);
          const version = String(values[1]);
          const checksum = String(values[2]);
          const key = `${component}/${version}`;
          if (!this.ledger.has(key)) this.ledger.set(key, { component, version, checksum_sha256: checksum, applied_at: '2026-08-14T00:00:00.000Z' });
          return { rows: [] as R[] };
        }
        this.executed.push(normalized);
        return { rows: [] as R[] };
      },
      release() { /* dedicated connection released */ }
    };
  }
}

async function fixtureManifest(...entries: readonly [string, string][]): Promise<readonly PostgresMigration[]> {
  const directory = await mkdtemp(join(tmpdir(), 'sage-migrations-'));
  const manifest: PostgresMigration[] = [];
  for (const [version, sql] of entries) {
    const path = join(directory, `${version}.sql`);
    await writeFile(path, sql);
    manifest.push({ version, url: pathToFileURL(path), checksumSha256: migrationChecksum(sql) });
  }
  return manifest;
}

describe('ordered PostgreSQL migration runner', () => {
  it('applies an empty-database manifest in order and records immutable checksums', async () => {
    const pool = new FakeMigrationPool();
    const manifest = await fixtureManifest(['001_first', 'SELECT 1;'], ['002_second', 'SELECT 2;']);
    const applied = await runPostgresMigrations(pool, 'chat-test', manifest);
    expect(pool.executed).toEqual(['SELECT 1;', 'SELECT 2;']);
    expect(applied.map((item) => item.version)).toEqual(['001_first', '002_second']);
    expect(applied.every((item) => item.checksumSha256.length === 64)).toBe(true);
  });

  it('is a no-op on repeated execution', async () => {
    const pool = new FakeMigrationPool();
    const manifest = await fixtureManifest(['001_once', 'SELECT 1;']);
    await runPostgresMigrations(pool, 'repeat-test', manifest);
    await runPostgresMigrations(pool, 'repeat-test', manifest);
    expect(pool.executed).toEqual(['SELECT 1;']);
  });

  it('allows independent components to migrate concurrently', async () => {
    const pool = new FakeMigrationPool();
    const [a, b] = await Promise.all([
      runPostgresMigrations(pool, 'component-a', await fixtureManifest(['001_a', 'SELECT 10;'])),
      runPostgresMigrations(pool, 'component-b', await fixtureManifest(['001_b', 'SELECT 20;']))
    ]);
    expect(a[0]?.component).toBe('component-a');
    expect(b[0]?.component).toBe('component-b');
    expect(pool.executed.sort()).toEqual(['SELECT 10;', 'SELECT 20;']);
  });

  it('safely retries idempotent SQL after SQL success but ledger failure', async () => {
    const pool = new FakeMigrationPool();
    pool.failNextLedgerInsert = true;
    const manifest = await fixtureManifest(['001_retry', 'CREATE INDEX IF NOT EXISTS retry_idx ON retry_table(id);']);
    await expect(runPostgresMigrations(pool, 'retry-test', manifest)).rejects.toMatchObject({ code: 'MIGRATION_FAILED' });
    await runPostgresMigrations(pool, 'retry-test', manifest);
    expect(pool.executed).toEqual([
      'CREATE INDEX IF NOT EXISTS retry_idx ON retry_table(id);',
      'CREATE INDEX IF NOT EXISTS retry_idx ON retry_table(id);'
    ]);
  });

  it('fails fast when an applied version checksum drifts', async () => {
    const pool = new FakeMigrationPool();
    const directory = await mkdtemp(join(tmpdir(), 'sage-drift-'));
    const path = join(directory, '001_drift.sql');
    await writeFile(path, 'SELECT 1;');
    await runPostgresMigrations(pool, 'drift-test', [{ version: '001_drift', url: pathToFileURL(path) }]);
    await writeFile(path, 'SELECT 2;');
    await expect(runPostgresMigrations(pool, 'drift-test', [{ version: '001_drift', url: pathToFileURL(path) }]))
      .rejects.toBeInstanceOf(PostgresMigrationError);
    await expect(runPostgresMigrations(pool, 'drift-test', [{ version: '001_drift', url: pathToFileURL(path) }]))
      .rejects.toMatchObject({ code: 'MIGRATION_CHECKSUM_DRIFT' });
  });
});
