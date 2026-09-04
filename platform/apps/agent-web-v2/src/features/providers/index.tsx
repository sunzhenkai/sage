import { useState } from "react";
import { apiClient, type ApiClient } from "@/lib/api";
import { useI18n, type Locale } from "@/lib/i18n";
import type { WorkspaceProviderView } from "@/types/workspace";
import { Banner } from "@/components/feedback";
import { DefaultModelCard } from "./default-model-card";
import { ConnectionList } from "./connection-list";
import { ConnectionFormDialog, type ConnectionDialogMode } from "./connection-form-dialog";
import { useRunAgentSettings } from "./use-run-agent-settings";
import { useProviderConnections } from "./use-provider-connections";

/**
 * Providers view (spec §8): Run Agent default model (§8.1), workspace
 * provider connections CRUD (§8.2) with catalog-assisted creation (§8.3).
 * The page also exposes the language switcher required by §4.1.
 */
export function ProvidersView({ client = apiClient }: { client?: ApiClient }) {
  const { t, locale, setLocale } = useI18n();
  const settings = useRunAgentSettings(client);
  const { connections, loading, error, reload, remove } = useProviderConnections(client);
  const [dialog, setDialog] = useState<ConnectionDialogMode | null>(null);
  const [notice, setNotice] = useState<"saved" | "deleted" | null>(null);

  const defaultConnectionId =
    settings.settings && !settings.settings.unset ? settings.settings.providerConnectionId : undefined;

  const onSaved = () => {
    setDialog(null);
    setNotice("saved");
    reload();
    // Availability of the default model may have changed too.
    settings.reload();
  };

  return (
    <section aria-label={t("providers.viewLabel")} className="space-y-6 p-6">
      <header className="flex items-center justify-between gap-4">
        <h1 className="text-lg font-semibold">{t("shell.navProviders")}</h1>
        <div className="flex items-center gap-2">
          <label htmlFor="providers-locale-select" className="text-sm text-muted-foreground">
            {t("shell.languageLabel")}
          </label>
          <select
            id="providers-locale-select"
            aria-label={t("shell.languageLabel")}
            value={locale}
            onChange={(event) => setLocale(event.target.value as Locale)}
            className="h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="zh-CN">{t("shell.localeZhCN")}</option>
            <option value="en">{t("shell.localeEn")}</option>
          </select>
        </div>
      </header>

      {notice ? (
        <Banner variant="success" onDismiss={() => setNotice(null)}>
          {notice === "saved" ? t("providers.savedNotice") : t("providers.deletedNotice")}
        </Banner>
      ) : null}

      <DefaultModelCard state={settings} />

      <ConnectionList
        connections={connections}
        loading={loading}
        error={error}
        defaultConnectionId={defaultConnectionId}
        onAdd={() => setDialog({ kind: "create" })}
        onEdit={(connection: WorkspaceProviderView) => setDialog({ kind: "edit", connection })}
        onDelete={remove}
        onDeleted={() => setNotice("deleted")}
      />

      {dialog ? (
        <ConnectionFormDialog client={client} mode={dialog} onClose={() => setDialog(null)} onSaved={onSaved} />
      ) : null}
    </section>
  );
}
