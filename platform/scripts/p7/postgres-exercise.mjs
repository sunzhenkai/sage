#!/usr/bin/env node
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

if (process.env.SAGE_P7_ALLOW_ISOLATED_EXERCISE !== 'YES') throw new Error('SAGE_P7_ALLOW_ISOLATED_EXERCISE=YES is required');
const suffix = `${process.pid}_${Date.now()}`;
const source = `sage_p7_source_${suffix}`; const restored = `sage_p7_restored_${suffix}`;
const backupRole = `p7_backup_${suffix}`; const restoreRole = `p7_restore_${suffix}`; const deleteRole = `p7_delete_${suffix}`;
const backupPassword = `backup_${suffix}`; const restorePassword = `restore_${suffix}`; const deletePassword = `delete_${suffix}`;
const tenant = `tenant-delete-${suffix}`; const retainedTenant = `tenant-keep-${suffix}`; const requestId = `request-${suffix}`;
const work = await mkdtemp(join(tmpdir(), 'sage-p7-pg-')); const backup = join(work, 'exercise.dump');
const evidenceDirectory = resolve('evidence/p7/latest'); await mkdir(evidenceDirectory, { recursive: true });
const containerRoot = `/tmp/sage-p7-${suffix}`; const containerBackup = `${containerRoot}/exercise.dump`;
const startedAt = new Date().toISOString();

const compose = (args, binary = true) => {
  const value = spawnSync('docker', ['compose', ...args], { encoding: binary ? null : 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (value.status !== 0) throw new Error(`docker compose ${args.join(' ')} failed: ${String(value.stderr)}`);
  return value.stdout;
};
const pg = (...args) => compose(['exec', '-T', '--user', 'postgres', 'postgres', ...args], false);
const psql = (database, sql, user = 'sage', password) => pg('env', `PGUSER=${user}`, `PGDATABASE=${database}`, ...(password ? [`PGHOST=127.0.0.1`, `PGPASSWORD=${password}`] : []), 'psql', '-v', 'ON_ERROR_STOP=1', '-Atc', sql);
const copyTo = (sourcePath, destination) => compose(['cp', sourcePath, `postgres:${destination}`], false);
const copyFrom = (sourcePath, destination) => compose(['cp', `postgres:${sourcePath}`, destination], false);
const sqlIdentifier = (value) => `"${value.replaceAll('"', '""')}"`;

let failure;
try {
  pg('mkdir', '-p', containerRoot);
  const files = [
    resolve('scripts/p7/postgres-backup.sh'), resolve('scripts/p7/postgres-restore.sh'), resolve('scripts/p7/postgres-tenant-delete.sh'),
    resolve('packages/agent-state-postgres/migrations/001_agent_state.sql'),
    resolve('packages/chat-domain/migrations/001_chat.sql'),
    resolve('packages/task-domain/migrations/001_task_store.sql')
  ];
  for (const file of files) copyTo(file, `${containerRoot}/${basename(file)}`);

  pg('createdb', '-U', 'sage', source);
  for (const migration of ['001_agent_state.sql', '001_chat.sql', '001_task_store.sql']) {
    pg('psql', '-U', 'sage', '-d', source, '-v', 'ON_ERROR_STOP=1', '-f', `${containerRoot}/${migration}`);
  }
  psql(source, `CREATE TABLE pilot_fixture(tenant_id text NOT NULL,payload jsonb NOT NULL); INSERT INTO pilot_fixture VALUES ('tenant-exercise','{"artifact_ref":"artifact://tenant-exercise/report","credential_ref":"secret://exercise/ref"}'); INSERT INTO chat_sessions(tenant_id,session_id,status,next_turn,next_sequence,retention_days,created_at,updated_at) VALUES ('${tenant}','session-target','open',1,0,30,now(),now()),('${retainedTenant}','session-retained','open',1,0,30,now(),now());`);

  psql('postgres', `CREATE ROLE ${sqlIdentifier(backupRole)} LOGIN PASSWORD '${backupPassword}'; GRANT CONNECT ON DATABASE ${sqlIdentifier(source)} TO ${sqlIdentifier(backupRole)};`);
  psql(source, `GRANT USAGE ON SCHEMA public TO ${sqlIdentifier(backupRole)}; GRANT SELECT ON ALL TABLES IN SCHEMA public TO ${sqlIdentifier(backupRole)}; GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO ${sqlIdentifier(backupRole)};`);
  pg('env', 'PGHOST=127.0.0.1', `PGUSER=${backupRole}`, `PGPASSWORD=${backupPassword}`, `PGDATABASE=${source}`, 'SAGE_BACKUP_ROLE_CONFIRMED=YES', 'bash', `${containerRoot}/postgres-backup.sh`, containerBackup);
  copyFrom(containerBackup, backup); copyFrom(`${containerBackup}.sha256`, `${backup}.sha256`); copyFrom(`${containerBackup}.manifest.json`, `${backup}.manifest.json`);

  pg('createdb', '-U', 'sage', restored);
  psql('postgres', `CREATE ROLE ${sqlIdentifier(restoreRole)} LOGIN PASSWORD '${restorePassword}'; GRANT CONNECT,CREATE ON DATABASE ${sqlIdentifier(restored)} TO ${sqlIdentifier(restoreRole)};`);
  psql(restored, `GRANT USAGE,CREATE ON SCHEMA public TO ${sqlIdentifier(restoreRole)};`);
  pg('env', 'PGHOST=127.0.0.1', `PGUSER=${restoreRole}`, `PGPASSWORD=${restorePassword}`, `PGDATABASE=${restored}`, 'SAGE_RESTORE_ISOLATED=YES', 'bash', `${containerRoot}/postgres-restore.sh`, containerBackup);

  const safeRefCount = String(psql(restored, "SELECT count(*) FROM pilot_fixture WHERE tenant_id='tenant-exercise' AND payload->>'credential_ref'='secret://exercise/ref';")).trim();
  if (safeRefCount !== '1') throw new Error(`RESTORE_VERIFICATION_FAILED:${safeRefCount}`);

  psql('postgres', `CREATE ROLE ${sqlIdentifier(deleteRole)} LOGIN PASSWORD '${deletePassword}'; GRANT CONNECT ON DATABASE ${sqlIdentifier(restored)} TO ${sqlIdentifier(deleteRole)};`);
  psql(restored, `GRANT USAGE ON SCHEMA public TO ${sqlIdentifier(deleteRole)}; GRANT SELECT,DELETE ON ALL TABLES IN SCHEMA public TO ${sqlIdentifier(deleteRole)}; REVOKE DELETE,UPDATE ON tenant_deletion_audit FROM ${sqlIdentifier(deleteRole)}; GRANT INSERT,SELECT ON tenant_deletion_audit TO ${sqlIdentifier(deleteRole)};`);
  const alterProbe = spawnSync('docker', ['compose', 'exec', '-T', '--user', 'postgres', 'postgres', 'env', 'PGHOST=127.0.0.1', `PGUSER=${deleteRole}`, `PGPASSWORD=${deletePassword}`, `PGDATABASE=${restored}`, 'psql', '-v', 'ON_ERROR_STOP=1', '-c', 'ALTER TABLE chat_sessions DISABLE TRIGGER ALL'], { encoding: 'utf8' });
  if (alterProbe.status === 0) throw new Error('DELETION_ROLE_CAN_ALTER_TRIGGERS');
  pg('env', 'PGHOST=127.0.0.1', `PGUSER=${deleteRole}`, `PGPASSWORD=${deletePassword}`, `PGDATABASE=${restored}`, 'SAGE_TENANT_DELETION_APPROVED=YES', 'bash', `${containerRoot}/postgres-tenant-delete.sh`, tenant, requestId, 'external://operator/exercise', '2026-08-13T00:00:00Z');

  const targetRemaining = String(psql(restored, `SELECT count(*) FROM chat_sessions WHERE tenant_id='${tenant}';`)).trim();
  const retainedRemaining = String(psql(restored, `SELECT count(*) FROM chat_sessions WHERE tenant_id='${retainedTenant}';`)).trim();
  const auditCount = String(psql(restored, `SELECT count(*) FROM tenant_deletion_audit WHERE request_id='${requestId}' AND tenant_id='${tenant}' AND verification->>'database_rows_remaining'='0';`)).trim();
  if (targetRemaining !== '0' || retainedRemaining !== '1' || auditCount !== '1') throw new Error(`TENANT_DELETE_VERIFICATION_FAILED:${targetRemaining}:${retainedRemaining}:${auditCount}`);
  let appendOnly = false;
  try { psql(restored, `UPDATE tenant_deletion_audit SET actor_ref='tampered' WHERE request_id='${requestId}';`); } catch (cause) { appendOnly = String(cause).includes('TENANT_DELETION_AUDIT_APPEND_ONLY'); }
  if (!appendOnly) throw new Error('TENANT_DELETION_AUDIT_NOT_APPEND_ONLY');

  const bytes = await readFile(backup);
  const evidence = {
    exercise_id: 'postgres-backup-restore', environment: 'isolated-local-compose-disposable-databases', production_evidence: false,
    started_at: startedAt, completed_at: new Date().toISOString(), source_database: source, restored_database: restored,
    formal_backup_script_executed: true, formal_restore_script_executed: true, backup_role_superuser: false,
    restore_role_scoped_to_isolated_database: true, restored_safe_reference_rows: 1,
    tenant_deletion_script_executed: true, deletion_role_cannot_alter_triggers: true, target_rows_remaining: 0,
    cross_tenant_rows_retained: 1, deletion_audit_rows: 1, deletion_audit_append_only: true,
    backup_sha256: createHash('sha256').update(bytes).digest('hex'), outcome: 'passed'
  };
  await import('node:fs/promises').then(({ writeFile }) => writeFile(join(evidenceDirectory, 'postgres-backup-restore.json'), `${JSON.stringify(evidence, null, 2)}\n`));
  console.log('P7 isolated PostgreSQL formal backup/restore/tenant-deletion exercise: PASS');
} catch (cause) { failure = cause; throw cause; }
finally {
  for (const database of [restored, source]) spawnSync('docker', ['compose', 'exec', '-T', '--user', 'postgres', 'postgres', 'dropdb', '--if-exists', '--force', '-U', 'sage', database]);
  for (const role of [deleteRole, restoreRole, backupRole]) spawnSync('docker', ['compose', 'exec', '-T', '--user', 'postgres', 'postgres', 'psql', '-U', 'sage', '-d', 'postgres', '-c', `DROP ROLE IF EXISTS ${sqlIdentifier(role)}`]);
  spawnSync('docker', ['compose', 'exec', '-T', '--user', 'postgres', 'postgres', 'rm', '-rf', containerRoot]);
  await rm(work, { recursive: true, force: true });
  void failure;
}
