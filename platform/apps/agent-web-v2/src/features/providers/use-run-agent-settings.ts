import { useCallback, useEffect, useRef, useState } from "react";
import type { ApiClient } from "@/lib/api";
import type { RunAgentSettings } from "@/types/workspace";

/**
 * Run Agent default model settings (spec §8.1): load on mount; selecting an
 * available connection saves immediately (`PUT /run-agent/settings`); empty
 * selections never save; re-selection is blocked while a save is in flight.
 */
export function useRunAgentSettings(client: ApiClient) {
  const [settings, setSettings] = useState<RunAgentSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const savingRef = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    client
      .request<RunAgentSettings>("/run-agent/settings", { signal: controller.signal })
      .then((data) => {
        if (controller.signal.aborted) return;
        setSettings(data);
        setError(null);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setError(err);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [client, reloadToken]);

  const reload = useCallback(() => setReloadToken((token) => token + 1), []);

  const select = useCallback(
    (providerConnectionId: string) => {
      // Empty (unset) selections never trigger a save (spec §8.1.8).
      if (!providerConnectionId || savingRef.current) return;
      savingRef.current = true;
      setSaving(true);
      setSaved(false);
      client
        .request<RunAgentSettings>("/run-agent/settings", {
          method: "PUT",
          body: { providerConnectionId },
        })
        .then((data) => {
          setSettings(data);
          setError(null);
          setSaved(true);
        })
        .catch((err: unknown) => {
          setError(err);
        })
        .finally(() => {
          savingRef.current = false;
          setSaving(false);
        });
    },
    [client],
  );

  return { settings, loading, error, saving, saved, select, reload };
}
