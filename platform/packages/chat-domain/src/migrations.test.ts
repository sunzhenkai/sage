import { describe, expect, it } from 'vitest';
import { loadMigration } from '@sage/postgres-migrations';
import { CHAT_MIGRATIONS } from './migrations.js';

describe('Chat migration manifest', () => {
  it('pins paths, order, and immutable checksums', async () => {
    expect(CHAT_MIGRATIONS.map((item) => item.version)).toEqual(['001_chat', '002_chat_history', '003_chat_promotion_handoff', '004_chat_source_quiesce', '005_chat_archive']);
    expect(CHAT_MIGRATIONS.map((item) => item.url.pathname.endsWith(`/migrations/${item.version}.sql`))).toEqual([true, true, true, true, true]);
    for (const migration of CHAT_MIGRATIONS) await expect(loadMigration(migration)).resolves.toMatchObject({ checksumSha256: migration.checksumSha256 });
  });
});

  it('keeps handoff persistence reference-only and bounded', async () => {
    const migration = CHAT_MIGRATIONS.find((item) => item.version === '003_chat_promotion_handoff');
    expect(migration).toBeDefined();
    const loaded = await loadMigration(migration!);
    expect(loaded.sql).toContain("state IN ('PREPARING','SOURCE_QUIESCED','TARGET_STARTING','DURABLE_OWNED')");
    expect(loaded.sql).toContain('chat_promotion_handoff_outbox');
    expect(loaded.sql).toContain('CHAT_PROMOTION_HANDOFF_AUDIT_APPEND_ONLY');
    expect(loaded.sql).not.toMatch(/message[_ ]body|raw[_ ]target|model[_ ]config|temporal[_ ]dto/iu);
  });

  it('adds paused source state and digest-bound quiesce columns', async () => {
    const migration = CHAT_MIGRATIONS.find((item) => item.version === '004_chat_source_quiesce');
    const loaded = await loadMigration(migration!);
    expect(loaded.sql).toContain("status='paused'");
    expect(loaded.sql).toContain('source_run_id');
    expect(loaded.sql).toContain('checkpoint_digest');
    expect(loaded.sql).toContain("'^sha256:[a-f0-9]{64}$'");
  });

  it('adds the orthogonal archive dimension without touching retention ordering', async () => {
    const migration = CHAT_MIGRATIONS.find((item) => item.version === '005_chat_archive');
    expect(migration).toBeDefined();
    const loaded = await loadMigration(migration!);
    expect(loaded.sql).toContain('ADD COLUMN archived_at timestamptz NULL');
    expect(loaded.sql).toContain('chat_sessions_archived_history_idx');
    expect(loaded.sql).toContain('WHERE archived_at IS NOT NULL');
    expect(loaded.sql).not.toContain('updated_at =');
  });
