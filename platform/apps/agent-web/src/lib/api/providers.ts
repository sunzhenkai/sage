import type { ModelCatalogPage, ProviderCatalogPage } from '@sage/app-contracts'

import type { ApiCtx } from './client'
import { apiFetch, fetchJson } from './client'
import type { RunAgentSettingsView, WorkspaceProviderView } from './types'

export interface ProviderConnectionsResponse {
  schemaVersion?: 'ProviderConnections.v1'
  connections?: WorkspaceProviderView[]
}

export interface SaveProviderConnectionInput {
  name: string
  adapterKind: 'anthropic' | 'openai-compatible'
  baseUrl: string
  modelId: string
  apiKey?: string
  providerName?: string
  modelName?: string
}

export function getRunAgentSettings(ctx: ApiCtx, signal?: AbortSignal): Promise<RunAgentSettingsView | null> {
  return fetchJson(ctx, '/run-agent/settings', { signal })
}

export function saveRunAgentSettings(ctx: ApiCtx, providerConnectionId: string): Promise<RunAgentSettingsView | null> {
  return fetchJson(ctx, '/run-agent/settings', {
    method: 'PUT',
    body: { providerConnectionId },
  })
}

export function listProviderConnections(ctx: ApiCtx, signal?: AbortSignal): Promise<ProviderConnectionsResponse | null> {
  return fetchJson(ctx, '/provider-connections', { signal })
}

function connectionBody(input: SaveProviderConnectionInput): Record<string, unknown> {
  const body: Record<string, unknown> = {
    name: input.name,
    adapterKind: input.adapterKind,
    baseUrl: input.baseUrl,
    modelId: input.modelId,
  }
  if (input.apiKey) body.apiKey = input.apiKey
  if (input.providerName) body.providerName = input.providerName
  if (input.modelName) body.modelName = input.modelName
  return body
}

export function createProviderConnection(ctx: ApiCtx, input: SaveProviderConnectionInput): Promise<unknown | null> {
  return fetchJson(ctx, '/provider-connections', { method: 'POST', body: connectionBody(input) })
}

export function updateProviderConnection(ctx: ApiCtx, id: string, input: SaveProviderConnectionInput): Promise<unknown | null> {
  return fetchJson(ctx, `/provider-connections/${encodeURIComponent(id)}`, { method: 'PUT', body: connectionBody(input) })
}

export async function deleteProviderConnection(ctx: ApiCtx, id: string): Promise<void> {
  await apiFetch(ctx, `/provider-connections/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

export function searchCatalogProviders(ctx: ApiCtx, query: string, cursor?: string, signal?: AbortSignal): Promise<ProviderCatalogPage | null> {
  const params = new URLSearchParams()
  params.set('limit', '100')
  if (query.trim()) params.set('q', query.trim())
  if (cursor) params.set('cursor', cursor)
  return fetchJson(ctx, `/provider-catalog/providers?${params.toString()}`, { signal })
}

export function searchCatalogModels(
  ctx: ApiCtx,
  args: { providerId: string; query: string; cursor?: string; signal?: AbortSignal },
): Promise<ModelCatalogPage | null> {
  const params = new URLSearchParams()
  params.set('limit', '100')
  params.set('providerId', args.providerId)
  params.set('status', 'all')
  if (args.query.trim()) params.set('q', args.query.trim())
  if (args.cursor) params.set('cursor', args.cursor)
  return fetchJson(ctx, `/provider-catalog/models?${params.toString()}`, { signal: args.signal })
}

export interface CatalogSyncAttemptResult {
  attemptId?: string
}

export function startCatalogSync(ctx: ApiCtx): Promise<CatalogSyncAttemptResult | null> {
  return fetchJson(ctx, '/provider-catalog/sync', { method: 'POST', body: {} })
}

export interface CatalogSyncStatusResult {
  status?: string
  errorCode?: string
}

export function getCatalogSyncStatus(ctx: ApiCtx, attemptId: string, signal?: AbortSignal): Promise<CatalogSyncStatusResult | null> {
  return fetchJson(ctx, `/provider-catalog/sync/${encodeURIComponent(attemptId)}`, { signal })
}
