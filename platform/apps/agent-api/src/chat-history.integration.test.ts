import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { LocalAgentClient } from '@sage/agent-client';
import { ChatStore } from '@sage/chat-domain';
import { createChatApi } from './index.js';

const databaseUrl = process.env.WORKSPACE_POSTGRES_URL;
const integration = describe.skipIf(!databaseUrl);
let store: ChatStore;
let inspector: Pool;

beforeAll(async () => {
  if (!databaseUrl) return;
  store = new ChatStore({ connectionString: databaseUrl });
  inspector = new Pool({ connectionString: databaseUrl });
});
afterAll(async () => {
  if (!databaseUrl) return;
  await store.close();
  await inspector.end();
});

integration('Chat history API PostgreSQL integration', () => {
  it('creates NULL title through API then lists atomically derived title/preview', async () => {
    const suffix = randomUUID();
    const tenantId = `tenant-api-history-${suffix}`;
    const app = await createChatApi({ store, tenantId, agentClient: {} as LocalAgentClient });
    const created = await app.inject({ method: 'POST', url: '/v1/chat/sessions', payload: {} });
    expect(created.statusCode).toBe(201);
    const sessionId = created.json().sessionId as string;
    expect(created.json()).not.toHaveProperty('title');
    expect((await inspector.query<{ title: string | null }>('SELECT title FROM chat_sessions WHERE tenant_id=$1 AND session_id=$2', [tenantId, sessionId])).rows[0]?.title).toBeNull();

    await store.acceptUserMessage({ tenantId, sessionId, messageId: `message-${suffix}`, runId: `run-${suffix}`, parts: [{ kind: 'text', text: '  API derived title  ' }], now: '2026-08-14T09:00:00.123Z' });
    const history = await app.inject({ method: 'GET', url: '/v1/chat/sessions?limit=1&status=open&q=derived' });
    expect(history.statusCode).toBe(200);
    expect(history.json().items[0]).toMatchObject({ sessionId, title: 'API derived title', preview: 'API derived title', lastMessageRole: 'user' });
    expect(history.json().items[0]).not.toHaveProperty('messages');
    await app.close();
  });
});
