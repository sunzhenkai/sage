import type { PostgresMigration } from '@sage/postgres-migrations';

export const CHAT_MIGRATION_COMPONENT = 'chat' as const;
export const CHAT_MIGRATIONS = [
  {
    version: '001_chat',
    url: new URL('../migrations/001_chat.sql', import.meta.url),
    checksumSha256: 'a213b9671a3e78a9127596dda1ccd9ab231adf4fe6471b670a0f18ea224dabc7'
  },
  {
    version: '002_chat_history',
    url: new URL('../migrations/002_chat_history.sql', import.meta.url),
    checksumSha256: 'a7a7fc3f9cf779aa10fc03046e39fcc3f98fe2c6a9ebd824ea35a9c1a08e99fa'
  },
  {
    version: '003_chat_promotion_handoff',
    url: new URL('../migrations/003_chat_promotion_handoff.sql', import.meta.url),
    checksumSha256: '2414e302378f7f868807ccb44b054f48a316c83189629a0255445e93a2be774f'
  },
  {
    version: '004_chat_source_quiesce',
    url: new URL('../migrations/004_chat_source_quiesce.sql', import.meta.url),
    checksumSha256: '0a45130a1938f03573563651a675175bd4815c7cbfdbb9455f47dfc1ee349c7d'
  },
  {
    version: '005_chat_archive',
    url: new URL('../migrations/005_chat_archive.sql', import.meta.url),
    checksumSha256: '11b79da67208a03748b55896dbf0a2f74f41fbde6b0734ddf053378c6271abd8'
  }
] as const satisfies readonly PostgresMigration[];
