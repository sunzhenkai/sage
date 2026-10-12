import { createHash } from 'node:crypto';
import type { ModelCatalogItem, ProviderCatalogItem } from '@sage/app-contracts';

export class CatalogPayloadError extends Error {
  readonly code: 'SOURCE_INVALID_JSON' | 'SOURCE_SCHEMA_INVALID';
  constructor(code: CatalogPayloadError['code'], message: string, options?: ErrorOptions) { super(message, options); this.code = code; }
}

export interface CatalogProjection {
  readonly providers: readonly ProviderCatalogItem[];
  readonly models: readonly ModelCatalogItem[];
}
export interface ValidatedCatalogPayload {
  readonly rawPayload: Readonly<Record<string, unknown>>;
  readonly contentSha256: string;
  readonly providerCount: number;
  readonly modelCount: number;
  readonly projection: CatalogProjection;
}

const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const bounded = (value: unknown, field: string, maxLength: number): string => {
  if (typeof value !== 'string' || value.trim() === '' || [...value].length > maxLength) throw new CatalogPayloadError('SOURCE_SCHEMA_INVALID', `${field} must be a non-empty bounded string`);
  return value;
};
const httpsUrl = (value: unknown): string | undefined => {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw new CatalogPayloadError('SOURCE_SCHEMA_INVALID', 'Catalog URL field must be a string when present');
  try { const parsed = new URL(value); return parsed.protocol === 'https:' ? parsed.toString() : undefined; }
  catch { return undefined; }
};
const optionalString = (value: unknown, field: string, maxLength: number): string | undefined => value === undefined ? undefined : bounded(value, field, maxLength);
/** models.dev `release_date`：合法 `YYYY-MM-DD` 或月份精度 `YYYY-MM`（实测上游 218/7285 为后者）进入 projection 为 `releaseDate`；缺失不产生字段；存在但非法整批拒绝。 */
const releaseDateOf = (value: unknown): string | undefined => {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}(-\d{2})?$/.test(value) || Number.isNaN(Date.parse(value))) {
    throw new CatalogPayloadError('SOURCE_SCHEMA_INVALID', 'model.release_date must be a valid YYYY-MM-DD or YYYY-MM date string');
  }
  return value;
};
const modelStatus = (value: unknown): ModelCatalogItem['status'] => {
  if (value === undefined) return 'active';
  if (value === 'active' || value === 'deprecated' || value === 'legacy') return value;
  if (typeof value !== 'string' || value.trim() === '') throw new CatalogPayloadError('SOURCE_SCHEMA_INVALID', 'model.status is invalid');
  return 'active';
};
const capabilitiesOf = (model: Record<string, unknown>): string[] => {
  if (model.capabilities !== undefined) {
    if (!Array.isArray(model.capabilities) || model.capabilities.length > 64 || model.capabilities.some((item) => typeof item !== 'string' || item.length === 0 || item.length > 100)) throw new CatalogPayloadError('SOURCE_SCHEMA_INVALID', 'model.capabilities is invalid');
    return [...new Set(model.capabilities as string[])].sort();
  }
  if (model.modalities === undefined) return [];
  if (!record(model.modalities)) throw new CatalogPayloadError('SOURCE_SCHEMA_INVALID', 'model.modalities is invalid');
  const capabilities: string[] = [];
  for (const direction of ['input', 'output'] as const) {
    const values = model.modalities[direction];
    if (values === undefined) continue;
    if (!Array.isArray(values) || values.some((item) => typeof item !== 'string' || item.length === 0 || item.length > 100)) throw new CatalogPayloadError('SOURCE_SCHEMA_INVALID', `model.modalities.${direction} is invalid`);
    for (const value of values as string[]) capabilities.push(`${direction}:${value}`);
  }
  return [...new Set(capabilities)].sort();
};
const deepFreeze = <T>(value: T): T => {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
  }
  return value;
};

export function validateCatalogPayload(bytes: Uint8Array): ValidatedCatalogPayload {
  let parsed: unknown;
  try { parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch (cause) { throw new CatalogPayloadError('SOURCE_INVALID_JSON', 'models.dev payload is not valid UTF-8 JSON', { cause }); }
  if (!record(parsed)) throw new CatalogPayloadError('SOURCE_SCHEMA_INVALID', 'Catalog root must be a provider map object');
  const providers: ProviderCatalogItem[] = [];
  const models: ModelCatalogItem[] = [];
  for (const [providerKey, rawProvider] of Object.entries(parsed)) {
    if (!record(rawProvider)) throw new CatalogPayloadError('SOURCE_SCHEMA_INVALID', `Provider ${providerKey} must be an object`);
    const providerId = bounded(rawProvider.id, `provider ${providerKey}.id`, 128);
    if (providerId !== providerKey) throw new CatalogPayloadError('SOURCE_SCHEMA_INVALID', `Provider map key ${providerKey} does not match id`);
    const name = bounded(rawProvider.name, `provider ${providerKey}.name`, 200);
    if (!record(rawProvider.models)) throw new CatalogPayloadError('SOURCE_SCHEMA_INVALID', `Provider ${providerKey}.models must be an object`);
    const api = httpsUrl(rawProvider.api);
    const npm = optionalString(rawProvider.npm, `provider ${providerKey}.npm`, 200);
    providers.push(deepFreeze({ providerId, name, ...(api ? { api } : {}), ...(npm ? { npm } : {}) }));
    for (const [modelKey, rawModel] of Object.entries(rawProvider.models)) {
      if (!record(rawModel)) throw new CatalogPayloadError('SOURCE_SCHEMA_INVALID', `Model ${providerKey}/${modelKey} must be an object`);
      const modelId = bounded(rawModel.id, `model ${providerKey}/${modelKey}.id`, 128);
      if (modelId !== modelKey) throw new CatalogPayloadError('SOURCE_SCHEMA_INVALID', `Model map key ${modelKey} does not match id`);
      const modelName = bounded(rawModel.name, `model ${providerKey}/${modelKey}.name`, 300);
      const providerOverride = rawModel.provider === undefined ? undefined : rawModel.provider;
      if (providerOverride !== undefined && !record(providerOverride)) throw new CatalogPayloadError('SOURCE_SCHEMA_INVALID', `model ${modelKey}.provider must be an object`);
      const modelApi = httpsUrl(providerOverride?.api);
      const effectiveBaseUrl = modelApi ?? api;
      const releaseDate = releaseDateOf(rawModel.release_date);
      models.push(deepFreeze({
        modelId, providerId, name: modelName, status: modelStatus(rawModel.status), capabilities: capabilitiesOf(rawModel),
        ...(releaseDate === undefined ? {} : { releaseDate }),
        ...(api ? { providerApi: api } : {}), ...(modelApi ? { modelApi } : {}), ...(effectiveBaseUrl ? { effectiveBaseUrl } : {})
      }));
    }
  }
  const projection = deepFreeze({ providers: deepFreeze(providers), models: deepFreeze(models) });
  return deepFreeze({
    rawPayload: parsed,
    contentSha256: createHash('sha256').update(bytes).digest('hex'),
    providerCount: providers.length,
    modelCount: models.length,
    projection
  });
}
