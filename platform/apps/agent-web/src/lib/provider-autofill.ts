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

/**
 * 按适配器区分的已知端点（models.dev 只发布 OpenAI 兼容的 `api`；anthropic 一侧为实测可连通的兜底值）。
 * 也用于在 provider 未知时按主机名反查，例如编辑一个手填名称的既有连接。
 */
export const PROVIDER_ENDPOINTS: Readonly<Record<string, { readonly openaiCompatible?: string; readonly anthropic?: string }>> = Object.freeze({
  anthropic: { anthropic: 'https://api.anthropic.com/v1' },
  deepseek: { openaiCompatible: 'https://api.deepseek.com', anthropic: 'https://api.deepseek.com/anthropic' },
  zhipuai: { openaiCompatible: 'https://open.bigmodel.cn/api/paas/v4', anthropic: 'https://open.bigmodel.cn/api/anthropic' },
  'minimax-cn': { openaiCompatible: 'https://api.minimax.cn/v1', anthropic: 'https://api.minimax.cn/anthropic/v1' },
  minimax: { openaiCompatible: 'https://api.minimaxi.com/v1', anthropic: 'https://api.minimaxi.com/anthropic' }
});

const hostOf = (value: string | undefined): string | undefined => {
  if (value === undefined) return undefined;
  try { return new URL(value).host; } catch { return undefined; }
};

const trimUrl = (url: URL): string => {
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/$/u, '');
};

/**
 * models.dev 对双协议厂商常只发 Anthropic 路径（`…/anthropic/v1`）。
 * 在已知表未命中时，按路径投影到 openai-compatible / anthropic 兄弟；单协议 URL 不臆造。
 */
export function baseUrlForAdapter(catalogUrl: string, adapter: AdapterKind): string {
  if (!isUsableBaseUrl(catalogUrl)) return catalogUrl;
  let parsed: URL;
  try { parsed = new URL(catalogUrl); } catch { return catalogUrl; }
  const path = parsed.pathname.replace(/\/+$/u, '');
  if (!/\/anthropic(?:\/v1)?$/u.test(path)) return catalogUrl;
  if (adapter === 'anthropic') {
    parsed.pathname = path;
    return trimUrl(parsed);
  }
  parsed.pathname = path.endsWith('/anthropic/v1')
    ? `${path.slice(0, -'/anthropic/v1'.length)}/v1`
    : `${path.slice(0, -'/anthropic'.length)}/v1`;
  return trimUrl(parsed);
}

/** 某适配器下的已知端点：先按 providerId，再按主机名反查，最后对 `…/anthropic[/v1]` 做路径投影。 */
export function adapterBaseUrl(adapter: AdapterKind, providerId: string | undefined, baseUrl: string | undefined): string | undefined {
  const key = adapter === 'anthropic' ? 'anthropic' : 'openaiCompatible';
  const direct = providerId === undefined ? undefined : PROVIDER_ENDPOINTS[providerId]?.[key];
  if (direct !== undefined) return direct;
  const host = hostOf(baseUrl);
  if (host !== undefined) {
    const match = Object.values(PROVIDER_ENDPOINTS).find((entry) => Object.values(entry).some((url) => hostOf(url) === host));
    const fromHost = match?.[key];
    if (fromHost !== undefined) return fromHost;
  }
  if (baseUrl === undefined || !isUsableBaseUrl(baseUrl)) return undefined;
  return baseUrlForAdapter(baseUrl, adapter);
}

/** 可用作 baseUrl 的值：公开 HTTPS，且不含 models.dev 里的 `${ENV}` 模板段（如 azure 资源名）。 */
export function isUsableBaseUrl(value: string | undefined): value is string {
  return value !== undefined && value.length > 0 && !value.includes('${') && /^https:\/\/\S+$/iu.test(value);
}

export type CatalogBaseUrlSource = 'model' | 'provider' | 'known';
export interface CatalogBaseUrl { readonly url: string; readonly source: CatalogBaseUrlSource }

/** 自动填充优先级：适配器已知端点 → 模型级覆盖 → provider `api`（按适配器投影）→ 已知默认端点。 */
export function catalogBaseUrl(provider: CatalogProviderItem | undefined, model: CatalogModelItem | undefined, adapter?: AdapterKind): CatalogBaseUrl | undefined {
  if (adapter !== undefined && provider !== undefined) {
    const knownForAdapter = PROVIDER_ENDPOINTS[provider.providerId]?.[adapter === 'anthropic' ? 'anthropic' : 'openaiCompatible'];
    if (isUsableBaseUrl(knownForAdapter)) return { url: knownForAdapter, source: 'known' };
  }
  if (isUsableBaseUrl(model?.effectiveBaseUrl)) {
    return { url: adapter === undefined ? model.effectiveBaseUrl : baseUrlForAdapter(model.effectiveBaseUrl, adapter), source: 'model' };
  }
  if (isUsableBaseUrl(provider?.api)) {
    return { url: adapter === undefined ? provider.api : baseUrlForAdapter(provider.api, adapter), source: 'provider' };
  }
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
