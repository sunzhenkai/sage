import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ChatStore } from './index.js';

const databaseUrl = process.env.WORKSPACE_POSTGRES_URL;
const integration = describe.skipIf(!databaseUrl);
let store: ChatStore;
let inspector: Pool;

beforeAll(async () => {
  if (!databaseUrl) return;
  store = new ChatStore({ connectionString: databaseUrl });
  inspector = new Pool({ connectionString: databaseUrl });
  await store.migrate();
});
afterAll(async () => {
  if (!databaseUrl) return;
  await store.close();
  await inspector.end();
});

integration('Workspace Chat history PostgreSQL integration', () => {
  it('isolates tenants, filters status, and computes retention eligibility', async () => {
    const suffix = randomUUID();
    const tenant = `tenant-history-${suffix}`;
    const other = `tenant-other-${suffix}`;
    await store.createSession(tenant, `session-open-${suffix}`, 'Open title', '2026-08-14T01:00:00.000Z');
    await store.createSession(tenant, `session-closed-${suffix}`, 'Closed title', '2026-08-14T02:00:00.000Z');
    await inspector.query("UPDATE chat_sessions SET status='closed',updated_at=$3 WHERE tenant_id=$1 AND session_id=$2", [tenant, `session-closed-${suffix}`, '2026-08-14T02:01:00.000Z']);
    await store.createSession(other, `session-secret-${suffix}`, 'Other tenant', '2026-08-14T03:00:00.000Z');

    const all = await store.listSessions(tenant);
    expect(all.items.map((item) => item.sessionId)).toEqual([`session-closed-${suffix}`, `session-open-${suffix}`]);
    expect((await store.listSessions(tenant, { status: 'open' })).items).toHaveLength(1);
    expect((await store.listSessions(tenant, { status: 'closed' })).items).toHaveLength(1);
    expect((await store.listSessions(tenant, { q: 'Open %_' })).items).toHaveLength(0);
    expect(all.items[0]?.retentionEligibleAt).toBe('2026-09-13T02:01:00.000Z');
  });

  it('preserves microseconds, uses session id tie-break, and never repeats stable keys', async () => {
    const suffix = randomUUID();
    const tenant = `tenant-cursor-${suffix}`;
    const ids = [`session-a-${suffix}`, `session-b-${suffix}`, `session-c-${suffix}`];
    for (const id of ids) await store.createSession(tenant, id, id, '2026-08-14T00:00:00.000Z');
    await inspector.query(`UPDATE chat_sessions SET updated_at = CASE session_id
      WHEN $2 THEN '2026-08-14T04:00:00.123456Z'::timestamptz
      WHEN $3 THEN '2026-08-14T04:00:00.123455Z'::timestamptz
      ELSE '2026-08-14T04:00:00.123455Z'::timestamptz END
      WHERE tenant_id=$1`, [tenant, ids[0], ids[1]]);

    const seen: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await store.listSessions(tenant, { limit: 1, ...(cursor === undefined ? {} : { cursor }) });
      seen.push(...page.items.map((item) => item.sessionId));
      cursor = page.nextCursor;
    } while (cursor !== undefined);
    expect(seen).toEqual([ids[0], ids[2], ids[1]]);
    expect(new Set(seen).size).toBe(3);
  });

  it('documents continuation consistency and first-page refresh convergence', async () => {
    const suffix = randomUUID();
    const tenant = `tenant-refresh-${suffix}`;
    const older = `session-older-${suffix}`;
    const newer = `session-newer-${suffix}`;
    await store.createSession(tenant, older, 'Older', '2026-08-14T01:00:00.000Z');
    await store.createSession(tenant, newer, 'Newer', '2026-08-14T02:00:00.000Z');
    const first = await store.listSessions(tenant, { limit: 1 });
    expect(first.items[0]?.sessionId).toBe(newer);
    const created = `session-created-${suffix}`;
    await store.createSession(tenant, created, 'Created during continuation', '2026-08-14T04:00:00.000001Z');
    await inspector.query("UPDATE chat_sessions SET updated_at='2026-08-14T03:00:00.000001Z' WHERE tenant_id=$1 AND session_id=$2", [tenant, older]);
    const continuation = await store.listSessions(tenant, { limit: 10, cursor: first.nextCursor! });
    expect(continuation.items.map((item) => item.sessionId)).not.toContain(older);
    expect(continuation.items.map((item) => item.sessionId)).not.toContain(created);
    expect((await store.listSessions(tenant, { limit: 2 })).items.map((item) => item.sessionId)).toEqual([created, older]);
  });

  it('creates SQL NULL title, derives once atomically, preserves explicit title, and exposes safe previews', async () => {
    const suffix = randomUUID();
    const tenant = `tenant-title-${suffix}`;
    const derived = `session-derived-${suffix}`;
    await store.createSession(tenant, derived, undefined, '2026-08-14T05:00:00.000Z');
    expect((await inspector.query<{ title: string | null }>('SELECT title FROM chat_sessions WHERE tenant_id=$1 AND session_id=$2', [tenant, derived])).rows[0]?.title).toBeNull();
    await store.acceptUserMessage({ tenantId: tenant, sessionId: derived, messageId: `message-derived-${suffix}`, runId: `run-derived-${suffix}`, parts: [{ kind: 'text', text: `  ${'😀'.repeat(90)}\n tail ` }], now: '2026-08-14T05:01:00.000Z' });
    const derivedRow = (await inspector.query<{ title: string }>('SELECT title FROM chat_sessions WHERE tenant_id=$1 AND session_id=$2', [tenant, derived])).rows[0]!;
    expect([...derivedRow.title]).toHaveLength(80);

    const explicit = `session-explicit-${suffix}`;
    await store.createSession(tenant, explicit, 'Local Sage Chat', '2026-08-14T06:00:00.000Z');
    await store.acceptUserMessage({ tenantId: tenant, sessionId: explicit, messageId: `message-explicit-${suffix}`, runId: `run-explicit-${suffix}`, parts: [{ kind: 'text', text: 'must not replace explicit title' }], now: '2026-08-14T06:01:00.000Z' });
    expect((await store.getSession(tenant, explicit))?.title).toBe('Local Sage Chat');

    const artifact = `session-artifact-${suffix}`;
    await store.createSession(tenant, artifact, undefined, '2026-08-14T07:00:00.000Z');
    await store.acceptUserMessage({ tenantId: tenant, sessionId: artifact, messageId: `message-artifact-${suffix}`, runId: `run-artifact-${suffix}`, parts: [{ kind: 'artifact', artifact: { artifactRef: `artifact://private/${suffix}`, name: '<report>\n.txt', mediaType: 'text/plain', sizeBytes: 999 } }], now: '2026-08-14T07:01:00.000Z' });
    const artifactItem = (await store.listSessions(tenant, { q: 'Artifact conversation' })).items[0];
    expect(artifactItem).toMatchObject({ title: 'Artifact conversation', preview: '[Artifact: report .txt]' });
    expect(JSON.stringify(artifactItem)).not.toContain('artifact://private');
  });

  it('keeps the one-time exact legacy placeholder exception conservative and idempotent', async () => {
    const suffix = randomUUID();
    const tenant = `tenant-legacy-${suffix}`;
    const legacy = `session-legacy-${suffix}`;
    const custom = `session-custom-${suffix}`;
    for (const [sessionId, title] of [[legacy, 'Local Sage Chat'], [custom, 'Local Sage Chat custom']] as const) {
      await store.createSession(tenant, sessionId, title, '2026-08-14T08:00:00.000Z');
      await inspector.query(`INSERT INTO chat_messages(tenant_id,message_id,session_id,turn,role,created_at)
        VALUES($1,$2,$3,1,'user','2026-08-14T08:01:00Z')`, [tenant, `message-${sessionId}`, sessionId]);
      await inspector.query(`INSERT INTO chat_message_parts(tenant_id,message_id,part_index,kind,text_content,artifact_ref)
        VALUES($1,$2,0,'text','legacy derived text',NULL)`, [tenant, `message-${sessionId}`]);
    }
    const sql = await readFile(new URL('../migrations/002_chat_history.sql', import.meta.url), 'utf8');
    await inspector.query(sql);
    await inspector.query(sql);
    expect((await store.getSession(tenant, legacy))?.title).toBe('legacy derived text');
    expect((await store.getSession(tenant, custom))?.title).toBe('Local Sage Chat custom');
  });

  it('fails a Run with both an error event and a terminal run event so timelines end on failed', async () => {
    const suffix = randomUUID();
    const tenant = `tenant-fail-${suffix}`;
    const sessionId = `session-fail-${suffix}`;
    await store.createSession(tenant, sessionId, 'Failure timeline', '2026-08-14T09:00:00.000Z');
    const runId = `run-fail-${suffix}`;
    await store.acceptUserMessage({ tenantId: tenant, sessionId, messageId: `message-fail-${suffix}`, runId, parts: [{ kind: 'text', text: 'trigger failure' }], now: '2026-08-14T09:01:00.000Z' });
    await store.failRun(tenant, runId, { code: 'CHAT_AGENT_FAILED', message: '404 page not found', retryable: true }, '2026-08-14T09:01:05.000Z');
    const timeline = await store.listTimeline(tenant, sessionId, 0);
    expect(timeline.map((event) => event.payload)).toEqual([
      { kind: 'text', text: 'trigger failure', messageId: `message-fail-${suffix}`, promotionEligibility: 'explicit' },
      { kind: 'run', status: 'active', attempt: 1 },
      { kind: 'error', error: { code: 'CHAT_AGENT_FAILED', message: '404 page not found', retryable: true } },
      { kind: 'run', status: 'failed', attempt: 1 }
    ]);
    expect((await store.getRun(tenant, runId))?.status).toBe('failed');
  });
});

integration('Workspace Chat archive and permanent delete PostgreSQL integration', () => {
  it('archives idempotently, filters views, keeps retention stable, and guards writes', async () => {
    const suffix = randomUUID();
    const tenant = `tenant-archive-${suffix}`;
    const keep = `session-keep-${suffix}`;
    const filler = `session-filler-${suffix}`;
    const archived = `session-gone-${suffix}`;
    await store.createSession(tenant, keep, 'Keep', '2026-08-15T01:00:00.000Z');
    await store.createSession(tenant, filler, 'Filler', '2026-08-15T01:30:00.000Z');
    await store.createSession(tenant, archived, 'Archive me', '2026-08-15T02:00:00.000Z');
    await store.acceptUserMessage({ tenantId: tenant, sessionId: archived, messageId: `message-gone-${suffix}`, runId: `run-gone-${suffix}`, parts: [{ kind: 'text', text: 'archive candidate' }], now: '2026-08-15T02:01:00.000Z' });

    const archivedAt = await store.archiveSession(tenant, archived, '2026-08-15T03:00:00.000Z');
    expect(archivedAt.archivedAt).toBe('2026-08-15T03:00:00.000Z');
    expect(archivedAt.updatedAt).toBe('2026-08-15T02:01:00.000Z');
    expect((await store.listSessions(tenant)).items.map((item) => item.sessionId)).toEqual([filler, keep]);
    const archivedView = await store.listSessions(tenant, { archived: true });
    expect(archivedView.items.map((item) => item.sessionId)).toEqual([archived]);
    expect(archivedView.items[0]).toMatchObject({ archivedAt: '2026-08-15T03:00:00.000Z', retentionEligibleAt: '2026-09-14T02:01:00.000Z' });
    expect((await store.listSessions(tenant, { archived: false })).items.map((item) => item.sessionId)).toEqual([filler, keep]);

    const again = await store.archiveSession(tenant, archived, '2026-08-15T04:00:00.000Z');
    expect(again.archivedAt).toBe('2026-08-15T03:00:00.000Z');
    await expect(store.acceptUserMessage({ tenantId: tenant, sessionId: archived, messageId: `message-blocked-${suffix}`, runId: `run-blocked-${suffix}`, parts: [{ kind: 'text', text: 'must be rejected' }], now: '2026-08-15T04:01:00.000Z' })).rejects.toMatchObject({ code: 'CHAT_SESSION_NOT_FOUND' });

    const activeCursor = (await store.listSessions(tenant, { limit: 1 })).nextCursor;
    if (activeCursor === undefined) throw new Error('expected an active-view continuation cursor');
    await expect(store.listSessions(tenant, { archived: true, cursor: activeCursor })).rejects.toMatchObject({ code: 'CHAT_INVALID_REQUEST' });

    const restored = await store.unarchiveSession(tenant, archived);
    expect(restored.status).toBe('open');
    expect(restored.archivedAt).toBeUndefined();
    expect(restored.updatedAt).toBe('2026-08-15T02:01:00.000Z');
    expect((await store.listSessions(tenant)).items).toHaveLength(3);
    await expect(store.acceptUserMessage({ tenantId: tenant, sessionId: archived, messageId: `message-resumed-${suffix}`, runId: `run-resumed-${suffix}`, parts: [{ kind: 'text', text: 'writes flow again' }], now: '2026-08-15T05:00:00.000Z' })).resolves.toBeTruthy();

    await expect(store.archiveSession(tenant, `session-missing-${suffix}`)).rejects.toMatchObject({ code: 'CHAT_SESSION_NOT_FOUND' });
    await expect(store.unarchiveSession(tenant, `session-missing-${suffix}`)).rejects.toMatchObject({ code: 'CHAT_SESSION_NOT_FOUND' });
  });

  it('blocks retries for archived sessions and restores them after unarchive', async () => {
    const suffix = randomUUID();
    const tenant = `tenant-retry-${suffix}`;
    const sessionId = `session-retry-${suffix}`;
    const runId = `run-retry-${suffix}`;
    await store.createSession(tenant, sessionId, 'Retry guard', '2026-08-15T06:00:00.000Z');
    await store.acceptUserMessage({ tenantId: tenant, sessionId, messageId: `message-retry-${suffix}`, runId, parts: [{ kind: 'text', text: 'fail then archive' }], now: '2026-08-15T06:01:00.000Z' });
    await store.failRun(tenant, runId, { code: 'CHAT_AGENT_FAILED', message: 'boom', retryable: true }, '2026-08-15T06:01:05.000Z');
    await store.archiveSession(tenant, sessionId, '2026-08-15T06:02:00.000Z');
    await expect(store.createRetryRun(tenant, runId, `run-retry-2-${suffix}`, '2026-08-15T06:03:00.000Z')).rejects.toMatchObject({ code: 'CHAT_SESSION_NOT_FOUND' });
    await store.unarchiveSession(tenant, sessionId);
    await expect(store.createRetryRun(tenant, runId, `run-retry-3-${suffix}`, '2026-08-15T06:04:00.000Z')).resolves.toMatchObject({ attempt: 2 });
  });

  it('permanently deletes all session data while keeping the append-only audit ledgers', async () => {
    const suffix = randomUUID();
    const tenant = `tenant-delete-${suffix}`;
    const otherTenant = `tenant-delete-other-${suffix}`;
    const sessionId = `session-delete-${suffix}`;
    const otherSession = `session-other-${suffix}`;
    const runId = `run-delete-${suffix}`;
    const messageId = `message-delete-${suffix}`;
    const taskId = `task-delete-${suffix}`;
    await store.createSession(tenant, sessionId, 'Delete everything', '2026-08-15T07:00:00.000Z');
    await store.createSession(otherTenant, otherSession, 'Other tenant', '2026-08-15T07:00:00.000Z');
    await store.acceptUserMessage({ tenantId: tenant, sessionId, messageId, runId, parts: [{ kind: 'text', text: 'promote then delete' }], now: '2026-08-15T07:01:00.000Z' });
    await store.completeRun(tenant, runId, { kind: 'text', text: 'assistant answer' }, '2026-08-15T07:01:05.000Z');
    await store.reservePromotion({
      tenantId: tenant, messageId, taskId, taskType: 'sage.agent-task.v1',
      inputRef: `task-input://chat/${suffix}`, mode: 'explicit',
      principalId: `principal-${suffix}`, authenticationId: `auth-${suffix}`, reason: 'integration delete test', now: '2026-08-15T07:02:00.000Z'
    });
    await inspector.query(`INSERT INTO chat_summaries(tenant_id,summary_id,session_id,through_turn,content,created_at)
      VALUES($1,$2,$3,2,'summary content','2026-08-15T07:03:00Z')`, [tenant, `summary-${suffix}`, sessionId]);
    await store.archiveSession(tenant, sessionId, '2026-08-15T07:04:00.000Z');

    await store.deleteSession(tenant, sessionId);

    expect(await store.getSession(tenant, sessionId)).toBeUndefined();
    expect((await store.listSessions(tenant, { archived: true })).items).toHaveLength(0);
    expect(await store.getSession(otherTenant, otherSession)).toMatchObject({ sessionId: otherSession });
    for (const [table, column] of [
      ['chat_messages', 'session_id'], ['chat_runs', 'session_id'], ['chat_timeline_events', 'session_id'], ['chat_summaries', 'session_id']
    ] as const) {
      const count = (await inspector.query<{ count: string }>(`SELECT count(*) AS count FROM ${table} WHERE tenant_id=$1 AND ${column}=$2`, [tenant, sessionId])).rows[0]?.count;
      expect(count, `${table} must be empty`).toBe('0');
    }
    expect((await inspector.query<{ count: string }>('SELECT count(*) AS count FROM chat_message_parts WHERE tenant_id=$1 AND message_id LIKE $2', [tenant, `%${suffix}%`])).rows[0]?.count).toBe('0');
    expect((await inspector.query<{ count: string }>('SELECT count(*) AS count FROM chat_promotion_handoffs WHERE tenant_id=$1', [tenant])).rows[0]?.count).toBe('0');
    expect((await inspector.query<{ count: string }>('SELECT count(*) AS count FROM chat_promotion_handoff_outbox WHERE tenant_id=$1', [tenant])).rows[0]?.count).toBe('0');
    expect((await inspector.query<{ count: string }>('SELECT count(*) AS count FROM chat_task_associations WHERE tenant_id=$1', [tenant])).rows[0]?.count).toBe('0');
    const promotionAudits = (await inspector.query<{ count: string }>('SELECT count(*) AS count FROM chat_promotion_audit WHERE tenant_id=$1 AND association_task_id=$2', [tenant, taskId])).rows[0]?.count;
    expect(Number(promotionAudits)).toBeGreaterThan(0);
    const handoffAudits = (await inspector.query<{ count: string }>('SELECT count(*) AS count FROM chat_promotion_handoff_audit WHERE tenant_id=$1 AND task_id=$2', [tenant, taskId])).rows[0]?.count;
    expect(Number(handoffAudits)).toBeGreaterThan(0);

    await expect(store.deleteSession(tenant, sessionId)).rejects.toMatchObject({ code: 'CHAT_SESSION_NOT_FOUND' });
  });
});
