import { useRef, useState } from "react";
import { PackagePlus, Plus } from "lucide-react";
import { apiClient, type ApiClient } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { navigateTo, workspaceHref } from "@/app/router";
import { Button } from "@/components/ui/button";
import { Banner, InlineNotice, LoadingState } from "@/components/feedback";
import { errorMessage } from "@/features/chat/types";
import { AppList } from "./app-list";
import { AppDetail } from "./app-detail";
import { CreateAppDialog } from "./create-app-dialog";
import { useAppList } from "./use-app-list";
import { useAppDetail } from "./use-app-detail";
import { isAlreadyExistsError } from "./logic";
import { SAMPLE_APPS, type SampleAppDefinition } from "./samples";

/**
 * Packages workspace (spec §9). With a `package` URL parameter the detail of
 * that app renders; otherwise the app list, create dialog (§9.2) and sample
 * import (§9.5) are shown. Navigating back to the list unmounts the detail
 * (keyed by app in app.tsx), which clears detail state and aborts in-flight
 * requests (§13.3).
 */
export function PackagesView({
  packageId,
  session,
  client = apiClient,
}: {
  packageId?: string | undefined;
  session?: string | undefined;
  /** Injectable for tests/embedding (spec §2.1). */
  client?: ApiClient;
}) {
  const { t } = useI18n();
  return (
    <section aria-label={t("packages.viewLabel")} className="space-y-6 p-6">
      {packageId ? (
        <PackageDetailPane client={client} appId={packageId} session={session} />
      ) : (
        <PackageListPane client={client} session={session} />
      )}
    </section>
  );
}

function PackageListPane({ client, session }: { client: ApiClient; session?: string | undefined }) {
  const { t } = useI18n();
  const list = useAppList(client);
  const [creating, setCreating] = useState(false);

  const goToDetail = (appId: string) => {
    navigateTo(workspaceHref({ view: "packages", package: appId, session }));
  };

  return (
    <>
      <header className="flex items-center justify-between gap-4">
        <h1 className="text-lg font-semibold">{t("shell.navPackages")}</h1>
        <Button size="sm" onClick={() => setCreating(true)}>
          <Plus aria-hidden="true" />
          {t("packages.createApp")}
        </Button>
      </header>

      <SampleImportSection
        client={client}
        onImported={(appId) => {
          list.reload();
          goToDetail(appId);
        }}
      />

      <AppList apps={list.apps} loading={list.loading} error={list.error} session={session} />

      {creating ? (
        <CreateAppDialog
          client={client}
          onClose={() => setCreating(false)}
          onCreated={(appId) => {
            setCreating(false);
            list.reload();
            goToDetail(appId);
          }}
        />
      ) : null}
    </>
  );
}

function PackageDetailPane({
  client,
  appId,
  session,
}: {
  client: ApiClient;
  appId: string;
  session?: string | undefined;
}) {
  const { t } = useI18n();
  const { detail, loading, error, reload } = useAppDetail(client, appId);

  if (loading && !detail) {
    return <LoadingState label={t("common.loading")} description={t("common.loadingDescription")} />;
  }
  if (error && !detail) {
    return (
      <Banner variant="error" title={t("packages.detailLoadFailed")}>
        {errorMessage(error, t("common.unknown"))}
      </Banner>
    );
  }
  if (!detail) return null;
  return (
    <AppDetail
      client={client}
      detail={detail}
      session={session}
      onChanged={reload}
      onDeleted={() => navigateTo(workspaceHref({ view: "packages", session }))}
    />
  );
}

/**
 * Sample import (spec §9.5): create → (409 / APP_ALREADY_EXISTS tolerated) →
 * register the bundled files as a release → reload the list and jump to the
 * detail. Re-importing is idempotent; while one import runs the other
 * samples are locked out (guard, §13.7).
 */
function SampleImportSection({
  client,
  onImported,
}: {
  client: ApiClient;
  onImported: (appId: string) => void;
}) {
  const { t } = useI18n();
  const [importingId, setImportingId] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const importingRef = useRef(false);

  const importSample = (sample: SampleAppDefinition) => {
    if (importingRef.current) return;
    importingRef.current = true;
    setImportingId(sample.appId);
    setImportError(null);
    void (async () => {
      try {
        try {
          await client.request("/apps", {
            method: "POST",
            body: { appId: sample.appId, name: t(sample.nameKey), description: t(sample.descriptionKey) },
          });
        } catch (err: unknown) {
          if (!isAlreadyExistsError(err)) throw err;
        }
        await client.request(`/apps/${encodeURIComponent(sample.appId)}/releases`, {
          method: "POST",
          body: { files: sample.files },
        });
        onImported(sample.appId);
      } catch (err: unknown) {
        setImportError(errorMessage(err, t("common.unknown")));
      } finally {
        importingRef.current = false;
        setImportingId(null);
      }
    })();
  };

  return (
    <section aria-label={t("packages.samplesTitle")} className="space-y-3 rounded-lg border p-4">
      <h2 className="text-sm font-semibold">{t("packages.samplesTitle")}</h2>
      <ul className="space-y-2">
        {SAMPLE_APPS.map((sample) => (
          <li key={sample.appId} className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">
                {t(sample.nameKey)} <span className="text-xs text-muted-foreground">v{sample.version}</span>
              </div>
              <div className="truncate text-xs text-muted-foreground">{t(sample.descriptionKey)}</div>
            </div>
            <Button
              variant="outline"
              size="sm"
              disabled={importingId !== null}
              onClick={() => importSample(sample)}
            >
              <PackagePlus aria-hidden="true" />
              {importingId === sample.appId ? t("packages.importing") : t("packages.importSample")}
            </Button>
          </li>
        ))}
      </ul>
      {importError ? (
        <InlineNotice variant="error">
          {t("packages.importFailed")}: {importError}
        </InlineNotice>
      ) : null}
    </section>
  );
}
