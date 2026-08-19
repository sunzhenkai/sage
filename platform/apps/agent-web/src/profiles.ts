import type { ModelCatalogItem, ProviderCatalogItem } from '@sage/app-contracts';

export type AdapterKind = 'unassigned' | 'openai-compatible' | 'anthropic';
export type BaseUrlSource = 'none' | 'provider' | 'model' | 'manual';
export interface ProviderProfileV2 {
  readonly id: string;
  readonly name: string;
  readonly enabled: boolean;
  readonly adapterKind: AdapterKind;
  readonly providerId?: string;
  readonly providerName?: string;
  readonly modelId?: string;
  readonly modelName?: string;
  readonly baseUrl?: string;
  readonly baseUrlSource: BaseUrlSource;
  readonly catalogSnapshotId?: string;
  readonly catalogActiveSince?: string;
  readonly updatedAt: string;
}
export interface ProfileLoadResult { readonly profiles: readonly ProviderProfileV2[]; readonly warnings: readonly string[]; readonly error?: string; readonly migrated: boolean }
export const PROVIDER_V2_STORAGE_KEY = 'sage.provider-profiles.v2';
export const PROVIDER_V1_STORAGE_KEY = 'sage.provider-profiles.v1';
export const PROVIDER_SECRET_PREFIX = 'sage.provider-secret.v2:';
const keys = new Set(['id','name','enabled','adapterKind','providerId','providerName','modelId','modelName','baseUrl','baseUrlSource','catalogSnapshotId','catalogActiveSince','updatedAt']);
const nonempty = (value: unknown, max: number): value is string => typeof value === 'string' && value.trim().length > 0 && [...value].length <= max;
export const validHttpsUrl = (value: unknown): value is string => {
  if (typeof value !== 'string') return false;
  try { return new URL(value).protocol === 'https:'; } catch { return false; }
};
export function isProviderProfileV2(value: unknown): value is ProviderProfileV2 {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  if (Object.keys(item).some((key) => !keys.has(key))) return false;
  if (!nonempty(item.id, 128) || !nonempty(item.name, 200) || typeof item.enabled !== 'boolean'
    || !['unassigned','openai-compatible','anthropic'].includes(String(item.adapterKind))
    || !['none','provider','model','manual'].includes(String(item.baseUrlSource)) || !nonempty(item.updatedAt, 50)) return false;
  for (const field of ['providerId','providerName','modelId','modelName','catalogSnapshotId','catalogActiveSince'] as const) if (item[field] !== undefined && !nonempty(item[field], 300)) return false;
  if (item.baseUrl !== undefined && !validHttpsUrl(item.baseUrl)) return false;
  if (item.baseUrlSource !== 'none' && item.baseUrl === undefined) return false;
  if (item.baseUrlSource === 'none' && item.baseUrl !== undefined) return false;
  return !Number.isNaN(Date.parse(String(item.updatedAt)));
}

export function profileCompletion(profile: ProviderProfileV2): { readonly status: 'Disabled' | 'Incomplete' | 'Available metadata'; readonly executionAvailable: boolean } {
  if (!profile.enabled) return { status: 'Disabled', executionAvailable: false };
  const metadata = Boolean(profile.providerId && profile.providerName && profile.modelId && profile.modelName);
  const urlReady = profile.adapterKind === 'unassigned' || validHttpsUrl(profile.baseUrl);
  if (!metadata || !urlReady) return { status: 'Incomplete', executionAvailable: false };
  return { status: 'Available metadata', executionAvailable: profile.adapterKind !== 'unassigned' };
}

export function loadProviderProfiles(storage: Storage): ProfileLoadResult {
  const rawV2 = storage.getItem(PROVIDER_V2_STORAGE_KEY);
  if (rawV2 !== null) {
    try {
      const parsed = JSON.parse(rawV2) as unknown;
      if (!Array.isArray(parsed)) return { profiles: [], warnings: [], error: 'Provider profile v2 storage is malformed and was not overwritten.', migrated: false };
      const profiles = parsed.filter(isProviderProfileV2);
      const warnings = profiles.length === parsed.length ? [] : ['Some invalid v2 profiles were isolated; original storage was not overwritten.'];
      return { profiles, warnings, ...(warnings.length ? { error: warnings[0] } : {}), migrated: false };
    } catch { return { profiles: [], warnings: [], error: 'Provider profile v2 storage is malformed and was not overwritten.', migrated: false }; }
  }
  const rawV1 = storage.getItem(PROVIDER_V1_STORAGE_KEY);
  if (rawV1 === null) return { profiles: [], warnings: [], migrated: false };
  try {
    const legacy = JSON.parse(rawV1) as unknown;
    if (!Array.isArray(legacy)) return { profiles: [], warnings: [], error: 'Legacy provider storage is malformed and was preserved.', migrated: false };
    const warnings: string[] = [];
    const profiles: ProviderProfileV2[] = [];
    for (const value of legacy) {
      if (value === null || typeof value !== 'object') { warnings.push('An invalid legacy profile was isolated.'); continue; }
      const item = value as Record<string, unknown>;
      if (item.kind === 'local') { warnings.push('Legacy local runtime entries were isolated from external profiles.'); continue; }
      if (!nonempty(item.id, 128) || !nonempty(item.name, 200) || !nonempty(item.model, 300) || !nonempty(item.updatedAt, 50)
        || !['openai-compatible','anthropic'].includes(String(item.kind)) || typeof item.enabled !== 'boolean') { warnings.push('An invalid legacy profile was isolated.'); continue; }
      const baseUrl = validHttpsUrl(item.baseUrl) ? item.baseUrl : undefined;
      const enabled = item.enabled && baseUrl !== undefined;
      if (item.enabled && !enabled) warnings.push(`Legacy profile ${item.id} was disabled because its HTTPS base URL is incomplete.`);
      profiles.push({
        id: item.id, name: item.name, enabled, adapterKind: item.kind as AdapterKind,
        providerId: item.id, providerName: item.name, modelId: item.model, modelName: item.model,
        ...(baseUrl ? { baseUrl, baseUrlSource: 'manual' as const } : { baseUrlSource: 'none' as const }),
        updatedAt: item.updatedAt
      });
    }
    storage.setItem(PROVIDER_V2_STORAGE_KEY, JSON.stringify(profiles));
    return { profiles, warnings, migrated: true };
  } catch { return { profiles: [], warnings: [], error: 'Legacy provider storage is malformed and was preserved.', migrated: false }; }
}

export function saveProviderProfiles(storage: Storage, profiles: readonly ProviderProfileV2[]): void {
  if (profiles.some((profile) => !isProviderProfileV2(profile))) throw new Error('Invalid ProviderProfileV2 metadata');
  storage.setItem(PROVIDER_V2_STORAGE_KEY, JSON.stringify(profiles));
}
export const secretPresent = (storage: Storage, profileId: string): boolean => (storage.getItem(`${PROVIDER_SECRET_PREFIX}${profileId}`) ?? '').length > 0;
export const saveProfileSecret = (storage: Storage, profileId: string, value: string): void => {
  if (value === '') storage.removeItem(`${PROVIDER_SECRET_PREFIX}${profileId}`); else storage.setItem(`${PROVIDER_SECRET_PREFIX}${profileId}`, value);
};

export function applyCatalogSelection(provider: ProviderCatalogItem, model: ModelCatalogItem, page: { snapshotId: string; activeSince: string }, current?: ProviderProfileV2): Pick<ProviderProfileV2, 'providerId'|'providerName'|'modelId'|'modelName'|'baseUrl'|'baseUrlSource'|'catalogSnapshotId'|'catalogActiveSince'> {
  if (model.providerId !== provider.providerId) throw new Error('Model does not belong to selected provider');
  const modelUrl = validHttpsUrl(model.modelApi) ? model.modelApi : undefined;
  const providerUrl = validHttpsUrl(provider.api) ? provider.api : undefined;
  const source = modelUrl ? 'model' as const : providerUrl ? 'provider' as const : 'none' as const;
  const baseUrl = modelUrl ?? providerUrl;
  // Daily catalog changes never call this function; only an explicit user selection can replace saved metadata.
  void current;
  return { providerId: provider.providerId, providerName: provider.name, modelId: model.modelId, modelName: model.name,
    ...(baseUrl ? { baseUrl, baseUrlSource: source } : { baseUrlSource: source }), catalogSnapshotId: page.snapshotId, catalogActiveSince: page.activeSince };
}
