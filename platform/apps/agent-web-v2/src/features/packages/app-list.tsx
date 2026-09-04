import { Box } from "lucide-react";
import type { PackageSummaryView } from "@/types/packages";
import { useI18n } from "@/lib/i18n";
import { workspaceHref } from "@/app/router";
import { formatFullTime, formatListTime } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Banner, EmptyPanel, LoadingState } from "@/components/feedback";
import { errorMessage } from "@/features/chat/types";

/**
 * App list (spec §9.1): each row links into the package detail URL
 * (`?view=packages&package=<appId>`, session preserved) and shows the name,
 * package id, release count, latest version (`—` when missing) and the
 * update time (short form with the full time in the title).
 */
export function AppList({
  apps,
  loading,
  error,
  session,
}: {
  apps: PackageSummaryView[];
  loading: boolean;
  error: unknown;
  session?: string | undefined;
}) {
  const { t, locale } = useI18n();

  if (loading) {
    return <LoadingState label={t("common.loading")} description={t("common.loadingDescription")} />;
  }
  if (error) {
    return (
      <Banner variant="error" title={t("packages.loadFailed")}>
        {errorMessage(error, t("common.unknown"))}
      </Banner>
    );
  }
  if (apps.length === 0) {
    return <EmptyPanel title={t("packages.emptyList")} description={t("packages.emptyHint")} />;
  }

  return (
    <ul aria-label={t("packages.listLabel")} className="divide-y rounded-lg border">
      {apps.map((app) => (
        <li key={app.packageId}>
          <a
            href={workspaceHref({ view: "packages", package: app.packageId, session })}
            className="block px-4 py-3 hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <div className="flex items-center gap-2">
              <Box className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{app.name}</span>
              <Badge variant="secondary">{t("packages.releasesCount", { count: app.releaseCount })}</Badge>
              <Badge variant="outline">
                {t("packages.latestVersionLabel")}: {app.latestVersion ?? "—"}
              </Badge>
              <span
                className="shrink-0 text-xs text-muted-foreground"
                title={formatFullTime(app.updatedAt, locale)}
              >
                {formatListTime(app.updatedAt)}
              </span>
            </div>
            <div className="mt-1 truncate pl-6 text-xs text-muted-foreground">
              {app.packageId}
              {app.description ? ` · ${app.description}` : ""}
            </div>
          </a>
        </li>
      ))}
    </ul>
  );
}
