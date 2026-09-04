import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, type ApiClient } from "@/lib/api";
import { mergeCatalogItems } from "./logic";

/**
 * Catalog search (spec §8.3): 250ms debounced query against
 * `/provider-catalog/providers` or `/provider-catalog/models`, cursor
 * pagination merged with id dedupe (spec §13.6), and request-token +
 * AbortController guards so out-of-order responses never overwrite newer
 * state (spec §13.1). A 409 means the cursor/snapshot changed: show a notice
 * and reload the first page instead of failing (spec §8.3 "Snapshot changed").
 */

export const CATALOG_DEBOUNCE_MS = 250;

const CATALOG_UNAVAILABLE_CODES: ReadonlySet<string> = new Set([
  "CATALOG_UNAVAILABLE",
  "CATALOG_PROJECTION_UNAVAILABLE",
]);

interface CatalogPage<T> {
  items: T[];
  nextCursor?: string | undefined;
}

export interface CatalogSearchOptions<T> {
  client: ApiClient;
  /** e.g. "/provider-catalog/providers". */
  path: string;
  keyOf: (item: T) => string;
  /** When false (e.g. no provider selected for model search) nothing loads. */
  enabled?: boolean;
  /** Extra query params, e.g. `{ providerId, status: "all" }` for models. */
  extraParams?: Record<string, string> | undefined;
}

function catalogUrl(path: string, extraParams: Record<string, string>, q: string, cursor?: string): string {
  const params = new URLSearchParams();
  params.set("limit", "100");
  for (const [key, value] of Object.entries(extraParams)) params.set(key, value);
  if (q) params.set("q", q);
  if (cursor) params.set("cursor", cursor);
  return `${path}?${params.toString()}`;
}

export function useCatalogSearch<T>({ client, path, keyOf, enabled = true, extraParams }: CatalogSearchOptions<T>) {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [items, setItems] = useState<T[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [snapshotChanged, setSnapshotChanged] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const tokenRef = useRef(0);
  const nextCursorRef = useRef<string | undefined>(undefined);
  const extraKey = JSON.stringify(extraParams ?? {});

  useEffect(() => {
    const handle = setTimeout(() => setDebouncedQuery(query.trim()), CATALOG_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [query]);

  // First-page load. Re-runs on debounced query / params / explicit reload.
  useEffect(() => {
    if (!enabled) {
      tokenRef.current += 1;
      setItems([]);
      setHasMore(false);
      setLoading(false);
      setError(null);
      setSnapshotChanged(false);
      return;
    }
    const token = ++tokenRef.current;
    const controller = new AbortController();
    const parsed = JSON.parse(extraKey) as Record<string, string>;

    const fetchFirstPage = (isRetryAfter409: boolean) => {
      setLoading(true);
      setError(null);
      client
        .request<CatalogPage<T>>(catalogUrl(path, parsed, debouncedQuery), { signal: controller.signal })
        .then((page) => {
          if (token !== tokenRef.current) return;
          nextCursorRef.current = page.nextCursor;
          setItems(mergeCatalogItems([], page.items, keyOf));
          setHasMore(Boolean(page.nextCursor));
          setUnavailable(false);
        })
        .catch((err: unknown) => {
          if (token !== tokenRef.current || controller.signal.aborted) return;
          if (err instanceof ApiError && err.status === 409) {
            setSnapshotChanged(true);
            if (!isRetryAfter409) {
              fetchFirstPage(true);
              return;
            }
          }
          if (err instanceof ApiError && CATALOG_UNAVAILABLE_CODES.has(err.code ?? "")) {
            setUnavailable(true);
          }
          setError(err);
        })
        .finally(() => {
          if (token === tokenRef.current && !controller.signal.aborted) setLoading(false);
        });
    };

    setItems([]);
    setHasMore(false);
    setSnapshotChanged(false);
    fetchFirstPage(false);
    return () => controller.abort();
  }, [client, path, enabled, debouncedQuery, extraKey, reloadToken]);

  const loadMore = useCallback(() => {
    const cursor = nextCursorRef.current;
    if (!enabled || !cursor) return;
    const token = tokenRef.current;
    const parsed = JSON.parse(extraKey) as Record<string, string>;
    setLoadingMore(true);
    client
      .request<CatalogPage<T>>(catalogUrl(path, parsed, debouncedQuery, cursor))
      .then((page) => {
        if (token !== tokenRef.current) return;
        nextCursorRef.current = page.nextCursor;
        setItems((previous) => mergeCatalogItems(previous, page.items, keyOf));
        setHasMore(Boolean(page.nextCursor));
      })
      .catch((err: unknown) => {
        if (token !== tokenRef.current) return;
        if (err instanceof ApiError && err.status === 409) {
          // Snapshot changed mid-pagination: reload the first page (spec §8.3).
          setSnapshotChanged(true);
          setReloadToken((value) => value + 1);
          return;
        }
        setError(err);
      })
      .finally(() => {
        if (token === tokenRef.current) setLoadingMore(false);
      });
  }, [client, path, enabled, debouncedQuery, extraKey, keyOf]);

  /** Reload the first page (e.g. after a catalog sync completed). */
  const reloadFirstPage = useCallback(() => setReloadToken((value) => value + 1), []);

  const reset = useCallback(() => {
    setQuery("");
    setDebouncedQuery("");
  }, []);

  return {
    query,
    setQuery,
    items,
    loading,
    loadingMore,
    hasMore,
    unavailable,
    snapshotChanged,
    error,
    loadMore,
    reloadFirstPage,
    reset,
  };
}
