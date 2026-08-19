import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { readApiRuntimeConfig } from './runtime.js';

describe('Provider Catalog API runtime lifecycle boundaries', () => {
  it('gives the local principal an explicit admin role without replacing task-operator', () => {
    process.env.SAGE_DEPLOYMENT_MODE = 'local';
    const roles = readApiRuntimeConfig().principal.roles;
    expect(roles).toEqual(expect.arrayContaining(['provider-catalog-admin', 'task-operator', 'chat-task-promoter']));
  });

  it('keeps Catalog outside readyz and fixes shutdown call order', async () => {
    const source = await readFile(new URL('./runtime.ts', import.meta.url), 'utf8');
    const ready = source.slice(source.indexOf("app.get('/readyz'"), source.indexOf('const close ='));
    expect(ready).not.toMatch(/catalog|models\.dev/i);
    const close = source.slice(source.indexOf('const close ='), source.indexOf('return { app, config, close }'));
    expect(close.indexOf('catalogManager.beginShutdown()')).toBeLessThan(close.indexOf('app?.close()'));
    expect(close.indexOf('app?.close()')).toBeLessThan(close.indexOf('catalogManager.close()'));
    expect(close.indexOf('catalogManager.close()')).toBeLessThan(close.indexOf('temporalClients.close()'));
    expect(close.indexOf('temporalClients.close()')).toBeLessThan(close.indexOf('Promise.allSettled'));
  });

  it('starts due sync only after migration/projection load and route registration', async () => {
    const source = await readFile(new URL('./runtime.ts', import.meta.url), 'utf8');
    expect(source.indexOf('migrateStores(')).toBeLessThan(source.indexOf('catalogService.listProviders'));
    expect(source.indexOf('catalogService.listProviders')).toBeLessThan(source.indexOf('registerProviderCatalogRoutes(app'));
    expect(source.indexOf('registerProviderCatalogRoutes(app')).toBeLessThan(source.indexOf('catalogManager.start()'));
  });
});
