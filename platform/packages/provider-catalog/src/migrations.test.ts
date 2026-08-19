import { describe, expect, it } from 'vitest';
import { loadMigration } from '@sage/postgres-migrations';
import { PROVIDER_CATALOG_MIGRATIONS } from './migrations.js';

describe('Provider Catalog migration manifest', () => {
  it('pins its independent component path and checksum', async () => {
    expect(PROVIDER_CATALOG_MIGRATIONS.map((item) => item.version)).toEqual(['001_provider_catalog']);
    expect(PROVIDER_CATALOG_MIGRATIONS[0]?.url.pathname.endsWith('/migrations/001_provider_catalog.sql')).toBe(true);
    await expect(loadMigration(PROVIDER_CATALOG_MIGRATIONS[0]!)).resolves.toMatchObject({ checksumSha256: PROVIDER_CATALOG_MIGRATIONS[0]?.checksumSha256 });
  });
});
