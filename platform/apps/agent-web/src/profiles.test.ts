import { describe, expect, it } from 'vitest';
import { applyCatalogSelection, isProviderProfileV2, loadProviderProfiles, profileCompletion, PROVIDER_SECRET_PREFIX, PROVIDER_V1_STORAGE_KEY, PROVIDER_V2_STORAGE_KEY, saveProfileSecret, saveProviderProfiles, secretPresent, type ProviderProfileV2 } from './profiles.js';

class MemoryStorage implements Storage {
  #data = new Map<string, string>();
  get length() { return this.#data.size; }
  clear() { this.#data.clear(); }
  getItem(key: string) { return this.#data.get(key) ?? null; }
  key(index: number) { return [...this.#data.keys()][index] ?? null; }
  removeItem(key: string) { this.#data.delete(key); }
  setItem(key: string, value: string) { this.#data.set(key, value); }
}
const profile = (overrides: Partial<ProviderProfileV2> = {}): ProviderProfileV2 => ({ id: 'profile-1', name: 'Profile', enabled: false, adapterKind: 'unassigned', baseUrlSource: 'none', updatedAt: '2026-08-14T00:00:00.000Z', ...overrides });

describe('ProviderProfileV2 storage and migration', () => {
  it('strictly validates v2 and does not overwrite malformed storage', () => {
    const storage = new MemoryStorage();
    saveProviderProfiles(storage, [profile()]);
    expect(loadProviderProfiles(storage).profiles).toHaveLength(1);
    storage.setItem(PROVIDER_V2_STORAGE_KEY, JSON.stringify([{ ...profile(), apiKeyConfigured: true }]));
    expect(loadProviderProfiles(storage)).toMatchObject({ profiles: [], migrated: false, error: expect.any(String) });
    expect(storage.getItem(PROVIDER_V2_STORAGE_KEY)).toContain('apiKeyConfigured');
    expect(isProviderProfileV2({ ...profile(), unknown: true })).toBe(false);
  });

  it('isolates every legacy local record, preserves v1, and downgrades incomplete enabled profiles', () => {
    const storage = new MemoryStorage();
    const v1 = [
      { id: 'anything-local', name: 'Local clone', kind: 'local', baseUrl: 'local://pi', model: 'local', apiKeyConfigured: true, enabled: true, updatedAt: '2026-08-14T00:00:00.000Z' },
      { id: 'remote', name: 'Remote', kind: 'openai-compatible', baseUrl: 'http://unsafe', model: 'm', apiKeyConfigured: true, enabled: true, updatedAt: '2026-08-14T00:00:00.000Z' }
    ];
    storage.setItem(PROVIDER_V1_STORAGE_KEY, JSON.stringify(v1));
    const loaded = loadProviderProfiles(storage);
    expect(loaded.migrated).toBe(true);
    expect(loaded.profiles.map((item) => item.id)).toEqual(['remote']);
    expect(loaded.profiles[0]).toMatchObject({ enabled: false, baseUrlSource: 'none' });
    expect(JSON.stringify(loaded.profiles)).not.toContain('apiKeyConfigured');
    expect(storage.getItem(PROVIDER_V1_STORAGE_KEY)).toBe(JSON.stringify(v1));
  });

  it('starts fresh with no external profiles and keeps secret presence tab-local', () => {
    const local = new MemoryStorage(); const tabA = new MemoryStorage(); const tabB = new MemoryStorage();
    expect(loadProviderProfiles(local).profiles).toEqual([]);
    saveProfileSecret(tabA, 'profile-1', 'super-secret');
    expect(secretPresent(tabA, 'profile-1')).toBe(true);
    expect(secretPresent(tabB, 'profile-1')).toBe(false);
    expect(local.getItem(`${PROVIDER_SECRET_PREFIX}profile-1`)).toBeNull();
  });

  it('maps model override/provider/none provenance and preserves manual saved metadata until explicit selection', () => {
    const provider = { providerId: 'p', name: 'Provider', api: 'https://provider.example/v1' };
    const baseModel = { modelId: 'm', providerId: 'p', name: 'Model', status: 'active' as const, capabilities: [] };
    expect(applyCatalogSelection(provider, { ...baseModel, modelApi: 'https://model.example/v2' }, { snapshotId: 's1', activeSince: '2026-08-14T00:00:00.000Z' })).toMatchObject({ baseUrl: 'https://model.example/v2', baseUrlSource: 'model', catalogSnapshotId: 's1' });
    expect(applyCatalogSelection(provider, baseModel, { snapshotId: 's1', activeSince: '2026-08-14T00:00:00.000Z' })).toMatchObject({ baseUrl: 'https://provider.example/v1', baseUrlSource: 'provider' });
    expect(applyCatalogSelection({ providerId: 'p', name: 'Provider' }, baseModel, { snapshotId: 's1', activeSince: '2026-08-14T00:00:00.000Z' })).toMatchObject({ baseUrlSource: 'none' });
  });

  it('derives Disabled/Incomplete/Available metadata and never claims unassigned execution', () => {
    expect(profileCompletion(profile())).toEqual({ status: 'Disabled', executionAvailable: false });
    expect(profileCompletion(profile({ enabled: true }))).toEqual({ status: 'Incomplete', executionAvailable: false });
    expect(profileCompletion(profile({ enabled: true, providerId: 'p', providerName: 'P', modelId: 'm', modelName: 'M' }))).toEqual({ status: 'Available metadata', executionAvailable: false });
    expect(profileCompletion(profile({ enabled: true, adapterKind: 'openai-compatible', providerId: 'p', providerName: 'P', modelId: 'm', modelName: 'M', baseUrl: 'https://api.example/v1', baseUrlSource: 'manual' }))).toEqual({ status: 'Available metadata', executionAvailable: true });
  });
});
