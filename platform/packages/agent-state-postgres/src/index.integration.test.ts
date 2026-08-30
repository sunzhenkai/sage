import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import type { AgentStateAdapter, CheckpointRef, AgentTaskSpecStorePort, BoundedRunReceiptStorePort, AgentEventStorePort, CheckpointStorePort } from '@sage/platform-ports';
import { PostgresAgentAuthorityStore, PostgresAgentStateAdapter, PostgresIdempotencyStore, PostgresTaskRunLogQuery, assertReferenceOnly } from './index.js';

const databaseUrl = process.env.P2_POSTGRES_URL;
const integration = describe.skipIf(!databaseUrl);

export function agentStateAdapterContract(name: string, getAdapter: () => AgentStateAdapter): void {
  describe(`${name} AgentStateAdapter contract`, () => {
    it('round-trips tenant-scoped Context, Session, Run, Checkpoint, and ordered Events', async () => {
      const adapter = getAdapter();
      const suffix = randomUUID();
      const tenantId = `tenant-${suffix}`;
      const now = new Date().toISOString();
      await adapter.putContext({ contextId: `context-${suffix}`, tenantId, revision: 1, state: { connection_ref: 'connection://crm/read', secret_ref: 'secret://crm/token', data: { locale: 'en' } }, updatedAt: now });
      await adapter.putSession({ sessionId: `session-${suffix}`, contextId: `context-${suffix}`, tenantId, status: 'open', createdAt: now, updatedAt: now });
      await adapter.putRun({ runId: `run-${suffix}`, sessionId: `session-${suffix}`, tenantId, status: 'running', correlation: { run_id: `run-${suffix}`, attempt: 1 }, startedAt: now });
      const checkpointRef = `checkpoint://run-${suffix}/1` as CheckpointRef;
      await adapter.putCheckpoint({ checkpointRef, runId: `run-${suffix}`, tenantId, sequence: 1, state: { artifact_ref: 'artifact://large-output' }, createdAt: now });
      await adapter.appendEvent({ runId: `run-${suffix}`, sequence: 2, type: 'tool.completed', payload: { artifact_ref: 'artifact://large-output' }, occurredAt: now }, tenantId);
      await adapter.appendEvent({ runId: `run-${suffix}`, sequence: 1, type: 'run.started', payload: { data: { safe: true } }, occurredAt: now }, tenantId);

      expect(await adapter.getContext(`context-${suffix}`, tenantId)).toMatchObject({ revision: 1, state: { secret_ref: 'secret://crm/token' } });
      expect(await adapter.getSession(`session-${suffix}`, tenantId)).toMatchObject({ status: 'open' });
      expect(await adapter.getRun(`run-${suffix}`, tenantId)).toMatchObject({ status: 'running', correlation: { run_id: `run-${suffix}` } });
      expect(await adapter.getCheckpoint(checkpointRef, tenantId)).toMatchObject({ checkpointRef, tenantId, state: { artifact_ref: 'artifact://large-output' } });
      expect((await adapter.listEvents(`run-${suffix}`, tenantId)).map((event) => event.sequence)).toEqual([1, 2]);
      expect(await adapter.getContext(`context-${suffix}`, 'other-tenant')).toBeUndefined();
    });

    it('is idempotent for repeated event/checkpoint delivery', async () => {
      const adapter = getAdapter();
      const suffix = randomUUID();
      const tenantId = `tenant-${suffix}`;
      const now = new Date().toISOString();
      await adapter.putContext({ contextId: `context-${suffix}`, tenantId, revision: 1, state: {}, updatedAt: now });
      await adapter.putSession({ sessionId: `session-${suffix}`, contextId: `context-${suffix}`, tenantId, status: 'open', createdAt: now, updatedAt: now });
      await adapter.putRun({ runId: `run-${suffix}`, sessionId: `session-${suffix}`, tenantId, status: 'running', correlation: { run_id: `run-${suffix}` }, startedAt: now });
      const checkpoint = { checkpointRef: `checkpoint://${suffix}` as CheckpointRef, runId: `run-${suffix}`, tenantId, sequence: 1, state: {}, createdAt: now };
      const event = { runId: `run-${suffix}`, sequence: 1, type: 'run.started', payload: {}, occurredAt: now };
      await adapter.putCheckpoint(checkpoint); await adapter.putCheckpoint(checkpoint);
      await adapter.appendEvent(event, tenantId); await adapter.appendEvent(event, tenantId);
      expect((await adapter.listEvents(`run-${suffix}`, tenantId))).toHaveLength(1);
    });
  });
}

integration('compose PostgreSQL integration', () => {
  let adapter: PostgresAgentStateAdapter;
  let idempotency: PostgresIdempotencyStore;
  beforeAll(async () => {
    adapter = new PostgresAgentStateAdapter({ connectionString: databaseUrl, connectionTimeoutMillis: 2_000 });
    idempotency = new PostgresIdempotencyStore({ connectionString: databaseUrl, connectionTimeoutMillis: 2_000 });
    await adapter.migrate();
    await adapter.migrate();
  });
  afterAll(async () => { await adapter.close(); await idempotency.close(); });
  agentStateAdapterContract('PostgreSQL', () => adapter);

  it('reports healthy against the real compose backend', async () => {
    expect(await adapter.health()).toMatchObject({ healthy: true });
    expect(await idempotency.health()).toMatchObject({ healthy: true });
  });

  it('atomically shares durable completion across store instances and releases precommit claims', async () => {
    const second = new PostgresIdempotencyStore({ connectionString: databaseUrl, connectionTimeoutMillis: 2_000 });
    const key = randomUUID();
    const lease = new Date(Date.now() + 60_000).toISOString();
    const claims = await Promise.all([idempotency.claim(key, 'owner-a', lease), second.claim(key, 'owner-b', lease)]);
    expect(claims.filter((claim) => claim.status === 'claimed')).toHaveLength(1);
    const owner = claims[0]?.status === 'claimed' ? 'owner-a' : 'owner-b';
    await (owner === 'owner-a' ? idempotency : second).complete(key, owner, { status: 'succeeded', output: { id: 1 } });
    expect(await idempotency.get(key)).toMatchObject({ status: 'completed', result: { status: 'succeeded' } });
    expect(await second.claim(key, 'owner-c', lease)).toMatchObject({ status: 'completed' });

    const precommit = randomUUID();
    await idempotency.claim(precommit, 'owner-a', lease);
    await idempotency.release(precommit, 'owner-a');
    expect(await second.claim(precommit, 'owner-b', lease)).toEqual({ status: 'claimed' });
    await second.release(precommit, 'owner-b');
    await second.close();
  });
});

describe('state and reference failure boundaries', () => {
  it('rejects secret/token values but permits runtime reference schemas', () => {
    expect(() => assertReferenceOnly({ secret_ref: 'secret://safe/reference' })).not.toThrow();
    expect(() => assertReferenceOnly({ data: { access_token: 'must-not-persist' } })).toThrow('SENSITIVE_DATA_LEAK_DETECTED');
    expect(() => assertReferenceOnly({ data: { note: 'Bearer abcdefghijklmnop' } })).toThrow('SENSITIVE_DATA_LEAK_DETECTED');
    expect(() => assertReferenceOnly({ data: { oversized: 'x'.repeat(8_193) } })).toThrow('INLINE_STATE_TOO_LARGE');
    expect(() => assertReferenceOnly({ artifact_ref: 'https://not-a-reference' } as never)).toThrow('INVALID_REFERENCE_ENVELOPE');
  });

  it('rejects token/password/restricted-result and unknown Run correlation fields before PostgreSQL writes', async () => {
    const unavailable = new PostgresAgentStateAdapter({ connectionString: 'postgres://sage:sage@127.0.0.1:1/sage', connectionTimeoutMillis: 100 });
    const base = { runId: 'run-1', sessionId: 'session-1', tenantId: 'tenant-1', status: 'running' as const, startedAt: new Date().toISOString() };
    for (const correlation of [
      { run_id: 'run-1', token: 'value' },
      { run_id: 'run-1', password: 'value' },
      { run_id: 'run-1', restricted_result: 'value' },
      { run_id: 'Bearer abcdefghijklmnop' }
    ]) await expect(unavailable.putRun({ ...base, correlation } as never)).rejects.toThrow('INVALID_RUNTIME_CORRELATION');
    await unavailable.close();
  });

  it('normalizes an unavailable backend to a stable observable error', async () => {
    const unavailable = new PostgresAgentStateAdapter({ connectionString: 'postgres://sage:sage@127.0.0.1:1/sage', connectionTimeoutMillis: 100 });
    expect(await unavailable.health()).toMatchObject({ healthy: false, detail: 'AGENT_STATE_BACKEND_UNAVAILABLE' });
    await expect(unavailable.getContext('missing', 'tenant')).rejects.toMatchObject({ code: 'AGENT_STATE_BACKEND_UNAVAILABLE', retryable: true });
    await unavailable.close();
  });
});


describe('malformed reference write guards', () => {
  it('rejects Context, Event, and Checkpoint payloads before attempting SQL', async () => {
    const unavailable = new PostgresAgentStateAdapter({ connectionString: 'postgres://sage:sage@127.0.0.1:1/sage', connectionTimeoutMillis: 100 });
    const now = new Date().toISOString();
    const malformed = { data: { secret_ref: 'plain-text-credential' } };
    await expect(unavailable.putContext({
      contextId: 'context-invalid', tenantId: 'tenant-invalid', revision: 1, state: malformed, updatedAt: now
    } as never)).rejects.toThrow('INVALID_REFERENCE_VALUE');
    await expect(unavailable.appendEvent({
      runId: 'run-invalid', sequence: 1, type: 'invalid', payload: malformed, occurredAt: now
    } as never, 'tenant-invalid')).rejects.toThrow('INVALID_REFERENCE_VALUE');
    await expect(unavailable.putCheckpoint({
      checkpointRef: 'checkpoint://tenant-invalid/run-invalid/1', runId: 'run-invalid', tenantId: 'tenant-invalid',
      sequence: 1, state: malformed, createdAt: now
    } as never)).rejects.toThrow('INVALID_REFERENCE_VALUE');
    await expect(unavailable.putCheckpoint({
      checkpointRef: 'checkpoint-plain-text', runId: 'run-invalid', tenantId: 'tenant-invalid',
      sequence: 1, state: {}, createdAt: now
    } as never)).rejects.toThrow('INVALID_REFERENCE_ENVELOPE');
    await unavailable.close();
  });
});

integration('PostgreSQL malformed reference non-persistence', () => {
  let adapter: PostgresAgentStateAdapter;
  let inspector: Pool;
  beforeAll(async () => {
    adapter = new PostgresAgentStateAdapter({ connectionString: databaseUrl, connectionTimeoutMillis: 2_000 });
    inspector = new Pool({ connectionString: databaseUrl, connectionTimeoutMillis: 2_000 });
    await adapter.migrate();
  });
  afterAll(async () => { await adapter.close(); await inspector.end(); });

  it('leaves no Context, Event, or Checkpoint value containing the rejected raw reference', async () => {
    const suffix = randomUUID();
    const tenantId = `tenant-malformed-${suffix}`;
    const contextId = `context-${suffix}`;
    const sessionId = `session-${suffix}`;
    const runId = `run-${suffix}`;
    const now = new Date().toISOString();
    await adapter.putContext({ contextId, tenantId, revision: 1, state: {}, updatedAt: now });
    await adapter.putSession({ sessionId, contextId, tenantId, status: 'open', createdAt: now, updatedAt: now });
    await adapter.putRun({ runId, sessionId, tenantId, status: 'running', correlation: { run_id: runId }, startedAt: now });

    const malformed = { data: { secret_ref: 'plain-text-credential' } };
    await expect(adapter.putContext({
      contextId: `rejected-${suffix}`, tenantId, revision: 1, state: malformed, updatedAt: now
    } as never)).rejects.toThrow('INVALID_REFERENCE_VALUE');
    await expect(adapter.appendEvent({
      runId, sequence: 99, type: 'rejected', payload: malformed, occurredAt: now
    } as never, tenantId)).rejects.toThrow('INVALID_REFERENCE_VALUE');
    await expect(adapter.putCheckpoint({
      checkpointRef: `checkpoint://${tenantId}/${runId}/99`, runId, tenantId, sequence: 99, state: malformed, createdAt: now
    } as never)).rejects.toThrow('INVALID_REFERENCE_VALUE');

    const leaked = await inspector.query<{ leaked: number }>(`
      SELECT COUNT(*)::integer AS leaked FROM (
        SELECT state::text AS payload FROM agent_contexts
        UNION ALL SELECT payload::text FROM agent_events
        UNION ALL SELECT state::text FROM agent_checkpoints
      ) persisted WHERE payload LIKE $1`, ['%plain-text-credential%']);
    expect(leaked.rows[0]?.leaked).toBe(0);
    expect((await inspector.query('SELECT 1 FROM agent_contexts WHERE tenant_id=$1 AND context_id=$2', [tenantId, `rejected-${suffix}`])).rowCount).toBe(0);
    expect((await inspector.query('SELECT 1 FROM agent_events WHERE tenant_id=$1 AND run_id=$2 AND sequence=99', [tenantId, runId])).rowCount).toBe(0);
    expect((await inspector.query('SELECT 1 FROM agent_checkpoints WHERE tenant_id=$1 AND run_id=$2 AND sequence=99', [tenantId, runId])).rowCount).toBe(0);
  });
});


describe('canonical authority migration contract', () => {
  it('is expand-only and retains the legacy checkpoint API alongside canonical tables', async () => {
    const { readFile } = await import('node:fs/promises');
    const sql = await readFile(new URL('../migrations/002_canonical_agent_authority.sql', import.meta.url), 'utf8');
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS agent_task_specs/i);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS agent_run_receipts/i);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS agent_event_writer_fences/i);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS agent_checkpoint_candidates/i);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS sealed_agent_checkpoints/i);
    expect(sql).not.toMatch(/\b(?:ALTER|DROP|TRUNCATE|DELETE|UPDATE)\b/i);
    expect(PostgresAgentStateAdapter.prototype.putCheckpoint).toBeTypeOf('function');
    expect(PostgresAgentAuthorityStore.prototype.stageCandidate).toBeTypeOf('function');
    expect(PostgresAgentAuthorityStore.prototype.sealCandidate).toBeTypeOf('function');
  });
});


integration('PostgreSQL canonical authority stores', () => {
  let legacy: PostgresAgentStateAdapter;
  let authority: PostgresAgentAuthorityStore;
  beforeAll(async () => {
    legacy = new PostgresAgentStateAdapter({ connectionString: databaseUrl, connectionTimeoutMillis: 2_000 });
    authority = new PostgresAgentAuthorityStore({ connectionString: databaseUrl, connectionTimeoutMillis: 2_000 });
    await legacy.migrate();
  });
  afterAll(async () => { await legacy.close(); await authority.close(); });

  it('persists immutable Spec/Receipt/Event/Checkpoint authority with tenant and fence isolation', async () => {
    const suffix = randomUUID(); const tenantId = `tenant-authority-${suffix}`;
    const digest = (value: string) => `sha256:${value.repeat(64).slice(0, 64)}`;
    const spec = { schemaVersion: '1', specRef: `spec://${tenantId}/${suffix}`, specDigest: digest('a'), taskId: `task-${suffix}`, runId: `run-${suffix}`, attemptId: `attempt-${suffix}`, tenantId, releaseRef: 'release://one', releaseDigest: digest('b'), principalRef: 'principal://one', goalRef: 'artifact://goal', engineId: 'reference', skillRefs: [], modelRouteRef: 'model://one', contextPlanRef: 'context://one', capabilityGrantRef: 'grant://one', executionPolicyRef: 'policy://one', boundsRef: 'bounds://one', governanceRef: 'governance://one', admittedAt: new Date().toISOString() } as unknown as Parameters<AgentTaskSpecStorePort['putSpec']>[0]['spec'];
    expect(await authority.putSpec({ tenantId, spec })).toMatchObject({ status: 'stored' });
    expect(await authority.putSpec({ tenantId, spec })).toMatchObject({ status: 'existing' });
    expect(await authority.putSpec({ tenantId, spec: { ...spec, specDigest: digest('c') } })).toEqual({ status: 'conflict', code: 'SPEC_REF_CONFLICT' });
    expect(await authority.getSpec({ tenantId: `other-${tenantId}`, specRef: spec.specRef, expectedDigest: spec.specDigest })).toBeUndefined();

    const receipt = { schemaVersion: '1', receiptRef: `receipt://${suffix}`, invocationId: `invoke-${suffix}`, specDigest: spec.specDigest, outcome: 'COMPLETED', eventRange: { first: 1, last: 1 }, receiptRefs: [], artifactRefs: [] } as unknown as Parameters<BoundedRunReceiptStorePort['putReceipt']>[0]['receipt'];
    expect(await authority.putReceipt({ tenantId, receipt, receiptDigest: digest('d') })).toMatchObject({ status: 'stored' });
    expect(await authority.putReceipt({ tenantId, receipt, receiptDigest: digest('d') })).toMatchObject({ status: 'existing' });
    expect(await authority.putReceipt({ tenantId, receipt, receiptDigest: digest('e') })).toEqual({ status: 'conflict', code: 'RECEIPT_CONFLICT' });

    const acquire = await authority.acquireWriterFence({ tenantId, taskId: spec.taskId, runId: spec.runId, attemptId: spec.attemptId, ownerToken: 'writer-a' });
    if (acquire.status !== 'acquired') throw new Error('expected acquired fence');
    expect(await authority.acquireWriterFence({ ...acquire.fence, ownerToken: 'writer-b' })).toEqual({ status: 'held', code: 'EVENT_WRITER_FENCED' });
    const event = { schemaVersion: '2', eventId: `event-${suffix}`, taskId: spec.taskId, runId: spec.runId, attemptId: spec.attemptId, invocationId: receipt.invocationId, specDigest: spec.specDigest, sequence: 1, type: 'run.started', payload: { source: 'integration' }, receiptRefs: [], artifactRefs: [] } as unknown as Parameters<AgentEventStorePort['appendEvent']>[0]['event'];
    expect(await authority.appendEvent({ fence: acquire.fence, event })).toMatchObject({ status: 'appended' });
    expect(await authority.appendEvent({ fence: acquire.fence, event })).toMatchObject({ status: 'existing' });
    expect(await authority.appendEvent({ fence: { ...acquire.fence, epoch: acquire.fence.epoch + 1 }, event: { ...event, sequence: 2, eventId: `event-stale-${suffix}` } })).toEqual({ status: 'conflict', code: 'EVENT_FENCE_LOST' });
    expect(await authority.appendEvent({ fence: acquire.fence, event: { ...event, sequence: 3, eventId: `event-gap-${suffix}` } })).toEqual({ status: 'conflict', code: 'EVENT_SEQUENCE_CONFLICT' });

    const candidate = { schemaVersion: '1', candidateDigest: digest('f'), taskId: spec.taskId, runId: spec.runId, attemptId: spec.attemptId, specDigest: spec.specDigest, sequence: 1, state: { schemaVersion: '1', observationRefs: [], receiptRefs: [] }, engineCodec: 'reference@1', runtimeContractMajor: 1, receiptRefs: [] } as unknown as Parameters<CheckpointStorePort['stageCandidate']>[0]['candidate'];
    expect(await authority.stageCandidate({ tenantId, fence: acquire.fence, candidate })).toMatchObject({ status: 'staged' });
    expect(await authority.stageCandidate({ tenantId, fence: acquire.fence, candidate: { ...candidate, candidateDigest: digest('c') } })).toEqual({ status: 'conflict', code: 'CHECKPOINT_CANDIDATE_CONFLICT' });
    expect(await authority.getSealedCheckpoint({ tenantId, checkpointRef: `checkpoint://sealed/${candidate.candidateDigest.slice('sha256:'.length)}`, taskId: spec.taskId, runId: spec.runId, attemptId: spec.attemptId, specDigest: spec.specDigest, engineCodec: 'reference@1', runtimeContractMajor: 1 })).toBeUndefined();
    const [sealed, replayedSeal] = await Promise.all([
      authority.sealCandidate({ tenantId, fence: acquire.fence, candidateDigest: candidate.candidateDigest }),
      authority.sealCandidate({ tenantId, fence: acquire.fence, candidateDigest: candidate.candidateDigest }),
    ]);
    expect([sealed.status, replayedSeal.status].sort()).toEqual(['existing', 'sealed']);
    if (sealed.status === 'conflict' || replayedSeal.status === 'conflict') throw new Error('expected atomic sealed checkpoint');
    expect(replayedSeal.checkpoint).toEqual(sealed.checkpoint);
    expect(await authority.getSealedCheckpoint({ tenantId, checkpointRef: sealed.checkpoint.checkpointRef, taskId: spec.taskId, runId: spec.runId, attemptId: spec.attemptId, specDigest: spec.specDigest, engineCodec: 'reference@1', runtimeContractMajor: 1 })).toEqual(sealed.checkpoint);
    expect(await authority.getSealedCheckpoint({ tenantId, checkpointRef: sealed.checkpoint.checkpointRef, taskId: spec.taskId, runId: spec.runId, attemptId: spec.attemptId, specDigest: `${spec.specDigest}-other`, engineCodec: 'reference@1', runtimeContractMajor: 1 })).toBeUndefined();
    expect(await authority.getSealedCheckpoint({ tenantId, checkpointRef: sealed.checkpoint.checkpointRef, taskId: spec.taskId, runId: spec.runId, attemptId: spec.attemptId, specDigest: spec.specDigest, engineCodec: 'other@1', runtimeContractMajor: 1 })).toBeUndefined();
    expect(await authority.getSealedCheckpoint({ tenantId, checkpointRef: sealed.checkpoint.checkpointRef, taskId: spec.taskId, runId: spec.runId, attemptId: spec.attemptId, specDigest: spec.specDigest, engineCodec: 'reference@1', runtimeContractMajor: 2 })).toBeUndefined();
    expect(await authority.getSealedCheckpoint({ tenantId: `other-${tenantId}`, checkpointRef: sealed.checkpoint.checkpointRef, taskId: spec.taskId, runId: spec.runId, attemptId: spec.attemptId, specDigest: spec.specDigest, engineCodec: 'reference@1', runtimeContractMajor: 1 })).toBeUndefined();
  });
});


integration('PostgreSQL Task run log queries', () => {
  let authority: PostgresAgentAuthorityStore;
  let runLogs: PostgresTaskRunLogQuery;
  beforeAll(async () => {
    const legacy = new PostgresAgentStateAdapter({ connectionString: databaseUrl, connectionTimeoutMillis: 2_000 });
    await legacy.migrate();
    await legacy.close();
    authority = new PostgresAgentAuthorityStore({ connectionString: databaseUrl, connectionTimeoutMillis: 2_000 });
    runLogs = new PostgresTaskRunLogQuery({ connectionString: databaseUrl, connectionTimeoutMillis: 2_000 });
  });
  afterAll(async () => { await authority.close(); await runLogs.close(); });

  it('summarizes attempts and pages canonical events with tenant isolation', async () => {
    const suffix = randomUUID(); const tenantId = `tenant-runlogs-${suffix}`;
    const taskId = `task-${suffix}`; const digest = `sha256:${'b'.repeat(64)}`;
    const writeEvent = async (attemptId: string, sequence: number, eventId: string) => {
      const acquire = await authority.acquireWriterFence({ tenantId, taskId, runId: `run-${suffix}`, attemptId, ownerToken: 'writer-runlogs' });
      if (acquire.status !== 'acquired') throw new Error('expected acquired fence');
      const appended = await authority.appendEvent({ fence: acquire.fence, event: { schemaVersion: '2', eventId, taskId, runId: `run-${suffix}`, attemptId, invocationId: `invoke-${attemptId}`, specDigest: digest, sequence, type: 'run.started', payload: { step: sequence } } });
      if (appended.status !== 'appended') throw new Error(`expected appended event, got ${appended.status}`);
    };
    await writeEvent(`attempt-a-${suffix}`, 1, `event-a1-${suffix}`);
    await writeEvent(`attempt-a-${suffix}`, 2, `event-a2-${suffix}`);
    await writeEvent(`attempt-b-${suffix}`, 1, `event-b1-${suffix}`);

    const summaries = await runLogs.listAttemptSummaries({ tenantId, taskId });
    expect(summaries.map((attempt) => attempt.attemptId)).toEqual([`attempt-b-${suffix}`, `attempt-a-${suffix}`]);
    const attemptA = summaries.find((attempt) => attempt.attemptId === `attempt-a-${suffix}`);
    expect(attemptA).toMatchObject({ eventCount: 2, firstSequence: 1, lastSequence: 2 });

    const firstPage = await runLogs.listRunLogEvents({ tenantId, taskId, runId: `run-${suffix}`, attemptId: `attempt-a-${suffix}`, limit: 1 });
    expect(firstPage.map((event) => event.sequence)).toEqual([1]);
    expect(firstPage[0]).toMatchObject({ taskId, runId: `run-${suffix}`, attemptId: `attempt-a-${suffix}`, type: 'run.started' });
    const tailPage = await runLogs.listRunLogEvents({ tenantId, taskId, runId: `run-${suffix}`, attemptId: `attempt-a-${suffix}`, fromSequence: 2, limit: 1 });
    expect(tailPage.map((event) => event.sequence)).toEqual([2]);
    expect(await runLogs.listRunLogEvents({ tenantId, taskId, runId: `run-${suffix}`, attemptId: `attempt-missing-${suffix}` })).toEqual([]);
    expect(await runLogs.listAttemptSummaries({ tenantId: `other-${tenantId}`, taskId })).toEqual([]);
    expect(await runLogs.listAttemptSummaries({ tenantId, taskId: `task-unknown-${suffix}` })).toEqual([]);
  });
});


integration('PostgreSQL Release Registry', () => {
  let adapter: PostgresAgentStateAdapter;
  let database: Pool;

  const sha = (letter: string): string => `sha256:${letter.repeat(64)}`;
  const fixture = (tenantId: string, releaseLetter: string, contentLetter: string, lockLetter: string) => ({
    tenantId,
    ownerNamespace: 'package-platform',
    packageId: 'reference-summary',
    packageVersion: '1.0.0',
    releaseRef: `release://${sha(releaseLetter)}`,
    releaseId: sha(releaseLetter),
    contentDigest: sha(contentLetter),
    lockDigest: sha(lockLetter),
    payload: {
      schemaVersion: '1',
      releaseRef: `release://${sha(releaseLetter)}`,
      releaseId: sha(releaseLetter),
      packageId: 'reference-summary',
      packageVersion: '1.0.0',
      contentDigest: sha(contentLetter),
      lockDigest: sha(lockLetter)
    }
  });

  const insertRelease = async (client: Pool, row: ReturnType<typeof fixture>): Promise<void> => {
    await client.query(`INSERT INTO agent_package_releases
      (tenant_id, owner_namespace, package_id, package_version, release_ref, release_id,
       content_digest, lock_digest, release_payload, lock_payload, attestation_refs)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11)`, [
      row.tenantId, row.ownerNamespace, row.packageId, row.packageVersion, row.releaseRef, row.releaseId,
      row.contentDigest, row.lockDigest, JSON.stringify(row.payload), JSON.stringify({ schemaVersion: '1', lockDigest: row.lockDigest }),
      [`attestation://${row.tenantId}/${row.releaseId}`]
    ]);
  };

  const insertChannel = async (client: Pool, row: ReturnType<typeof fixture>, channel: string): Promise<void> => {
    await client.query(`INSERT INTO agent_release_channels
      (tenant_id, owner_namespace, package_id, channel, release_ref, pointer_revision)
      VALUES ($1,$2,$3,$4,$5,0)`, [row.tenantId, row.ownerNamespace, row.packageId, channel, row.releaseRef]);
  };

  const appendAudit = async (client: { query: Pool['query'] }, input: {
    tenantId: string; channel: string; action: 'publish' | 'rollback'; fromReleaseRef: string | null;
    toReleaseRef: string; releaseDigest: string; reason: string;
  }): Promise<void> => {
    await client.query(`INSERT INTO agent_release_audit
      (tenant_id, owner_namespace, package_id, channel, action, actor_ref, reason,
       from_release_ref, to_release_ref, release_digest, result)
      VALUES ($1,'package-platform','reference-summary',$2,$3,'principal://integration',$4,$5,$6,$7,'accepted')`, [
      input.tenantId, input.channel, input.action, input.reason, input.fromReleaseRef,
      input.toReleaseRef, input.releaseDigest
    ]);
  };

  const transition = async (row: ReturnType<typeof fixture>, channel: string, targetRef: string, expectedRevision: number, action: 'publish' | 'rollback', reason: string, fromReleaseRef = row.releaseRef): Promise<void> => {
    const client = await database.connect();
    try {
      await client.query('BEGIN');
      const update = await client.query<{ release_ref: string; pointer_revision: number }>(`UPDATE agent_release_channels
        SET release_ref=$1, pointer_revision=pointer_revision+1, updated_at=clock_timestamp()
        WHERE tenant_id=$2 AND owner_namespace=$3 AND package_id=$4 AND channel=$5
          AND pointer_revision=$6
        RETURNING release_ref, pointer_revision`, [targetRef, row.tenantId, row.ownerNamespace, row.packageId, channel, expectedRevision]);
      expect(update.rowCount).toBe(1);
      await appendAudit(client, {
        tenantId: row.tenantId, channel, action, reason, fromReleaseRef,
        toReleaseRef: targetRef, releaseDigest: row.contentDigest
      });
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  };

  beforeAll(async () => {
    adapter = new PostgresAgentStateAdapter({ connectionString: databaseUrl, connectionTimeoutMillis: 2_000 });
    database = new Pool({ connectionString: databaseUrl, connectionTimeoutMillis: 2_000, max: 8 });
    await adapter.migrate();
  });
  afterAll(async () => { await adapter.close(); await database.end(); });

  it('enforces tenant scope, CAS, immutable rows, atomic audit and new Attempt snapshots', async () => {
    const suffix = randomUUID();
    const tenantA = `tenant-release-a-${suffix}`;
    const tenantB = `tenant-release-b-${suffix}`;
    const releaseA = fixture(tenantA, 'a', 'b', 'c');
    const releaseB = fixture(tenantA, 'd', 'e', 'f');
    const foreignRelease = fixture(tenantB, '1', '2', '3');
    await insertRelease(database, releaseA);
    await insertRelease(database, releaseB);
    await insertRelease(database, foreignRelease);
    await insertChannel(database, releaseA, 'stable');
    await insertChannel(database, foreignRelease, 'stable');

    expect((await database.query('SELECT release_ref FROM agent_package_releases WHERE tenant_id=$1 AND release_ref=$2', [tenantA, foreignRelease.releaseRef])).rowCount).toBe(0);
    expect((await database.query('SELECT release_ref FROM agent_package_releases WHERE tenant_id=$1 AND release_ref=$2', [tenantB, releaseA.releaseRef])).rowCount).toBe(0);
    expect((await database.query('SELECT release_ref FROM agent_release_channels WHERE tenant_id=$1 AND channel=$2', [tenantA, 'stable'])).rows[0]?.release_ref).toBe(releaseA.releaseRef);
    expect((await database.query('SELECT release_ref FROM agent_release_channels WHERE tenant_id=$1 AND channel=$2', [tenantB, 'stable'])).rows[0]?.release_ref).toBe(foreignRelease.releaseRef);

    await insertChannel(database, releaseA, 'cas');
    const casResults = await Promise.all([1, 2].map(() => database.query(`UPDATE agent_release_channels
      SET release_ref=$1, pointer_revision=pointer_revision+1
      WHERE tenant_id=$2 AND owner_namespace=$3 AND package_id=$4 AND channel='cas' AND pointer_revision=0
      RETURNING pointer_revision`, [releaseB.releaseRef, tenantA, releaseA.ownerNamespace, releaseA.packageId])));
    expect(casResults.filter((result) => result.rowCount === 1)).toHaveLength(1);
    expect(casResults.filter((result) => result.rowCount === 0)).toHaveLength(1);
    expect((await database.query('SELECT release_ref, pointer_revision::integer AS pointer_revision FROM agent_release_channels WHERE tenant_id=$1 AND channel=$2', [tenantA, 'cas'])).rows[0]).toMatchObject({ release_ref: releaseB.releaseRef, pointer_revision: 1 });

    await insertChannel(database, releaseA, 'atomic');
    const atomic = await database.connect();
    try {
      await atomic.query('BEGIN');
      await atomic.query(`UPDATE agent_release_channels SET release_ref=$1, pointer_revision=1
        WHERE tenant_id=$2 AND owner_namespace=$3 AND package_id=$4 AND channel='atomic' AND pointer_revision=0`, [releaseB.releaseRef, tenantA, releaseA.ownerNamespace, releaseA.packageId]);
      await appendAudit(atomic, { tenantId: tenantA, channel: 'atomic', action: 'publish', reason: 'atomic publish test', fromReleaseRef: releaseA.releaseRef, toReleaseRef: releaseB.releaseRef, releaseDigest: releaseB.contentDigest });
      await expect(atomic.query(`INSERT INTO agent_release_audit
        (tenant_id, owner_namespace, package_id, channel, action, actor_ref, reason, result)
        VALUES ($1,'package-platform','reference-summary','atomic','publish','principal://integration','', 'accepted')`, [tenantA])).rejects.toThrow();
      await atomic.query('ROLLBACK');
    } finally {
      atomic.release();
    }
    expect((await database.query('SELECT release_ref, pointer_revision::integer AS pointer_revision FROM agent_release_channels WHERE tenant_id=$1 AND channel=$2', [tenantA, 'atomic'])).rows[0]).toMatchObject({ release_ref: releaseA.releaseRef, pointer_revision: 0 });
    expect((await database.query("SELECT COUNT(*)::integer AS count FROM agent_release_audit WHERE tenant_id=$1 AND channel='atomic'", [tenantA])).rows[0]?.count).toBe(0);

    await transition(releaseA, 'stable', releaseB.releaseRef, 0, 'publish', 'publish verified B');
    await database.query(`INSERT INTO agent_task_specs (tenant_id, spec_ref, spec_digest, task_id, run_id, attempt_id, spec)
      VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)`, [tenantA, `spec://${suffix}/before`, sha('4'), `task-${suffix}`, `run-${suffix}`, `attempt-before-${suffix}`, JSON.stringify({ releaseRef: releaseB.releaseRef, target: 'target://before' })]);
    await transition(releaseA, 'stable', releaseA.releaseRef, 1, 'rollback', 'rollback to verified predecessor A', releaseB.releaseRef);
    await database.query(`INSERT INTO agent_task_specs (tenant_id, spec_ref, spec_digest, task_id, run_id, attempt_id, spec)
      VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)`, [tenantA, `spec://${suffix}/after`, sha('5'), `task-${suffix}`, `run-${suffix}`, `attempt-after-${suffix}`, JSON.stringify({ releaseRef: releaseA.releaseRef, target: 'target://after' })]);

    expect((await database.query('SELECT release_ref, pointer_revision::integer AS pointer_revision FROM agent_release_channels WHERE tenant_id=$1 AND channel=$2', [tenantA, 'stable'])).rows[0]).toMatchObject({ release_ref: releaseA.releaseRef, pointer_revision: 2 });
    expect((await database.query("SELECT action, from_release_ref, to_release_ref FROM agent_release_audit WHERE tenant_id=$1 AND channel='stable' ORDER BY audit_id", [tenantA])).rows).toMatchObject([
      { action: 'publish', from_release_ref: releaseA.releaseRef, to_release_ref: releaseB.releaseRef },
      { action: 'rollback', from_release_ref: releaseB.releaseRef, to_release_ref: releaseA.releaseRef }
    ]);
    expect((await database.query('SELECT spec->>\'releaseRef\' AS release_ref FROM agent_task_specs WHERE tenant_id=$1 ORDER BY attempt_id DESC', [tenantA])).rows).toEqual([{ release_ref: releaseB.releaseRef }, { release_ref: releaseA.releaseRef }]);

    await expect(database.query('UPDATE agent_package_releases SET content_digest=$1 WHERE tenant_id=$2 AND release_ref=$3', [sha('6'), tenantA, releaseA.releaseRef])).rejects.toThrow(/AGENT_RELEASE_IMMUTABLE/);
    await expect(database.query('DELETE FROM agent_package_releases WHERE tenant_id=$1 AND release_ref=$2', [tenantA, releaseA.releaseRef])).rejects.toThrow(/AGENT_RELEASE_IMMUTABLE/);
    await expect(database.query("UPDATE agent_release_audit SET reason='tampered' WHERE tenant_id=$1 AND channel='stable'", [tenantA])).rejects.toThrow(/AGENT_RELEASE_IMMUTABLE/);
    expect((await database.query('SELECT content_digest FROM agent_package_releases WHERE tenant_id=$1 AND release_ref=$2', [tenantA, releaseA.releaseRef])).rows[0]?.content_digest).toBe(releaseA.contentDigest);
  });
});
