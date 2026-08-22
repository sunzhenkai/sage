import {readFile} from 'node:fs/promises';
import {describe, expect, it} from 'vitest';
import {TaskLifecyclePathSchema, TaskOwnerStateSchema, TaskProjectionSchema, TaskRoutingRecordSchema, decideTaskLifecycleAdmission} from './index.js';
import {Value} from 'typebox/value';

const migrationUrl = new URL('../migrations/002_durable_coordinator_task_persistence.sql', import.meta.url);

describe('durable coordinator task persistence migration', () => {
  it('is additive, rerunnable, and backfills legacy ownership metadata', async () => {
    const sql = await readFile(migrationUrl, 'utf8');
    expect(sql.startsWith('BEGIN;')).toBe(true);
    expect(sql.endsWith('COMMIT;\n')).toBe(true);
    for (const column of [
      'lifecycle_path', 'owner_token', 'owner_state', 'start_idempotency_key',
      'adapter_ref', 'runtime_ref', 'logical_cursor', 'projection_freshness',
      'authority_receipt_digest', 'last_reconciled_at', 'projection_audit_version'
    ]) expect(sql).toContain(column);
    expect(sql).toContain("'LEGACY_TEMPORAL_TASK'");
    expect(sql).toContain("UPDATE task_routing");
    expect(sql).toContain("UPDATE task_projection");
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS');
    expect(sql).toContain('CREATE UNIQUE INDEX IF NOT EXISTS task_routing_start_key_idx');
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS task_projection_path_freshness_idx');
    expect(sql).not.toMatch(/DROP\s+TABLE/i);
    expect(sql).not.toMatch(/DROP\s+COLUMN/i);
    expect(sql).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(sql).not.toMatch(/\bTRUNCATE\b/i);
  });

  it('exposes the migration metadata as optional additive domain fields', () => {
    expect(Value.Check(TaskLifecyclePathSchema, 'LEGACY_TEMPORAL_TASK')).toBe(true);
    expect(Value.Check(TaskLifecyclePathSchema, 'UNKNOWN_PATH')).toBe(false);
    expect(Value.Check(TaskOwnerStateSchema, 'START_UNKNOWN')).toBe(true);
    expect(Value.Check(TaskOwnerStateSchema, 'BROKEN')).toBe(false);
    const snapshot = {
      schemaVersion: '1', snapshotId: 'snapshot-1', routeDecisionId: 'route-1', targetId: 'target-1',
      targetProfileVersion: 'target-v1', clusterId: 'cluster-1', isolationKey: 'tenant-isolation', endpoint: 'target.example:1',
      namespace: 'namespace-1', taskQueue: 'queue-1', credentialRef: 'secret://target/1', taskType: 'sage.agent-task.v1',
      taskTypeVersion: 'task-v1', policyVersion: 'policy-v1', registryVersion: 'registry-v1', environment: 'development',
      region: 'region-1', residency: 'residency-1', selectedAt: '2026-08-12T00:00:00.000Z'
    };
    const input = {
      schemaVersion: '1', taskType: 'sage.agent-task.v1', taskId: 'task-1', tenantId: 'tenant-1', workflowId: 'workflow-1',
      targetId: 'target-1', inputRef: 'task-input://tenant-1/task-1', attempt: 1, maxSlices: 1, sliceDelayMs: 1,
      slice: {maxTurns: 1, maxToolCalls: 0, maxTokens: 1, timeoutMs: 100}
    };
    const routing = {
      schemaVersion: '1', tenantId: 'tenant-1', taskId: 'task-1', workflowId: 'workflow-1', taskType: 'sage.agent-task.v1',
      status: 'start_pending', snapshot, decision: {
        schemaVersion: '1', decisionId: 'decision-1', taskId: 'task-1', taskType: 'sage.agent-task.v1', tenantId: 'tenant-1',
        actorId: 'actor-1', contextId: 'context-1', environment: 'development', region: 'region-1', residency: 'residency-1',
        registryVersion: 'registry-v1', policyVersion: 'policy-v1', candidates: [], explanation: 'selected', decidedAt: '2026-08-12T00:00:00.000Z'
      }, startEnvelope: {schemaVersion: '1', workflowType: 'AgentTaskWorkflow', workflowId: 'workflow-1', taskQueue: 'queue-1', snapshotId: 'snapshot-1', input},
      createdAt: '2026-08-12T00:00:00.000Z', lifecyclePath: 'DURABLE_COORDINATOR_V2', ownerToken: 'owner-token', ownerState: 'PREPARED',
      startIdempotencyKey: 'start-key', adapterRef: 'adapter://v2', runtimeRef: 'runtime://v2', logicalCursor: 'cursor://0'
    };
    expect(Value.Check(TaskRoutingRecordSchema, routing)).toBe(true);
    expect(Value.Check(TaskRoutingRecordSchema, {...routing, lifecyclePath: 'UNKNOWN_PATH'})).toBe(false);
    expect(Value.Check(TaskProjectionSchema, {
      schemaVersion: '1', taskType: 'sage.agent-task.v1', tenantId: 'tenant-1', taskId: 'task-1', workflowId: 'workflow-1',
      targetId: 'target-1', attempt: 1, status: 'running', revision: 0, projectionSource: 'history', historyEventId: '0',
      projectionUpdatedAt: '2026-08-12T00:00:00.000Z', historyObservedAt: '2026-08-12T00:00:00.000Z',
      lifecyclePath: 'DURABLE_COORDINATOR_V2', ownerToken: 'owner-token', adapterRef: 'adapter://v2', runtimeRef: 'runtime://v2',
      logicalCursor: 'cursor://0', projectionFreshness: 'fresh', projectionAuditVersion: 0
    })).toBe(true);
  });
});


describe('TaskLifecycleAdmissionPolicy', () => {
  it('selects V2 only for a new task when admission is enabled', () => {
    expect(decideTaskLifecycleAdmission({ v2Enabled: true })).toEqual({ lifecyclePath: 'DURABLE_COORDINATOR_V2', reason: 'v2_enabled_new_task' });
    expect(decideTaskLifecycleAdmission({ v2Enabled: false })).toEqual({ lifecyclePath: 'LEGACY_TEMPORAL_TASK', reason: 'legacy_enabled_new_task' });
  });
  it('preserves the persisted owner when V2 is disabled, including active and unknown-start states', () => {
    expect(decideTaskLifecycleAdmission({ v2Enabled: false }, { lifecyclePath: 'DURABLE_COORDINATOR_V2', ownerState: 'STARTED' })).toEqual({ lifecyclePath: 'DURABLE_COORDINATOR_V2', ownerState: 'STARTED', reason: 'existing_owner_preserved' });
    expect(decideTaskLifecycleAdmission({ v2Enabled: false }, { lifecyclePath: 'DURABLE_COORDINATOR_V2', ownerState: 'START_UNKNOWN' })).toEqual({ lifecyclePath: 'DURABLE_COORDINATOR_V2', ownerState: 'START_UNKNOWN', reason: 'existing_owner_preserved' });
  });
});

  it('runs a reversible dual-path rollback drill without duplicating an owner', () => {
    const rollback = { v2Enabled: false };
    const newTask = decideTaskLifecycleAdmission(rollback);
    const activeV2 = decideTaskLifecycleAdmission(rollback, { lifecyclePath: 'DURABLE_COORDINATOR_V2', ownerState: 'STARTED' });
    const unknownV2 = decideTaskLifecycleAdmission(rollback, { lifecyclePath: 'DURABLE_COORDINATOR_V2', ownerState: 'START_UNKNOWN' });
    const legacy = decideTaskLifecycleAdmission(rollback, { lifecyclePath: 'LEGACY_TEMPORAL_TASK', ownerState: 'STARTED' });

    expect(newTask).toEqual({ lifecyclePath: 'LEGACY_TEMPORAL_TASK', reason: 'legacy_enabled_new_task' });
    expect(activeV2).toEqual({ lifecyclePath: 'DURABLE_COORDINATOR_V2', ownerState: 'STARTED', reason: 'existing_owner_preserved' });
    expect(unknownV2).toEqual({ lifecyclePath: 'DURABLE_COORDINATOR_V2', ownerState: 'START_UNKNOWN', reason: 'existing_owner_preserved' });
    expect(legacy).toEqual({ lifecyclePath: 'LEGACY_TEMPORAL_TASK', ownerState: 'STARTED', reason: 'existing_owner_preserved' });
    expect(newTask.lifecyclePath).not.toBe(activeV2.lifecyclePath);
    expect(unknownV2.lifecyclePath).toBe(activeV2.lifecyclePath);
  });

  it('keeps every failure scenario on one persisted path and target', () => {
    const scenarios = [
      { name: 'target-unavailable', record: { lifecyclePath: 'DURABLE_COORDINATOR_V2' as const, ownerState: 'TARGET_UNAVAILABLE' as const } },
      { name: 'start-response-lost', record: { lifecyclePath: 'DURABLE_COORDINATOR_V2' as const, ownerState: 'START_UNKNOWN' as const } },
      { name: 'stale-projection', record: { lifecyclePath: 'DURABLE_COORDINATOR_V2' as const, ownerState: 'STARTED' as const } },
      { name: 'rollback-race', record: { lifecyclePath: 'DURABLE_COORDINATOR_V2' as const, ownerState: 'STARTING' as const } }
    ];
    for (const scenario of scenarios) {
      const decision = decideTaskLifecycleAdmission({ v2Enabled: false }, scenario.record);
      expect(decision.lifecyclePath, scenario.name).toBe('DURABLE_COORDINATOR_V2');
      expect(decision.reason, scenario.name).toBe('existing_owner_preserved');
    }
    const newTask = decideTaskLifecycleAdmission({ v2Enabled: false });
    expect(newTask.lifecyclePath).toBe('LEGACY_TEMPORAL_TASK');
    expect(scenarios.map(({ record }) => record.lifecyclePath)).toEqual([
      'DURABLE_COORDINATOR_V2', 'DURABLE_COORDINATOR_V2', 'DURABLE_COORDINATOR_V2', 'DURABLE_COORDINATOR_V2'
    ]);
  });

describe('task package input migration', () => {
  it('is additive, rerunnable, and creates the package input table', async () => {
    const sql = await readFile(new URL('../migrations/003_task_package_input.sql', import.meta.url), 'utf8');
    expect(sql.startsWith('BEGIN;')).toBe(true);
    expect(sql.endsWith('COMMIT;\n')).toBe(true);
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS task_package_input');
    expect(sql).toContain('PRIMARY KEY (tenant_id, task_id)');
    expect(sql).toContain('assembled_input text NOT NULL');
    expect(sql).toContain('asset_digests jsonb NOT NULL');
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS task_package_input_release_idx');
    expect(sql).not.toMatch(/DROP\s+TABLE/i);
    expect(sql).not.toMatch(/DROP\s+COLUMN/i);
    expect(sql).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(sql).not.toMatch(/\bTRUNCATE\b/i);
  });
});
