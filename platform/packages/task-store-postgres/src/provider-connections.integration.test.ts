import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { PostgresTaskStore } from './index.js';
import type { ProviderConnectionWrite } from '@sage/task-domain';

const url = process.env.P6_POSTGRES_URL;
const integration = describe.skipIf(!url);
let store: PostgresTaskStore;
let admin: Pool;

const writeFor = (overrides: Partial<ProviderConnectionWrite> = {}): ProviderConnectionWrite => ({
  name: 'MiniMax 个人',
  source: 'user',
  adapterKind: 'anthropic',
  baseUrl: 'https://api.minimaxi.com/anthropic',
  modelId: 'MiniMax-M3',
  providerName: 'MiniMax',
  modelName: 'MiniMax-M3',
  enabled: true,
  updatedBy: 'principal://tester',
  ...overrides
});

const seal = (plaintext: string) => ({ ciphertext: Buffer.from(plaintext, 'utf8'), keyVersion: 0, updatedAt: '2026-08-25T00:00:00.000Z' });

beforeAll(async () => {
  store = new PostgresTaskStore({ connectionString: url! });
  admin = new Pool({ connectionString: url! });
  await store.migrate();
});
afterAll(async () => { await store.close(); await admin.end(); });

integration.sequential('PostgreSQL provider connections', () => {
  it('stores multiple entries for the same provider side by side', async () => {
    const tenantId = `tenant-conn-${randomUUID()}`;
    const personal = await store.createProviderConnection(tenantId, `personal-${randomUUID()}`, writeFor(), '2026-08-25T00:00:00.000Z');
    const deployment = await store.createProviderConnection(tenantId, `deployment-${randomUUID()}`,
      writeFor({ name: 'MiniMax 部署', source: 'deployment-env' }), '2026-08-25T00:00:00.000Z');
    const list = await store.listProviderConnections(tenantId);
    expect(list).toHaveLength(2);
    expect(list.map((entry) => entry.id).sort()).toEqual([personal.id, deployment.id].map((id) => id).sort());
  });

  it('keeps credentials out of list/get results and cascade-deletes them', async () => {
    const tenantId = `tenant-conn-${randomUUID()}`;
    const id = `conn-${randomUUID()}`;
    await store.createProviderConnection(tenantId, id, writeFor({ credential: seal('secret-material') }), '2026-08-25T00:00:00.000Z');
    const listed = await store.listProviderConnections(tenantId);
    expect(listed[0]?.credentialPresent).toBe(true);
    expect(JSON.stringify(listed)).not.toContain('secret-material');
    const sealed = await store.getProviderCredential(tenantId, id);
    expect(sealed?.ciphertext.toString('utf8')).toBe('secret-material');
    expect(await store.deleteProviderConnection(tenantId, id)).toBe(true);
    expect(await store.getProviderCredential(tenantId, id)).toBeUndefined();
    expect(await store.getProviderConnection(tenantId, id)).toBeUndefined();
    expect(await store.deleteProviderConnection(tenantId, id)).toBe(false);
  });

  it('rotates credentials on update and supports metadata-only updates', async () => {
    const tenantId = `tenant-conn-${randomUUID()}`;
    const id = `conn-${randomUUID()}`;
    await store.createProviderConnection(tenantId, id, writeFor({ credential: seal('first') }), '2026-08-25T00:00:00.000Z');
    const rotated = await store.updateProviderConnection(tenantId, id,
      writeFor({ credential: { ciphertext: Buffer.from('second'), keyVersion: 1, updatedAt: '2026-08-25T01:00:00.000Z' } }), '2026-08-25T01:00:00.000Z');
    expect(rotated?.credentialPresent).toBe(true);
    expect((await store.getProviderCredential(tenantId, id))?.ciphertext.toString('utf8')).toBe('second');
    const metadataOnly = await store.updateProviderConnection(tenantId, id, writeFor({ name: '改名' }), '2026-08-25T02:00:00.000Z');
    expect(metadataOnly?.name).toBe('改名');
    expect(metadataOnly?.credentialPresent).toBe(true);
    const noCredential = await store.createProviderConnection(tenantId, `conn-${randomUUID()}`, writeFor(), '2026-08-25T00:00:00.000Z');
    expect(noCredential.credentialPresent).toBe(false);
  });

  it('rejects malformed writes', async () => {
    const tenantId = `tenant-conn-${randomUUID()}`;
    await expect(store.createProviderConnection(tenantId, 'x', writeFor({ baseUrl: 'http://insecure.example' }), '2026-08-25T00:00:00.000Z'))
      .rejects.toThrow(/createProviderConnection\.invalid/u);
    await expect(store.createProviderConnection(tenantId, 'x', writeFor({ source: 'other' as ProviderConnectionWrite['source'] }), '2026-08-25T00:00:00.000Z'))
      .rejects.toThrow(/createProviderConnection\.invalid/u);
    await expect(store.createProviderConnection(tenantId, 'x', writeFor({ credential: { ciphertext: Buffer.alloc(0), keyVersion: 0, updatedAt: 'x' } }), '2026-08-25T00:00:00.000Z'))
      .rejects.toThrow(/createProviderConnection\.invalid/u);
  });

  it('persists connection-mode run agent settings', async () => {
    const tenantId = `tenant-conn-settings-${randomUUID()}`;
    const connectionId = `conn-${randomUUID()}`;
    await store.createProviderConnection(tenantId, connectionId, writeFor(), '2026-08-25T00:00:00.000Z');
    await store.upsertRunAgentSettings({
      tenantId, defaultProvider: 'connection', providerConnectionId: connectionId,
      updatedAt: '2026-08-25T00:00:00.000Z', updatedBy: 'principal://tester'
    });
    expect(await store.getRunAgentSettings(tenantId)).toMatchObject({ defaultProvider: 'connection', providerConnectionId: connectionId });
    await store.upsertRunAgentSettings({
      tenantId, defaultProvider: 'echo', updatedAt: '2026-08-25T01:00:00.000Z', updatedBy: 'principal://tester'
    });
    expect((await store.getRunAgentSettings(tenantId))?.defaultProvider).toBe('echo');
    expect((await store.getRunAgentSettings(tenantId))?.providerConnectionId).toBeUndefined();
    await expect(store.upsertRunAgentSettings({
      tenantId, defaultProvider: 'connection', updatedAt: '2026-08-25T02:00:00.000Z', updatedBy: 'principal://tester'
    } as never)).rejects.toThrow(/upsertRunAgentSettings\.invalid/u);
  });
});
