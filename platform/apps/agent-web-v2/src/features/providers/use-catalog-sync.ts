import { useCallback, useEffect, useRef, useState } from "react";
import type { CatalogSyncAttempt } from "@sage/app-contracts";
import { ApiError, type ApiClient } from "@/lib/api";
import { isSyncTerminal, syncRetryAfterSeconds } from "./logic";

/**
 * Manual catalog sync (spec §8.3 "Catalog 刷新"): POST the sync, then poll the
 * attempt once per second, at most 10 times, until a terminal status. 429
 * surfaces a rate-limited error preferring `error.retryAfterSeconds`
 * (default 60s); 403 surfaces forbidden. The button stays disabled while a
 * sync runs.
 */

export const SYNC_POLL_INTERVAL_MS = 1000;
export const SYNC_MAX_POLLS = 10;

export type CatalogSyncError =
  | { kind: "rate-limited"; retryAfterSeconds: number }
  | { kind: "forbidden" }
  | { kind: "failed"; message: string };

export function useCatalogSync(client: ApiClient, onCompleted: () => void) {
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<CatalogSyncError | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const runningRef = useRef(false);
  const onCompletedRef = useRef(onCompleted);
  onCompletedRef.current = onCompleted;

  const stop = useCallback(() => {
    runningRef.current = false;
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setSyncing(false);
  }, []);

  useEffect(() => stop, [stop]);

  const start = useCallback(() => {
    if (runningRef.current) return;
    runningRef.current = true;
    setSyncing(true);
    setError(null);

    const poll = (attemptId: string, count: number) => {
      if (!runningRef.current) return;
      if (count > SYNC_MAX_POLLS) {
        stop();
        return;
      }
      timerRef.current = setTimeout(() => {
        client
          .request<CatalogSyncAttempt>(`/provider-catalog/sync/${encodeURIComponent(attemptId)}`)
          .then((attempt) => {
            if (!runningRef.current) return;
            if (isSyncTerminal(attempt.status)) {
              if (attempt.status === "failed") {
                setError({ kind: "failed", message: attempt.errorCode ?? attempt.status });
              }
              stop();
              onCompletedRef.current();
              return;
            }
            poll(attemptId, count + 1);
          })
          .catch((err: unknown) => {
            if (!runningRef.current) return;
            setError({ kind: "failed", message: err instanceof Error ? err.message : "poll failed" });
            stop();
          });
      }, SYNC_POLL_INTERVAL_MS);
    };

    client
      .request<CatalogSyncAttempt>("/provider-catalog/sync", { method: "POST", body: {} })
      .then((attempt) => {
        if (!runningRef.current) return;
        poll(attempt.attemptId, 1);
      })
      .catch((err: unknown) => {
        if (!runningRef.current) return;
        if (err instanceof ApiError && err.status === 429) {
          setError({ kind: "rate-limited", retryAfterSeconds: syncRetryAfterSeconds(err.retryAfterSeconds) });
        } else if (err instanceof ApiError && err.status === 403) {
          setError({ kind: "forbidden" });
        } else {
          setError({ kind: "failed", message: err instanceof Error ? err.message : "sync failed" });
        }
        stop();
      });
  }, [client, stop]);

  return { syncing, error, start };
}
