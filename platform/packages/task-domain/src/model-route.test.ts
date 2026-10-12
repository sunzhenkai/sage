import { describe, expect, it } from 'vitest';
import { resolvePackageRunConnection } from './index.js';
import type { ProviderConnectionRecord } from './index.js';

const entry = (id: string, modelId: string, overrides: Partial<ProviderConnectionRecord> = {}): ProviderConnectionRecord => ({
  tenantId: 'tenant-local', id, name: id, source: 'user', adapterKind: 'anthropic',
  baseUrl: 'https://api.example', modelId, enabled: true, credentialPresent: true,
  createdAt: '2026-08-25T00:00:00.000Z', updatedAt: '2026-08-25T00:00:00.000Z', ...overrides
});

const route = { provider: 'anthropic', model: 'claude-sonnet-4-5', fallbacks: ['claude-haiku-4-5'] };

describe('resolvePackageRunConnection', () => {
  it('prefers the manifest route model, then fallbacks, in order', () => {
    const registry = [entry('conn-haiku', 'claude-haiku-4-5'), entry('conn-sonnet', 'claude-sonnet-4-5')];
    expect(resolvePackageRunConnection(route, registry, undefined)).toEqual({ source: 'manifest', connectionId: 'conn-sonnet' });
    const haikuOnly = [entry('conn-haiku', 'claude-haiku-4-5')];
    expect(resolvePackageRunConnection(route, haikuOnly, undefined)).toEqual({ source: 'manifest', connectionId: 'conn-haiku' });
  });

  it('ignores disabled or credential-less manifest matches', () => {
    const registry = [entry('disabled', 'claude-sonnet-4-5', { enabled: false }), entry('no-cred', 'claude-haiku-4-5', { credentialPresent: false }), entry('conn-default', 'minimax-m3')];
    expect(resolvePackageRunConnection(route, registry, 'conn-default')).toEqual({ source: 'settings', connectionId: 'conn-default' });
  });

  it('falls back to the settings default when the manifest route has no match', () => {
    expect(resolvePackageRunConnection(route, [entry('conn-default', 'minimax-m3')], 'conn-default'))
      .toEqual({ source: 'settings', connectionId: 'conn-default' });
  });

  it('requires the settings default to be enabled with a credential', () => {
    expect(resolvePackageRunConnection(route, [entry('conn-default', 'minimax-m3')], 'gone')).toBeUndefined();
    expect(resolvePackageRunConnection(route, [entry('default', 'any', { enabled: false })], 'default')).toBeUndefined();
  });

  it('returns undefined when both sources are unavailable, and skips manifest matching when no route is declared', () => {
    expect(resolvePackageRunConnection(route, [], undefined)).toBeUndefined();
    expect(resolvePackageRunConnection(undefined, [entry('default', 'any')], 'default'))
      .toEqual({ source: 'settings', connectionId: 'default' });
    expect(resolvePackageRunConnection(undefined, [entry('default', 'any')], undefined)).toBeUndefined();
  });
});
