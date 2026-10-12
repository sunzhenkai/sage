import { createHash } from 'node:crypto';
import type { AuthenticatedPrincipal, ListModelsQuery, ListProvidersQuery, ModelCatalogItem, ModelCatalogPage, ProviderCatalogItem, ProviderCatalogPage } from '@sage/app-contracts';
import type { PoolClient } from 'pg';
import { requireCatalogReadPrincipal } from './auth.js';
import { validateCatalogPayload } from './projection.js';
import type { ProviderCatalogStore } from './store.js';

export class CatalogServiceError extends Error {
  constructor(
    readonly code: 'CATALOG_INVALID_REQUEST' | 'CATALOG_UNAVAILABLE' | 'CATALOG_PROJECTION_UNAVAILABLE' | 'CATALOG_CURSOR_SNAPSHOT_CHANGED',
    message: string,
    readonly status: 400 | 409 | 503
  ) { super(message); }
}

interface ActiveProjection {
  readonly snapshotId: string;
  readonly activeSince: string;
  readonly stale: boolean;
  readonly providers: readonly ProviderCatalogItem[];
  readonly models: readonly ModelCatalogItem[];
}
interface CursorV1 { readonly v: 1; readonly snapshotId: string; readonly filterHash: string; readonly sortKey: readonly string[] }
const normalized = (value: string) => value.normalize('NFKC').toLocaleLowerCase('en-US');
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const encodeCursor = (value: Omit<CursorV1, 'v'>) => Buffer.from(JSON.stringify({ v: 1, ...value })).toString('base64url');
const decodeCursor = (value: string, snapshotId: string, filterHash: string): CursorV1 => {
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Partial<CursorV1>;
    if (parsed.v !== 1 || parsed.snapshotId !== snapshotId) throw new CatalogServiceError('CATALOG_CURSOR_SNAPSHOT_CHANGED', 'Catalog snapshot changed; reload the first page', 409);
    if (parsed.filterHash !== filterHash || !Array.isArray(parsed.sortKey) || parsed.sortKey.some((item) => typeof item !== 'string')) throw new CatalogServiceError('CATALOG_INVALID_REQUEST', 'Invalid or filter-mismatched Catalog cursor', 400);
    return parsed as CursorV1;
  } catch (cause) {
    if (cause instanceof CatalogServiceError) throw cause;
    throw new CatalogServiceError('CATALOG_INVALID_REQUEST', 'Invalid Catalog cursor', 400);
  }
};
const compareKeys = (left: readonly string[], right: readonly string[]) => {
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const compared = (left[index] ?? '').localeCompare(right[index] ?? '');
    if (compared !== 0) return compared;
  }
  return 0;
};
/** releaseDate 新到旧排序段：数字字符 9-补映射（`-` 不变）后，字典序升序恰为日期降序；月份精度 `YYYY-MM` 的 key 是同月日精度 key 的前缀，同月内视为最新；缺失映射为同形态最大补 `9999-99-99` 排在同 rank 最后（不可用非同形态哨兵——默认 locale 的 `localeCompare` 会把标点排在数字前）。 */
const releaseDescKey = (value: string | undefined): string => value === undefined ? '9999-99-99' : value.replace(/\d/g, (digit) => String(9 - Number(digit)));
const limitOf = (value?: string) => {
  const limit = value === undefined ? 30 : Number(value);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new CatalogServiceError('CATALOG_INVALID_REQUEST', 'limit must be between 1 and 100', 400);
  return limit;
};

export class ProviderCatalogService {
  #cache: ActiveProjection | undefined;
  #listener: PoolClient | undefined;
  #pollTimer: ReturnType<typeof setInterval> | undefined;
  #notificationHandler: (() => void) | undefined;
  constructor(readonly store: ProviderCatalogStore) {}

  async startRevisionMonitor(pollMs = 60_000): Promise<void> {
    if (this.#listener !== undefined) return;
    const listener = await this.store.pool.connect();
    this.#listener = listener;
    this.#notificationHandler = () => { this.#cache = undefined; };
    listener.on('notification', this.#notificationHandler);
    await listener.query('LISTEN provider_catalog_changed');
    this.#pollTimer = setInterval(() => { void this.#pollRevision(); }, pollMs);
    this.#pollTimer.unref?.();
  }

  async close(): Promise<void> {
    if (this.#pollTimer !== undefined) clearInterval(this.#pollTimer);
    this.#pollTimer = undefined;
    if (this.#listener !== undefined) {
      if (this.#notificationHandler !== undefined) this.#listener.off('notification', this.#notificationHandler);
      await this.#listener.query('UNLISTEN provider_catalog_changed').catch(() => undefined);
      this.#listener.release();
    }
    this.#listener = undefined; this.#notificationHandler = undefined; this.#cache = undefined;
  }

  async listProviders(principal: AuthenticatedPrincipal | undefined, query: ListProvidersQuery): Promise<ProviderCatalogPage> {
    requireCatalogReadPrincipal(principal);
    const active = await this.#active();
    const limit = limitOf(query.limit);
    const filters = { q: normalized(query.q?.trim() ?? '') };
    const filterHash = hash(filters);
    const cursor = query.cursor === undefined ? undefined : decodeCursor(query.cursor, active.snapshotId, filterHash);
    const key = (item: ProviderCatalogItem) => [normalized(item.name), normalized(item.providerId)];
    const matching = active.providers.filter((item) => filters.q === '' || normalized(`${item.name}\n${item.providerId}`).includes(filters.q));
    const start = cursor === undefined ? 0 : matching.findIndex((item) => compareKeys(key(item), cursor.sortKey) > 0);
    const offset = cursor === undefined ? 0 : start < 0 ? matching.length : start;
    const items = matching.slice(offset, offset + limit);
    const nextCursor = offset + limit < matching.length && items.at(-1) !== undefined
      ? encodeCursor({ snapshotId: active.snapshotId, filterHash, sortKey: key(items.at(-1)!) }) : undefined;
    return { schemaVersion: '1', snapshotId: active.snapshotId, activeSince: active.activeSince, stale: active.stale, items, ...(nextCursor ? { nextCursor } : {}) };
  }

  async listModels(principal: AuthenticatedPrincipal | undefined, query: ListModelsQuery): Promise<ModelCatalogPage> {
    requireCatalogReadPrincipal(principal);
    const active = await this.#active();
    const limit = limitOf(query.limit);
    const filters = { q: normalized(query.q?.trim() ?? ''), providerId: query.providerId ?? '', status: query.status ?? 'active', capability: query.capability ?? '' };
    const filterHash = hash(filters);
    const cursor = query.cursor === undefined ? undefined : decodeCursor(query.cursor, active.snapshotId, filterHash);
    const rank: Record<ModelCatalogItem['status'], string> = { active: '0', deprecated: '1', legacy: '2' };
    const key = (item: ModelCatalogItem) => [rank[item.status], releaseDescKey(item.releaseDate), normalized(item.name), normalized(item.modelId), normalized(item.providerId)];
    const matching = active.models.filter((item) =>
      (filters.providerId === '' || item.providerId === filters.providerId)
      && (filters.status === 'all' || item.status === filters.status)
      && (filters.capability === '' || item.capabilities.includes(filters.capability))
      && (filters.q === '' || normalized(`${item.name}\n${item.modelId}`).includes(filters.q)));
    const start = cursor === undefined ? 0 : matching.findIndex((item) => compareKeys(key(item), cursor.sortKey) > 0);
    const offset = cursor === undefined ? 0 : start < 0 ? matching.length : start;
    const items = matching.slice(offset, offset + limit);
    const nextCursor = offset + limit < matching.length && items.at(-1) !== undefined
      ? encodeCursor({ snapshotId: active.snapshotId, filterHash, sortKey: key(items.at(-1)!) }) : undefined;
    return { schemaVersion: '1', snapshotId: active.snapshotId, activeSince: active.activeSince, stale: active.stale, items, ...(nextCursor ? { nextCursor } : {}) };
  }

  async #active(): Promise<ActiveProjection> {
    const { state, snapshot } = await this.store.getActiveSnapshot();
    if (snapshot === undefined || state.activeSnapshotId === undefined || state.activeActivatedAt === undefined) throw new CatalogServiceError('CATALOG_UNAVAILABLE', 'Provider Catalog has no active snapshot', 503);
    if (this.#cache?.snapshotId === state.activeSnapshotId && this.#cache.activeSince === state.activeActivatedAt) return this.#cache;
    try {
      const rebuilt = validateCatalogPayload(new TextEncoder().encode(JSON.stringify(snapshot.rawPayload))).projection;
      const cache: ActiveProjection = Object.freeze({
        snapshotId: state.activeSnapshotId, activeSince: state.activeActivatedAt,
        stale: state.lastSuccessAt === undefined || Date.now() - Date.parse(state.lastSuccessAt) > 26 * 60 * 60 * 1000,
        providers: Object.freeze([...rebuilt.providers].sort((a, b) => compareKeys([normalized(a.name), normalized(a.providerId)], [normalized(b.name), normalized(b.providerId)]))),
        models: Object.freeze([...rebuilt.models].sort((a, b) => {
          const rank: Record<ModelCatalogItem['status'], string> = { active: '0', deprecated: '1', legacy: '2' };
          return compareKeys([rank[a.status], releaseDescKey(a.releaseDate), normalized(a.name), normalized(a.modelId), normalized(a.providerId)], [rank[b.status], releaseDescKey(b.releaseDate), normalized(b.name), normalized(b.modelId), normalized(b.providerId)]);
        }))
      });
      this.#cache = cache;
      return cache;
    } catch {
      throw new CatalogServiceError('CATALOG_PROJECTION_UNAVAILABLE', 'Active Provider Catalog projection could not be rebuilt', 503);
    }
  }

  async #pollRevision(): Promise<void> {
    try {
      const state = await this.store.getState();
      if (state?.activeSnapshotId !== this.#cache?.snapshotId || state?.activeActivatedAt !== this.#cache?.activeSince) this.#cache = undefined;
    } catch { /* request-time revision check remains authoritative */ }
  }
}
