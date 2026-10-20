import type { ReleasePayload, StoredRelease } from '@sage/agent-release-registry';

export interface DispatchReleaseStore {
  resolveImmutableRelease(tenantId: string, releaseRef: string): { readonly release: ReleasePayload };
  getStoredRelease(tenantId: string, releaseRef: string): StoredRelease | undefined;
  getApp(tenantId: string, appId: string): { readonly app: { readonly status: 'active' | 'deleted' } } | undefined;
  listAppReleases(tenantId: string, appId: string): readonly StoredRelease[];
}

export interface ResolveDispatchReleaseInput {
  readonly store: DispatchReleaseStore;
  readonly tenantId: string;
  readonly anchorReleaseId: string;
  readonly follow: boolean;
}

export interface ResolvedDispatchRelease {
  readonly release: ReleasePayload;
  readonly lockPayload: Readonly<Record<string, unknown>>;
}

/**
 * 调度派发解析：锚点 Release 必须存在且所属 App 未删除。
 * FOLLOW 取锚点 App 的最新 Release（listAppReleases[0]）；FIXED 保持锚点。
 */
export function resolveDispatchRelease(input: ResolveDispatchReleaseInput): ResolvedDispatchRelease | undefined {
  const anchorRef = `release://${input.anchorReleaseId}`;
  let anchor: { readonly release: ReleasePayload };
  try {
    anchor = input.store.resolveImmutableRelease(input.tenantId, anchorRef);
  } catch {
    return undefined;
  }
  if (input.store.getApp(input.tenantId, anchor.release.packageId) === undefined) return undefined;
  if (input.follow) {
    const latest = input.store.listAppReleases(input.tenantId, anchor.release.packageId)[0];
    return latest === undefined ? undefined : { release: latest.release, lockPayload: latest.lockPayload };
  }
  const stored = input.store.getStoredRelease(input.tenantId, anchorRef);
  return { release: anchor.release, lockPayload: stored?.lockPayload ?? {} };
}
