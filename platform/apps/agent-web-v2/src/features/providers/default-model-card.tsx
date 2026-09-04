import { useI18n } from "@/lib/i18n";
import { Banner, InlineNotice, LoadingState } from "@/components/feedback";
import { errorMessage } from "@/features/chat/types";
import type { useRunAgentSettings } from "./use-run-agent-settings";

/**
 * Run Agent default model card (spec §8.1): a select listing the unset state
 * and every registered provider; unavailable entries stay visible but are
 * marked and disabled. Choosing an available connection saves immediately;
 * while a save is in flight the select is disabled.
 */
export function DefaultModelCard({ state }: { state: ReturnType<typeof useRunAgentSettings> }) {
  const { t } = useI18n();
  const { settings, loading, error, saving, saved, select } = state;

  const current = settings?.unset
    ? undefined
    : settings?.providers.find((provider) => provider.id === settings.providerConnectionId);

  return (
    <section aria-label={t("providers.defaultModelTitle")} className="space-y-3 rounded-lg border p-4">
      <h2 className="text-sm font-semibold">{t("providers.defaultModelTitle")}</h2>
      {loading ? (
        <LoadingState label={t("common.loading")} />
      ) : error && !settings ? (
        <Banner variant="error" title={t("providers.defaultModelLoadFailed")}>
          {errorMessage(error, t("common.unknown"))}
        </Banner>
      ) : settings ? (
        <>
          <div className="space-y-1.5">
            <label htmlFor="default-model-select" className="text-sm font-medium">
              {t("providers.defaultModelLabel")}
            </label>
            <select
              id="default-model-select"
              aria-label={t("providers.defaultModelLabel")}
              disabled={saving}
              value={settings.unset ? "" : (settings.providerConnectionId ?? "")}
              onChange={(event) => select(event.target.value)}
              className="h-9 w-full max-w-md rounded-md border border-input bg-transparent px-3 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
            >
              <option value="">{t("providers.defaultModelUnset")}</option>
              {settings.providers.map((provider) => (
                <option key={provider.id} value={provider.id} disabled={!provider.available}>
                  {provider.available
                    ? provider.name
                    : `${provider.name} (${t("providers.unavailableSuffix")})`}
                </option>
              ))}
            </select>
          </div>
          {settings.unset ? (
            <InlineNotice variant="warning">{t("providers.defaultModelUnsetWarning")}</InlineNotice>
          ) : current && !current.available ? (
            <InlineNotice variant="warning">
              {t("providers.defaultModelUnavailable")}
              {current.reason ? ` ${t("providers.defaultModelUnavailableReason", { reason: current.reason })}` : ""}
            </InlineNotice>
          ) : (
            <InlineNotice variant="info">{t("providers.defaultModelReady")}</InlineNotice>
          )}
          {error ? (
            <InlineNotice variant="error">
              {t("providers.defaultModelSaveFailed")}: {errorMessage(error, t("common.unknown"))}
            </InlineNotice>
          ) : null}
          {saved ? (
            <div role="status" className="text-sm text-muted-foreground">
              {t("providers.defaultModelSaved")}
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
