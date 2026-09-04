import { useEffect, useState } from "react";
import { Download, Package } from "lucide-react";
import type { ApiClient } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { Markdown, splitThinking } from "@/components/markdown";
import { Badge } from "@/components/ui/badge";
import { InlineNotice } from "@/components/feedback";
import { cn } from "@/lib/utils";
import type { TaskArtifactContentView, TaskArtifactView } from "@/types/tasks";
import { artifactHref, findPreviewableArtifact, isPackageArtifact } from "./logic";

/**
 * Artifacts panel (spec §7.6): `output.tar.gz` is the package download,
 * text-like artifacts open inline while other media types download, and the
 * first previewable artifact of a succeeded task renders inline (base64 is
 * never rendered as text).
 */

type PreviewState =
  | { status: "loading" }
  | { status: "ready"; text: string }
  | { status: "binary" }
  | { status: "error" };

function ArtifactPreview({ client, taskId, artifact }: { client: ApiClient; taskId: string; artifact: TaskArtifactView }) {
  const { t } = useI18n();
  const [state, setState] = useState<PreviewState>({ status: "loading" });

  useEffect(() => {
    // Never write state after unmount or dependency change (spec §7.6.4).
    let cancelled = false;
    const controller = new AbortController();
    setState({ status: "loading" });
    client
      .request<TaskArtifactContentView>(
        `/tasks/${encodeURIComponent(taskId)}/artifacts/${encodeURIComponent(artifact.artifactId)}`,
        { signal: controller.signal },
      )
      .then((resolved) => {
        if (cancelled) return;
        if (resolved.encoding === "base64") {
          setState({ status: "binary" });
        } else {
          setState({ status: "ready", text: resolved.content ?? "" });
        }
      })
      .catch(() => {
        if (!cancelled) setState({ status: "error" });
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [client, taskId, artifact.artifactId]);

  return (
    <div aria-label={t("tasks.previewLabel")} className="rounded-md border p-3">
      <div className="mb-2 text-xs font-medium text-muted-foreground">
        {t("tasks.previewLabel")}: {artifact.name}
      </div>
      {state.status === "loading" ? (
        <p className="text-xs text-muted-foreground">{t("common.loading")}</p>
      ) : state.status === "error" ? (
        <InlineNotice variant="warning">{t("tasks.previewUnavailable")}</InlineNotice>
      ) : state.status === "binary" ? (
        <p className="text-xs text-muted-foreground">{t("tasks.previewNotText")}</p>
      ) : (
        <div className="space-y-2 text-sm [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-muted [&_pre]:p-2">
          {splitThinking(state.text).map((segment, index) =>
            segment.thinking ? (
              <div
                key={index}
                className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground"
              >
                <Markdown text={segment.text} />
              </div>
            ) : (
              <Markdown key={index} text={segment.text} />
            ),
          )}
        </div>
      )}
    </div>
  );
}

export function ArtifactsPanel({
  client,
  apiBase,
  taskId,
  artifacts,
  taskStatus,
}: {
  client: ApiClient;
  apiBase: string;
  taskId: string;
  artifacts: readonly TaskArtifactView[];
  taskStatus: string;
}) {
  const { t } = useI18n();
  const previewTarget = taskStatus === "succeeded" ? findPreviewableArtifact(artifacts) : undefined;

  return (
    <section aria-label={t("tasks.artifactsLabel")} className="space-y-2">
      <h3 className="text-sm font-semibold">{t("tasks.artifactsLabel")}</h3>
      {artifacts.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t("tasks.noArtifacts")}</p>
      ) : (
        <ul className="space-y-1">
          {artifacts.map((artifact) => {
            const pkg = isPackageArtifact(artifact);
            return (
              <li key={artifact.artifactId} className="flex flex-wrap items-center gap-2 rounded-md border px-2 py-1 text-xs">
                {pkg ? (
                  <Package aria-hidden="true" className="h-3.5 w-3.5 text-muted-foreground" />
                ) : (
                  <Download aria-hidden="true" className="h-3.5 w-3.5 text-muted-foreground" />
                )}
                <a
                  href={artifactHref(apiBase, taskId, artifact)}
                  className={cn("font-medium underline underline-offset-4")}
                >
                  {pkg ? t("tasks.packageDownload") : artifact.name}
                </a>
                <Badge variant="outline">{artifact.mediaType}</Badge>
                <span className="min-w-0 flex-1 truncate text-muted-foreground">{artifact.artifactRef}</span>
              </li>
            );
          })}
        </ul>
      )}
      {previewTarget ? <ArtifactPreview client={client} taskId={taskId} artifact={previewTarget} /> : null}
    </section>
  );
}
