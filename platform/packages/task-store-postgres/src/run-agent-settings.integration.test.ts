import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { PostgresTaskStore } from './index.js';
import type { RunAgentSettingsRecord } from '@sage/task-domain';

const url = process.env.P6_POSTGRES_URL;
const integration = describe.skipIf(!url);
let store: PostgresTaskStore;
let admin: Pool;

const recordFor = (tenantId: string, defaultProvider: RunAgentSettingsRecord['defaultProvider']): RunAgentSettingsRecord => ({
  tenantId,
  defaultProvider,
  updatedAt: '2026-08-25T00:00:00.000Z',
  updatedBy: 'principal://tester'
});

beforeAll(async () => {
  store = new PostgresTaskStore({ connectionString: url! });
  admin = new Pool({ connectionString: url! });
  await store.migrate();
});
afterAll(async () => { await store.close(); await admin.end(); });

integration.sequential('PostgreSQL run agent settings', () => {
  it('returns undefined when no row exists (echo semantics live at the caller)', async () => {
    expect(await store.getRunAgentSettings(`tenant-missing-${randomUUID()}`)).toBeUndefined();
  });

  it('upserts and re-reads the default provider', async () => {
    const tenantId = `tenant-settings-${randomUUID()}`;
    await store.upsertRunAgentSettings({ ...recordFor(tenantId, 'connection'), providerConnectionId: 'conn-1' });
    const read = await store.getRunAgentSettings(tenantId);
    expect(read).toMatchObject({ tenantId, defaultProvider: 'connection', providerConnectionId: 'conn-1', updatedBy: 'principal://tester' });
    await store.upsertRunAgentSettings({ ...recordFor(tenantId, 'echo'), updatedAt: '2026-08-25T01:00:00.000Z' });
    const updated = await store.getRunAgentSettings(tenantId);
    expect(updated?.defaultProvider).toBe('echo');
    expect(updated?.updatedAt).toBe('2026-08-25T01:00:00.000Z');
  });

  it('normalizes legacy provider values at read time without write-back', async () => {
    const tenantId = `tenant-settings-${randomUUID()}`;
    await admin.query(
      `INSERT INTO run_agent_settings (tenant_id, default_provider, provider_connection_id, updated_at, updated_by)
       VALUES ($1, 'minimax', 'conn-legacy', now(), 'principal://tester')`,
      [tenantId]
    );
    const read = await store.getRunAgentSettings(tenantId);
    expect(read?.defaultProvider).toBe('echo');
    expect(read?.providerConnectionId).toBeUndefined();
    const raw = await admin.query(`SELECT default_provider FROM run_agent_settings WHERE tenant_id=$1`, [tenantId]);
    expect(raw.rows[0]?.default_provider).toBe('minimax');
  });

  it('rejects invalid provider values and malformed records', async () => {
    const tenantId = `tenant-settings-${randomUUID()}`;
    const invalid = { ...recordFor(tenantId, 'openai' as RunAgentSettingsRecord['defaultProvider']) };
    await expect(store.upsertRunAgentSettings(invalid)).rejects.toThrow(/upsertRunAgentSettings\.invalid/u);
    expect(await store.getRunAgentSettings(tenantId)).toBeUndefined();
  });
});
