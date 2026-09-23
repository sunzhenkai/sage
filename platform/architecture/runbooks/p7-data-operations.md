# P7 Data, Tenant, and Credential Operations

All commands are default-safe and local/portable; production endpoints, classifications, retention values, RTO/RPO and operators are **UNFILLED — HUMAN INPUT REQUIRED**.

## Least privilege

- PostgreSQL backup role: `CONNECT` plus `SELECT` on approved application schemas/sequences only; no superuser, create database, replication, DDL or tenant-write privilege. Use `.pgpass` mode 0600, workload identity or an approved provider; never put passwords in command arguments/logs.
- Restore role exists only in a newly created isolated recovery database. `postgres-restore.sh` refuses to run without `SAGE_RESTORE_ISOLATED=YES` and verifies the archive checksum.
- Tenant deletion role can delete only application tenant rows and insert the append-only audit. It cannot alter/disable triggers. `postgres-tenant-delete.sh` requires an external request id and transaction-local matching tenant controls.
- Artifact backup/delete identity is scoped to one approved tenant prefix and a separate append-only audit sink.

## PostgreSQL backup and restore

```bash
# Approved PGHOST/PGPORT/PGUSER/PGDATABASE are supplied out of band.
SAGE_BACKUP_ROLE_CONFIRMED=YES scripts/p7/postgres-backup.sh /secure/backup/sage.dump
# Create and isolate an empty recovery DB first; never target production.
SAGE_RESTORE_ISOLATED=YES scripts/p7/postgres-restore.sh /secure/backup/sage.dump
```

Verify schema inventory, row/reference counts, tenant boundary probes, `pg_restore --list`, application read checks and fixture secret scan. Record backup window, digest, source, isolated destination, operator identity and elapsed recovery time. Compare elapsed/data window only to externally approved RTO/RPO; no values are assumed here. `postgres-exercise.mjs` creates disposable source/restore databases and scoped login roles, executes these exact backup/restore scripts as non-root, proves the backup role is non-superuser, runs the formal tenant-deletion script under a role that cannot alter triggers, verifies cross-tenant preservation and append-only audit, then drops the databases and roles.

## Artifact backup, restore, retention and deletion

```bash
scripts/p7/artifact-backup.sh /approved/artifact-root TENANT_ID /secure/backup/tenant.tar
SAGE_RESTORE_ISOLATED=YES scripts/p7/artifact-restore.sh /secure/backup/tenant.tar /isolated/empty-dir
# dry run first; cutoff must come from approved policy
scripts/p7/artifact-retention-delete.sh /approved/artifact-root TENANT_ID APPROVED_CUTOFF audit.jsonl
scripts/p7/artifact-retention-delete.sh /approved/artifact-root TENANT_ID APPROVED_CUTOFF audit.jsonl --apply
```

The backup archive contains one tenant prefix and rejects symlinks/special filesystem entries. Restore verifies checksum before creating the destination, rejects absolute/traversal/multi-tenant paths plus links/devices, rejects non-empty destinations, and does not preserve archive ownership. The exercise verifies that another tenant is absent, dry-run deletion preserves data, apply deletion emits hashed structured audit evidence, and malicious symlink archives are rejected before extraction.

## Tenant deletion

1. Authenticate the data-subject/tenant request externally; obtain request id, scope, legal-hold check and approval.
2. Stop new writes for the tenant and enumerate Chat, Agent State, Task projection/audit references, Temporal retention limitations and Artifact prefixes.
3. Dry-run/export required audit evidence. Temporal History deletion follows the separately approved Temporal policy/API; this script does not pretend PostgreSQL owns History.
4. Run `SAGE_TENANT_DELETION_APPROVED=YES scripts/p7/postgres-tenant-delete.sh TENANT REQUEST ACTOR_REF APPROVED_AT` under the deletion role.
5. Delete Artifact objects using the approved tenant-prefix operation; preserve request-level deletion evidence outside tenant-owned storage.
6. Verify zero query results from every API/store and record excluded legal/audit records. `tenant_deletion_audit` is append-only. `tool_idempotency` is hash-keyed without tenant lookup and therefore follows approved global retention; changing this requires a schema migration.

## Tenant isolation and access-audit review

- PostgreSQL keys/queries include `tenant_id`; Artifact adapters require tenant on get/delete; target selection consumes authenticated tenant context; Task HTTP rejects cross-tenant principal identity.
- Pilot Task create requires `TaskAccessAuditRecorder`. Audit failure is fail-closed and each decision records external authentication id, principal id, tenant, operation, task and outcome.
- Before production, add database-level RLS/service-role grants for the real topology and have security review them. Current local schema/application checks are not a claim of production RLS.

## Credential rotation (reference/provider only)

1. Rotate value/version in the approved external Secret Manager. Never submit value to Registry, API, Workflow, database or telemetry.
2. Keep the same `secret://` reference when provider semantics support version promotion; otherwise publish a new immutable TargetProfile version containing only the new reference.
3. Execution resolves through `CredentialProvider` with tenant/environment/purpose/scope. Mutable lease bytes are zeroed after connector/tool use.
4. Validate old credential revocation, new lease expiry/scope and absence of values with `node scripts/p7/fixture-scanner.mjs fixtures/p7` plus provider audit.
5. Roll back by provider version/reference publication—not by storing secret bytes in configuration.

## Retention decision fields

Chat, Task projection/audit, Agent State, Temporal History, Artifact, backup and access-audit retention: **UNFILLED — HUMAN INPUT REQUIRED**. Legal hold and deletion SLA: **UNFILLED — HUMAN INPUT REQUIRED**. Until approved, automated production deletion is disabled.
