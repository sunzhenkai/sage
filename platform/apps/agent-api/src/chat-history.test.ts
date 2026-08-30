import { describe, expect, it } from 'vitest';
import { ChatStoreError, type ChatStore } from '@sage/chat-domain';
import { createChatApi } from './index.js';

function fakeStore() {
  const state = {
    createdTitle: 'unset' as string | undefined,
    listed: undefined as unknown,
    archived: undefined as { sessionId: string; now: string } | undefined,
    unarchived: undefined as string | undefined,
    deleted: undefined as string | undefined
  };
  const store = {
    async migrate() {},
    async markActiveRunsFailed() { return []; },
    async listSessions(_tenantId: string, input: unknown) {
      state.listed = input;
      return { items: [] };
    },
    async createSession(_tenantId: string, sessionId: string, title: string | undefined, now: string) {
      state.createdTitle = title;
      return { schemaVersion: '1', sessionId, status: 'open', createdAt: now, updatedAt: now };
    },
    async archiveSession(_tenantId: string, sessionId: string, now: string) {
      state.archived = { sessionId, now };
      return { schemaVersion: '1', sessionId, status: 'open', archivedAt: now, createdAt: now, updatedAt: now };
    },
    async unarchiveSession(_tenantId: string, sessionId: string) {
      state.unarchived = sessionId;
      return { schemaVersion: '1', sessionId, status: 'open', createdAt: '2026-08-14T00:00:00.000Z', updatedAt: '2026-08-14T00:00:00.000Z' };
    },
    async deleteSession(_tenantId: string, sessionId: string) { state.deleted = sessionId; }
  };
  return { state, store: store as unknown as ChatStore };
}

function missingSessionStore(): ChatStore {
  const notFound = (): never => { throw new ChatStoreError('CHAT_SESSION_NOT_FOUND', 'Chat session does not exist'); };
  return {
    async migrate() {},
    async markActiveRunsFailed() { return []; },
    async listSessions() { return { items: [] }; },
    archiveSession: notFound,
    unarchiveSession: notFound,
    deleteSession: notFound
  } as unknown as ChatStore;
}

describe('Chat session history API', () => {
  it('uses strict defaults and returns the bounded history shape', async () => {
    const { state, store } = fakeStore();
    const app = await createChatApi({ store });
    const response = await app.inject({ method: 'GET', url: '/v1/chat/sessions' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ schemaVersion: '1', items: [] });
    expect(state.listed).toEqual({ limit: 30 });
    await app.close();
  });

  it('forwards the locale query to the store for untitled-title search fallback', async () => {
    const { state, store } = fakeStore();
    const app = await createChatApi({ store });
    const zh = await app.inject({ method: 'GET', url: '/v1/chat/sessions?locale=zh-CN&q=x' });
    expect(zh.statusCode).toBe(200);
    expect((state.listed as { locale?: string }).locale).toBe('zh-CN');
    const en = await app.inject({ method: 'GET', url: '/v1/chat/sessions?locale=en-US' });
    expect(en.statusCode).toBe(200);
    expect((state.listed as { locale?: string }).locale).toBe('en-US');
    const oversized = await app.inject({ method: 'GET', url: '/v1/chat/sessions?locale=' + 'a'.repeat(36) });
    expect(oversized.statusCode).toBe(400);
    await app.close();
  });

  it('maps invalid and additional query fields to CHAT_INVALID_REQUEST', async () => {
    const { store } = fakeStore();
    const app = await createChatApi({ store });
    for (const url of ['/v1/chat/sessions?limit=101', '/v1/chat/sessions?status=active', '/v1/chat/sessions?provider=forbidden', '/v1/chat/sessions?archived=yes']) {
      const response = await app.inject({ method: 'GET', url });
      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe('CHAT_INVALID_REQUEST');
    }
    await app.close();
  });

  it('forwards the archived view filter to the store', async () => {
    const { state, store } = fakeStore();
    const app = await createChatApi({ store });
    const archived = await app.inject({ method: 'GET', url: '/v1/chat/sessions?archived=true' });
    expect(archived.statusCode).toBe(200);
    expect(state.listed).toEqual({ limit: 30, archived: true });
    const active = await app.inject({ method: 'GET', url: '/v1/chat/sessions?archived=false' });
    expect(active.statusCode).toBe(200);
    expect(state.listed).toEqual({ limit: 30, archived: false });
    await app.close();
  });

  it('archives, unarchives, and permanently deletes sessions through dedicated routes', async () => {
    const { state, store } = fakeStore();
    const app = await createChatApi({ store });
    const archived = await app.inject({ method: 'POST', url: '/v1/chat/sessions/session-1/archive' });
    expect(archived.statusCode).toBe(200);
    expect(archived.json()).toMatchObject({ sessionId: 'session-1', archivedAt: state.archived?.now });
    const restored = await app.inject({ method: 'POST', url: '/v1/chat/sessions/session-1/unarchive' });
    expect(restored.statusCode).toBe(200);
    expect(restored.json()).toMatchObject({ sessionId: 'session-1' });
    expect(state.unarchived).toBe('session-1');
    const deleted = await app.inject({ method: 'DELETE', url: '/v1/chat/sessions/session-1' });
    expect(deleted.statusCode).toBe(204);
    expect(deleted.body).toBe('');
    expect(state.deleted).toBe('session-1');
    await app.close();
  });

  it('maps missing sessions on archive, unarchive, and delete to 404', async () => {
    const app = await createChatApi({ store: missingSessionStore() });
    for (const [method, url] of [
      ['POST', '/v1/chat/sessions/missing/archive'],
      ['POST', '/v1/chat/sessions/missing/unarchive'],
      ['DELETE', '/v1/chat/sessions/missing']
    ] as const) {
      const response = await app.inject({ method, url });
      expect(response.statusCode).toBe(404);
      expect(response.json().error.code).toBe('CHAT_SESSION_NOT_FOUND');
    }
    await app.close();
  });

  it('passes omitted title as undefined so the store inserts SQL NULL', async () => {
    const { state, store } = fakeStore();
    const app = await createChatApi({ store });
    const response = await app.inject({ method: 'POST', url: '/v1/chat/sessions', payload: {} });
    expect(response.statusCode).toBe(201);
    expect(state.createdTitle).toBeUndefined();
    const invalid = await app.inject({ method: 'POST', url: '/v1/chat/sessions', payload: { provider: 'forbidden' } });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json().error.code).toBe('CHAT_INVALID_REQUEST');
    await app.close();
  });
});
