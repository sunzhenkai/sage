/**
 * Auto-fill rules for provider connections created from the models.dev catalog.
 * Pure functions only — the Add-connection dialog owns all state transitions.
 */
import type { CatalogModelItem, CatalogProviderItem, ProviderConnectionWrite } from './types';

export type AdapterKind = ProviderConnectionWrite['adapterKind'];

/** models.dev `npm` 包名 → 平台 adapter；非 anthropic SDK 的 provider 一律按 OpenAI 兼容端点处理。 */
export function adapterFromNpm(npm: string | undefined): AdapterKind {
  return npm === '@ai-sdk/anthropic' ? 'anthropic' : 'openai-compatible';
}

/**
 * models.dev 对部分 provider（openai/anthropic/xai/mistral/groq 等）不发布 `api` 字段
 * （SDK 内置默认端点）。以下已是 OpenAI 兼容 / Anthropic 协议的已知默认端点，
 * 仅作 UI 兜底，不是 models.dev 数据。其余 provider 留空由用户填写。
 */
export const KNOWN_BASE_URLS: Readonly<Record<string, string>> = Object.freeze({
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com/v1',
  xai: 'https://api.x.ai/v1',
  mistral: 'https://api.mistral.ai/v1',
  groq: 'https://api.groq.com/openai/v1',
  deepinfra: 'https://api.deepinfra.com/v1/openai',
  togetherai: 'https://api.together.xyz/v1',
  cerebras: 'https://api.cerebras.ai/v1',
  cohere: 'https://api.cohere.ai/compatibility/v1'
});

/** 可用作 baseUrl 的值：公开 HTTPS，且不含 models.dev 里的 `${ENV}` 模板段（如 azure 资源名）。 */
export function isUsableBaseUrl(value: string | undefined): value is string {
  return value !== undefined && value.length > 0 && !value.includes('${') && /^https:\/\/\S+$/iu.test(value);
}

export type CatalogBaseUrlSource = 'model' | 'provider' | 'known';
export interface CatalogBaseUrl { readonly url: string; readonly source: CatalogBaseUrlSource }

/** 自动填充优先级：模型级覆盖 → provider `api` → 已知默认端点。 */
export function catalogBaseUrl(provider: CatalogProviderItem | undefined, model: CatalogModelItem | undefined): CatalogBaseUrl | undefined {
  if (isUsableBaseUrl(model?.effectiveBaseUrl)) return { url: model.effectiveBaseUrl, source: 'model' };
  if (isUsableBaseUrl(provider?.api)) return { url: provider.api, source: 'provider' };
  const known = provider === undefined ? undefined : KNOWN_BASE_URLS[provider.providerId];
  return isUsableBaseUrl(known) ? { url: known, source: 'known' } : undefined;
}

export const baseUrlSourceLabel: Readonly<Record<CatalogBaseUrlSource, string>> = Object.freeze({
  model: 'models.dev model endpoint',
  provider: 'models.dev provider endpoint',
  known: 'known default endpoint (not from models.dev)'
});

/** 连接显示名：`Provider · Model`，缺一侧时退化为另一侧。 */
export function connectionName(provider: Pick<CatalogProviderItem, 'name'> | undefined, model: Pick<CatalogModelItem, 'name'> | undefined): string | undefined {
  if (provider === undefined && model === undefined) return undefined;
  if (provider === undefined) return model?.name;
  if (model === undefined) return provider.name;
  return `${provider.name} · ${model.name}`;
}
