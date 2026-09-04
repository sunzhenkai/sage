import { useRef, useState } from "react";
import { ArrowLeft, Trash2 } from "lucide-react";
import type { ApiClient } from "@/lib/api";
import type { AppDetailResponse } from "@/types/packages";
import { useI18n } from "@/lib/i18n";
import { workspaceHref } from "@/app/router";
import { formatBytes, formatFullTime } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { errorMessage } from "@/features/chat/types";
import { UploadRelease } from "./upload-release";
import { RunForm } from "./run-form";

/**
 * App detail (spec §9.3): identity, latest release manifest summary, assets
 * (with text previews when present), and the release list. Hosts the upload
 * (§9.4), run launch (§9.7) and two-step delete (§9.6) flows.
 */
export function AppDetail({
  client,
  detail,
  session,
  onChanged,
  onDeleted,
}: {
  client: ApiClient;
  detail: AppDetailResponse;
  session?: string | undefined;
  onChanged: () => void;
  onDeleted: () => void;
}) {
  const { t, locale } = useI18n();
  const manifest = detail.manifest;
  const firstRelease = detail.releases[0];

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <a
          href={workspaceHref({ view: "packages", session })}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          {t("packages.backToList")}
        </a>
        <div className="flex items-center gap-2">
          <h1 className="text-lg font-semibold">{detail.name ?? detail.appId}</h1>
          <Badge variant="secondary">{detail.status}</Badge>
        </div>
        <div className="text-xs text-muted-foreground">
          {detail.appId} · {t("common.createdAt")}: {formatFullTime(detail.createdAt, locale)}
        </div>
        {detail.description ? <p className="text-sm text-muted-foreground">{detail.description}</p> : null}
      </header>

      {manifest ? (
        <section aria-label={t("packages.manifestTitle")} className="space-y-2 rounded-lg border p-4">
          <h2 className="text-sm font-semibold">{t("packages.manifestTitle")}</h2>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
            <ManifestRow label={t("packages.versionLabel")} value={manifest.version} />
            <ManifestRow label={t("packages.entryLabel")} value={manifest.entry} />
            <ManifestRow
              label={t("packages.modelRouteLabel")}
              value={`${manifest.modelRoute.provider} / ${manifest.modelRoute.model}`}
            />
            {manifest.description ? (
              <ManifestRow label={t("packages.fieldDescription")} value={manifest.description} />
            ) : null}
          </dl>
          <RefList label={t("packages.skillRefsLabel")} values={manifest.skillRefs} />
          <RefList label={t("packages.capabilityRefsLabel")} values={manifest.capabilityRefs} />
          <RefList
            label={t("packages.inputsLabel")}
            values={(manifest.inputs ?? []).map(
              (input) =>
                `${input.name}: ${input.type}${input.required ? ` (${t("packages.inputRequired")})` : ""}${
                  input.default !== undefined ? ` = ${JSON.stringify(input.default)}` : ""
                }`,
            )}
          />
          <RefList
            label={t("packages.dataSourcesLabel")}
            values={(manifest.dataSources ?? []).map((source) => `${source.name}${source.url ? ` → ${source.url}` : ""}`)}
          />
          <RefList label={t("packages.tasksLabel")} values={(manifest.tasks ?? []).map((task) => task.name)} />
        </section>
      ) : null}

      <section aria-label={t("packages.assetsTitle")} className="space-y-2 rounded-lg border p-4">
        <h2 className="text-sm font-semibold">{t("packages.assetsTitle")}</h2>
        {!detail.assets || detail.assets.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("packages.assetsEmpty")}</p>
        ) : (
          <ul className="space-y-3">
            {detail.assets.map((asset) => (
              <li key={asset.relativePath} className="space-y-1 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{asset.relativePath}</span>
                  <Badge variant="outline">{asset.kind}</Badge>
                  <span className="text-xs text-muted-foreground">{formatBytes(asset.bytes)}</span>
                </div>
                {asset.digest ? (
                  <div className="break-all text-xs text-muted-foreground">{asset.digest}</div>
                ) : null}
                {asset.preview !== undefined ? (
                  <pre className="max-h-48 overflow-auto rounded-md bg-muted p-2 text-xs whitespace-pre-wrap">
                    {asset.preview}
                  </pre>
                ) : (
                  <div className="text-xs text-muted-foreground">{t("packages.previewUnavailable")}</div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-label={t("packages.releasesTitle")} className="space-y-2 rounded-lg border p-4">
        <h2 className="text-sm font-semibold">{t("packages.releasesTitle")}</h2>
        {detail.releases.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("packages.releasesEmpty")}</p>
        ) : (
          <ul className="divide-y">
            {detail.releases.map((release) => (
              <li key={release.releaseId} className="space-y-1 py-2 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{release.packageVersion}</span>
                  <Badge variant="outline">
                    {t("packages.compilerBuildLabel")}: {release.compilerBuild}
                  </Badge>
                  <span className="text-xs text-muted-foreground" title={formatFullTime(release.createdAt, locale)}>
                    {formatFullTime(release.createdAt, locale)}
                  </span>
                </div>
                <div className="break-all text-xs text-muted-foreground">
                  {t("packages.contentDigestLabel")}: {release.contentDigest}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <UploadRelease client={client} appId={detail.appId} onUploaded={onChanged} />

      <RunForm
        client={client}
        appId={detail.appId}
        manifest={manifest}
        releaseId={firstRelease?.releaseId}
        session={session}
      />

      <DeleteAppSection client={client} appId={detail.appId} onDeleted={onDeleted} />
    </div>
  );
}

function ManifestRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-all">{value}</dd>
    </div>
  );
}

function RefList({ label, values }: { label: string; values: string[] }) {
  const { t } = useI18n();
  return (
    <div className="flex gap-2 text-sm">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      {values.length === 0 ? (
        <span className="text-muted-foreground">{t("common.none")}</span>
      ) : (
        <span className="min-w-0 break-all">{values.join(", ")}</span>
      )}
    </div>
  );
}

/** §9.6: two-step confirm, confirm disabled while deleting. */
function DeleteAppSection({
  client,
  appId,
  onDeleted,
}: {
  client: ApiClient;
  appId: string;
  onDeleted: () => void;
}) {
  const { t } = useI18n();
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const deletingRef = useRef(false);

  const confirmDelete = () => {
    if (deletingRef.current) return;
    deletingRef.current = true;
    setDeleting(true);
    setDeleteError(null);
    client
      .request<void>(`/apps/${encodeURIComponent(appId)}`, { method: "DELETE" })
      .then(() => onDeleted())
      .catch((err: unknown) => setDeleteError(errorMessage(err, t("common.unknown"))))
      .finally(() => {
        deletingRef.current = false;
        setDeleting(false);
      });
  };

  return (
    <section aria-label={t("packages.deleteApp")} className="space-y-3 rounded-lg border border-destructive/40 p-4">
      <h2 className="text-sm font-semibold">{t("packages.deleteApp")}</h2>
      {confirming ? (
        <div role="alert" className="space-y-2 rounded-md border border-destructive/50 p-3">
          <div className="text-sm font-medium">{t("packages.deleteTitle")}</div>
          <div className="text-xs text-muted-foreground">{t("packages.deleteBody")}</div>
          {deleteError ? (
            <div className="text-xs text-destructive">
              {t("packages.deleteFailed")}: {deleteError}
            </div>
          ) : null}
          <div className="flex gap-2">
            <Button variant="destructive" size="sm" disabled={deleting} onClick={confirmDelete}>
              {deleting ? t("packages.deleting") : t("common.confirm")}
            </Button>
            <Button variant="outline" size="sm" disabled={deleting} onClick={() => setConfirming(false)}>
              {t("common.cancel")}
            </Button>
          </div>
        </div>
      ) : (
        <Button          variant="outline"
          size="sm"
          onClick={() => {
            setDeleteError(null);
            setConfirming(true);
          }}
        >
          <Trash2 aria-hidden="true" />
          {t("packages.deleteApp")}
        </Button>
      )}
    </section>
  );
}
