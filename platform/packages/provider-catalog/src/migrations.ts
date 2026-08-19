import type { PostgresMigration } from '@sage/postgres-migrations';

export const PROVIDER_CATALOG_MIGRATION_COMPONENT = 'provider-catalog' as const;
export const PROVIDER_CATALOG_MIGRATIONS = [
  {
    version: '001_provider_catalog',
    url: new URL('../migrations/001_provider_catalog.sql', import.meta.url),
    checksumSha256: 'd36e9d30ee4404c834599ed5e3866c2eb310b7bf8c0e594243a9a09f262c5af9'
  }
] as const satisfies readonly PostgresMigration[];
