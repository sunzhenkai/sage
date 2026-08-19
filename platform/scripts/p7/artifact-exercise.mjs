#!/usr/bin/env node
import { mkdir, mkdtemp, readFile, rm, stat, symlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

if (process.env.SAGE_P7_ALLOW_ISOLATED_EXERCISE !== 'YES') throw new Error('SAGE_P7_ALLOW_ISOLATED_EXERCISE=YES is required');
const scripts = dirname(fileURLToPath(import.meta.url)); const work = await mkdtemp(join(tmpdir(), 'sage-p7-artifact-'));
const root = join(work, 'source'); const tenant = 'tenant-exercise'; const other = 'tenant-other'; const backup = join(work, 'backup.tar'); const restored = join(work, 'restored'); const audit = join(work, 'retention.jsonl');
const run = (name, args, env = {}) => { const value = spawnSync(join(scripts, name), args, { encoding: 'utf8', env: { ...process.env, ...env } }); if (value.status !== 0) throw new Error(`${name}: ${value.stderr}`); return value.stdout; };
const reject = (name, args, env = {}) => { const value = spawnSync(join(scripts, name), args, { encoding: 'utf8', env: { ...process.env, ...env } }); if (value.status === 0) throw new Error(`${name} unexpectedly accepted an unsafe input`); return `${value.stdout}${value.stderr}`; };
const startedAt = new Date().toISOString();
try {
  await mkdir(join(root, tenant), { recursive: true }); await mkdir(join(root, other), { recursive: true });
  const payload = Buffer.from('isolated-artifact-fixture'); await writeFile(join(root, tenant, 'report.txt'), payload); await writeFile(join(root, other, 'must-not-cross-tenant.txt'), 'other');
  run('artifact-backup.sh', [root, tenant, backup]); run('artifact-restore.sh', [backup, restored], { SAGE_RESTORE_ISOLATED: 'YES' });
  const restoredPayload = await readFile(join(restored, tenant, 'report.txt'));
  if (!restoredPayload.equals(payload)) throw new Error('ARTIFACT_RESTORE_HASH_MISMATCH');
  try { await stat(join(restored, other)); throw new Error('CROSS_TENANT_ARTIFACT_RESTORED'); } catch (cause) { if (cause instanceof Error && cause.message === 'CROSS_TENANT_ARTIFACT_RESTORED') throw cause; }
  const old = new Date('2020-01-01T00:00:00.000Z'); await utimes(join(root, tenant, 'report.txt'), old, old);
  run('artifact-retention-delete.sh', [root, tenant, '2021-01-01T00:00:00.000Z', audit]); await stat(join(root, tenant, 'report.txt'));
  run('artifact-retention-delete.sh', [root, tenant, '2021-01-01T00:00:00.000Z', audit, '--apply']);
  let deleted = false; try { await stat(join(root, tenant, 'report.txt')); } catch { deleted = true; } if (!deleted) throw new Error('ARTIFACT_RETENTION_DELETE_FAILED');

  const attackRoot = join(work, 'attack-source'); const attackTenant = join(attackRoot, tenant); const malicious = join(work, 'malicious.tar');
  await mkdir(attackTenant, { recursive: true }); await symlink('../../outside', join(attackTenant, 'escape-link'));
  if (!reject('artifact-backup.sh', [attackRoot, tenant, join(work, 'unsafe-backup.tar')]).includes('unsupported non-regular entry')) throw new Error('ARTIFACT_BACKUP_UNSAFE_REJECTION_MISSING');
  const packed = spawnSync('tar', ['--create', `--file=${malicious}`, `--directory=${attackRoot}`, tenant], { encoding: 'utf8' });
  if (packed.status !== 0) throw new Error(`malicious archive setup failed: ${packed.stderr}`);
  const maliciousBytes = await readFile(malicious); await writeFile(`${malicious}.sha256`, `${createHash('sha256').update(maliciousBytes).digest('hex')}  ${malicious}\n`);
  if (!reject('artifact-restore.sh', [malicious, join(work, 'unsafe-restored')], { SAGE_RESTORE_ISOLATED: 'YES' }).includes('links or special entries')) throw new Error('ARTIFACT_RESTORE_UNSAFE_REJECTION_MISSING');

  const auditBytes = await readFile(audit); const auditRecords = auditBytes.toString('utf8').trim().split('\n').map((line) => JSON.parse(line));
  if (auditRecords.length !== 2 || auditRecords[0]?.mode !== 'dry-run' || auditRecords[1]?.mode !== '--apply') throw new Error('ARTIFACT_DELETION_AUDIT_INVALID');
  const evidenceDirectory = resolve('evidence/p7/latest'); await mkdir(evidenceDirectory, { recursive: true });
  const evidence = { exercise_id: 'artifact-backup-restore', environment: 'isolated-local-filesystem', production_evidence: false, started_at: startedAt, completed_at: new Date().toISOString(), tenant_id: tenant, restored_sha256: createHash('sha256').update(restoredPayload).digest('hex'), cross_tenant_restore_count: 0, retention_dry_run_preserved: true, approved_apply_deleted: true, deletion_audit_sha256: createHash('sha256').update(auditBytes).digest('hex'), audit_records: auditRecords, unsafe_symlink_backup_rejected: true, unsafe_symlink_restore_rejected: true, outcome: 'passed' };
  await writeFile(join(evidenceDirectory, 'artifact-backup-restore.json'), `${JSON.stringify(evidence, null, 2)}\n`);
  console.log('P7 isolated Artifact backup/restore/retention exercise: PASS');
} finally { await rm(work, { recursive: true, force: true }); }
