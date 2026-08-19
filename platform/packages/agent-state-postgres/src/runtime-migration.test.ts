import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const checksum = (sql: string): string => createHash('sha256').update(sql).digest('hex');

const forwardUrl = new URL('../migrations/003_runtime_kernel_broker.sql', import.meta.url);
const rollbackUrl = new URL('../migrations/003_runtime_kernel_broker.down.sql', import.meta.url);
const releaseRegistryUrl = new URL('../migrations/004_agent_package_release_registry.sql', import.meta.url);
const releaseRegistryRollbackUrl = new URL('../migrations/004_agent_package_release_registry.down.sql', import.meta.url);

describe('runtime kernel broker migration', () => {
  it('defines additive usage/artifact/checkpoint authorities with idempotent constraints', async () => {
    const sql = await readFile(forwardUrl, 'utf8');
    expect(sql.startsWith('BEGIN;')).toBe(true);
    expect(sql.endsWith('COMMIT;\n')).toBe(true);
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS agent_usage_reservations');
    expect(sql).toContain('PRIMARY KEY (tenant_id, invocation_id)');
    expect(sql).toContain('UNIQUE (tenant_id, reservation_ref)');
    expect(sql).toContain("state IN ('reserved','committed','released','expired')");
    expect(sql).toContain('fence text NOT NULL');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS agent_usage_receipts');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS agent_artifact_finalize_operations');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS agent_artifact_finalize_outbox');
    expect(sql).toContain('ALTER TABLE sealed_agent_checkpoints');
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS receipt_refs');
    expect(sql).not.toContain('DROP TABLE');
    expect(checksum(sql)).toMatch(/^[a-f0-9]{64}$/);
  });

  it('defines tenant-scoped immutable Release Registry authorities and append-only audit', async () => {
    const sql = await readFile(releaseRegistryUrl, 'utf8');
    expect(sql.startsWith('BEGIN;')).toBe(true);
    expect(sql.endsWith('COMMIT;\n')).toBe(true);
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS agent_package_releases');
    expect(sql).toContain('PRIMARY KEY (tenant_id, release_ref)');
    expect(sql).toContain('UNIQUE (tenant_id, content_digest)');
    expect(sql).toContain('release_payload jsonb NOT NULL');
    expect(sql).toContain('lock_payload jsonb NOT NULL');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS agent_release_attestations');
    expect(sql).toContain('FOREIGN KEY (tenant_id, release_ref) REFERENCES agent_package_releases');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS agent_release_channels');
    expect(sql).toContain('pointer_revision bigint NOT NULL');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS agent_release_audit');
    expect(sql).toContain("action IN ('submit', 'verify', 'publish', 'rollback', 'reject')");
    expect(sql).toContain('agent_release_audit_append_only');
    expect(sql).toContain('BEFORE UPDATE OR DELETE ON agent_package_releases');
    expect(sql).toContain("ARRAY['principalRef', 'secret', 'secretBytes', 'target', 'liveGrant', 'remainingBudget']");
    expect(checksum(sql)).toMatch(/^[a-f0-9]{64}$/);
  });

  it('rolls back only Release Registry-owned objects', async () => {
    const sql = await readFile(releaseRegistryRollbackUrl, 'utf8');
    expect(sql).toContain('DROP TABLE IF EXISTS agent_release_audit');
    expect(sql).toContain('DROP TABLE IF EXISTS agent_release_channels');
    expect(sql).toContain('DROP TABLE IF EXISTS agent_release_attestations');
    expect(sql).toContain('DROP TABLE IF EXISTS agent_package_releases');
    expect(sql).toContain('DROP FUNCTION IF EXISTS sage_agent_release_immutable_guard');
    expect(sql).not.toContain('agent_task_specs');
    expect(sql).not.toContain('sealed_agent_checkpoints');
  });

  it('rollback only removes objects and columns owned by the runtime migration', async () => {
    const sql = await readFile(rollbackUrl, 'utf8');
    expect(sql).toContain('DROP TABLE IF EXISTS agent_artifact_finalize_outbox');
    expect(sql).toContain('DROP TABLE IF EXISTS agent_artifact_finalize_operations');
    expect(sql).toContain('DROP TABLE IF EXISTS agent_usage_receipts');
    expect(sql).toContain('DROP TABLE IF EXISTS agent_usage_reservations');
    expect(sql).toContain('DROP COLUMN IF EXISTS metadata_digest');
    expect(sql).not.toContain('DROP TABLE IF EXISTS agent_run_receipts');
    expect(sql).not.toContain('DROP TABLE IF EXISTS sealed_agent_checkpoints');
  });
});
