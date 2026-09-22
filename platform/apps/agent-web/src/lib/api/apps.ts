import type { ApiCtx } from './client'
import { apiFetch, fetchJson } from './client'
import type { AppDetail, AppListItem, PackageRunResult } from './types'

function toAppListItem(raw: Record<string, unknown>): AppListItem {
  const updatedAt = typeof raw.updatedAt === 'string' ? raw.updatedAt
    : typeof raw.createdAt === 'string' ? raw.createdAt
      : undefined
  return {
    packageId: String(raw.appId ?? ''),
    name: String(raw.name ?? raw.appId ?? ''),
    description: typeof raw.description === 'string' ? raw.description : undefined,
    releaseCount: typeof raw.releaseCount === 'number' ? raw.releaseCount : 0,
    latestVersion: typeof raw.latestVersion === 'string' ? raw.latestVersion : undefined,
    latestContentDigest: typeof raw.latestContentDigest === 'string' ? raw.latestContentDigest : undefined,
    updatedAt,
  }
}

export async function listApps(ctx: ApiCtx, signal?: AbortSignal): Promise<AppListItem[]> {
  const response = await fetchJson<{ apps?: Record<string, unknown>[]; items?: Record<string, unknown>[] }>(
    ctx,
    '/apps',
    { signal },
  )
  const raw = response?.apps ?? response?.items ?? []
  return raw.map(toAppListItem).filter((item) => item.packageId)
}

export function getApp(ctx: ApiCtx, appId: string, signal?: AbortSignal): Promise<AppDetail | null> {
  return fetchJson(ctx, `/apps/${encodeURIComponent(appId)}`, { signal })
}

export function createApp(ctx: ApiCtx, input: { appId: string; name: string; description?: string }): Promise<unknown | null> {
  const body: Record<string, unknown> = { appId: input.appId, name: input.name }
  if (input.description) body.description = input.description
  return fetchJson(ctx, '/apps', { method: 'POST', body })
}

export async function deleteApp(ctx: ApiCtx, appId: string): Promise<void> {
  await apiFetch(ctx, `/apps/${encodeURIComponent(appId)}`, { method: 'DELETE' })
}

export function createReleaseFromFiles(ctx: ApiCtx, appId: string, files: Record<string, string>): Promise<unknown | null> {
  return fetchJson(ctx, `/apps/${encodeURIComponent(appId)}/releases`, { method: 'POST', body: { files } })
}

export function uploadReleaseArchive(ctx: ApiCtx, appId: string, file: File): Promise<unknown | null> {
  const formData = new FormData()
  formData.set('file', file)
  return fetchJson(ctx, `/apps/${encodeURIComponent(appId)}/releases`, { method: 'POST', formData })
}

export function startPackageRun(
  ctx: ApiCtx,
  releaseId: string,
  args: { task?: string; params: Record<string, string | number> },
): Promise<PackageRunResult | null> {
  const body: Record<string, unknown> = { params: args.params }
  if (args.task) body.task = args.task
  return fetchJson(ctx, `/releases/${encodeURIComponent(releaseId)}/runs`, { method: 'POST', body })
}
