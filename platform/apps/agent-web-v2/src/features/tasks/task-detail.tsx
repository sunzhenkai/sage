import { useRef, useState, type ReactNode } from "react";
import { ChevronDown, RefreshCw } from "lucide-react";
import type { ApiClient } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { formatFullTime } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Banner, LoadingState } from "@/components/feedback";
import { errorMessage } from "@/features/chat/types";
import type { TaskViewModel } from "@/types/tasks";
import { controlAvailability, taskStatusKey } from "./logic";
import { useTaskDetail } from "./use-task-detail";
import { RunLogPanel } from "./run-log-panel";
import { ArtifactsPanel } from "./artifacts-panel";

/**
 * Task detail (spec §7.2/§7.3/§7.4): parallel projection load, freshness and
 * revision metadata, effect_unknown / failure disclosures, task controls with
 * a re-entrancy guard, the projection timeline, run logs and artifacts.
 */

type ControlKind = "pause" | "resume" | "cancel" | "retry";

function controlRequest(client: ApiClient, taskId: string, kind: ControlKind): Promise<unknown> {
  const base = `/tasks/${encodeURIComponent(taskId)}`;
  if (kind === "pause" || kind === "resume") {
    return client.request(`${base}/signals`, { method: "POST", body: { kind } });
  }
  return client.request(`${base}/${kind}`, { method: "POST", body: {} });
}

function FreshnessBadge({ task }: { task: TaskViewModel }) {
  const { t } = useI18n();
  const variant = task.freshness === "fresh" ? "success" : task.freshness === "stale" ? "warning" : "destructive";
  const label =
    task.freshness === "fresh"
      ? t("tasks.freshnessFresh")
      : task.freshness === "stale"
        ? t("tasks.freshnessStale")
        : t("tasks.freshnessUnavailable");
  return <Badge variant={variant}>{label}</Badge>;
}

function Disclosure({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Collapsible defaultOpen className="rounded-md border">
      <CollapsibleTrigger className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&[data-state=open]>svg]:rotate-180">
        <ChevronDown aria-hidden="true" className="h-3.5 w-3.5 shrink-0 transition-transform" />
        {title}
      </CollapsibleTrigger>
      <CollapsibleContent className="px-3 pb-3 text-xs text-muted-foreground">{children}</CollapsibleContent>
    </Collapsible>
  );
}

function Field({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="truncate text-sm">{value}</dd>
    </div>
  );
}

export function TaskDetail({
  client,
  apiBase = "/v1",
  taskId,
  onChanged,
}: {
  client: ApiClient;
  apiBase?: string;
  taskId: string;
  /** Called after a successful control so the list can reload too (spec §7.3.2). */
  onChanged?: (() => void) | undefined;
}) {
  const { t, locale } = useI18n();
  const detail = useTaskDetail({ client, taskId });
  const [pendingControl, setPendingControl] = useState<ControlKind | null>(null);
  const [controlError, setControlError] = useState<string | null>(null);
  const controlGuardRef = useRef(false);

  const runControl = (kind: ControlKind) => {
    if (controlGuardRef.current) return;
    controlGuardRef.current = true;
    setPendingControl(kind);
    setControlError(null);
    controlRequest(client, taskId, kind)
      .then(() => {
        detail.refresh();
        onChanged?.();
      })
      .catch((error: unknown) => setControlError(errorMessage(error, t("tasks.controlFailed"))))
      .finally(() => {
        controlGuardRef.current = false;
        setPendingControl(null);
      });
  };

  if (detail.status === "loading") {
    return (
      <section aria-label={t("tasks.detailLabel")} className="min-w-0 flex-1 overflow-y-auto p-4">
        <LoadingState label={t("common.loading")} description={t("common.loadingDescription")} />
      </section>
    );
  }

  if (detail.status === "error" || detail.task === null) {
    return (
      <section aria-label={t("tasks.detailLabel")} className="min-w-0 flex-1 overflow-y-auto p-4">
        <Banner variant="error" title={t("tasks.detailError")}>
          {errorMessage(detail.error, t("common.unknown"))}
        </Banner>
      </section>
    );
  }

  const task = detail.task;
  const availability = controlAvailability(task.status);
  const statusKey = taskStatusKey(task.status);
  const busy = pendingControl !== null || detail.refreshing;

  const controls: ReadonlyArray<{ kind: ControlKind; label: string; enabled: boolean }> = [
    { kind: "pause", label: t("tasks.pause"), enabled: availability.pause },
    { kind: "resume", label: t("tasks.resume"), enabled: availability.resume },
    { kind: "cancel", label: t("tasks.cancelTask"), enabled: availability.cancel },
    { kind: "retry", label: t("tasks.retryTask"), enabled: availability.retry },
  ];

  return (
    <section aria-label={t("tasks.detailLabel")} className="min-w-0 flex-1 overflow-y-auto p-4">
      <header className="flex flex-wrap items-center gap-2">
        <h1 className="min-w-0 flex-1 truncate text-sm font-semibold">{task.taskId}</h1>
        <Badge variant={task.status === "failed" ? "destructive" : task.status === "running" ? "info" : "secondary"}>
          {statusKey ? t(statusKey) : `${task.status} `}
        </Badge>
        <FreshnessBadge task={task} />
        <Button
          variant="outline"
          size="sm"
          onClick={() => detail.refresh()}
          disabled={detail.refreshing}
          aria-label={t("common.refresh")}
        >
          <RefreshCw aria-hidden="true" className={detail.refreshing ? "animate-spin" : undefined} />
          {detail.refreshing ? t("common.refreshing") : t("common.refresh")}
        </Button>
      </header>

      <div role="group" aria-label={t("tasks.controlsLabel")} className="mt-3 flex flex-wrap gap-2">
        {controls.map((control) => (
          <Button
            key={control.kind}
            variant={control.kind === "cancel" ? "destructive" : "outline"}
            size="sm"
            disabled={!control.enabled || busy}
            onClick={() => runControl(control.kind)}
          >
            {control.label}
          </Button>
        ))}
      </div>
      {controlError ? (
        <Banner variant="error" className="mt-2" onDismiss={() => setControlError(null)}>
          {controlError}
        </Banner>
      ) : null}
      {detail.refreshing ? (
        <p role="status" className="mt-2 text-xs text-muted-foreground">
          {t("common.refreshing")}
        </p>
      ) : null}

      <dl className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-3">
        <Field label={t("tasks.workflowLabel")} value={task.workflowId} />
        <Field label={t("tasks.targetLabel")} value={task.targetSnapshot?.targetId ?? task.targetId} />
        <Field label={t("tasks.namespaceLabel")} value={task.targetSnapshot?.namespace ?? t("common.unknown")} />
        <Field label={t("tasks.taskQueueLabel")} value={task.targetSnapshot?.taskQueue ?? t("common.unknown")} />
        <Field label={t("tasks.attemptLabel")} value={task.attempt} />
        <Field label={t("tasks.revisionLabel")} value={task.revision} />
        <Field
          label={t("tasks.updatedAtLabel")}
          value={task.projectionUpdatedAt ? formatFullTime(task.projectionUpdatedAt, locale) : t("common.unknown")}
        />
        {task.staleReason ? <Field label={t("tasks.staleReasonLabel")} value={task.staleReason} /> : null}
      </dl>

      {task.status === "effect_unknown" ? (
        <div className="mt-3">
          <Disclosure title={t("tasks.effectUnknownTitle")}>{t("tasks.effectUnknownBody")}</Disclosure>
        </div>
      ) : null}
      {task.status === "failed" ? (
        <div className="mt-3">
          <Disclosure title={t("tasks.failureTitle")}>
            <dl className="space-y-1">
              <div>
                <dt className="inline font-medium">{t("tasks.failureCodeLabel")}: </dt>
                <dd className="inline">{task.failureCode ?? t("common.unknown")}</dd>
              </div>
              <div>
                <dt className="inline font-medium">{t("tasks.failureDetailLabel")}: </dt>
                <dd className="inline">{task.failureDetail ?? t("common.unknown")}</dd>
              </div>
            </dl>
          </Disclosure>
        </div>
      ) : null}

      <Separator className="my-4" />

      <section aria-label={t("tasks.timelineLabel")} className="space-y-2">
        <h3 className="text-sm font-semibold">
          {t("tasks.timelineLabel")} · {t("tasks.timelineCount", { count: detail.events.length })}
        </h3>
        {detail.events.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            {task.freshness === "fresh" ? t("tasks.timelineEmpty") : t("tasks.timelineStale")}
          </p>
        ) : (
          <ol className="space-y-1">
            {detail.events.map((event) => (
              <li key={event.eventId} className="flex flex-wrap items-center gap-2 rounded-md border px-2 py-1 text-xs">
                <Badge variant={event.kind === "agent" ? "info" : "secondary"}>{event.type}</Badge>
                <time dateTime={event.occurredAt}>{formatFullTime(event.occurredAt, locale)}</time>
                <span className="ml-auto font-mono text-muted-foreground">#{event.sequence}</span>
              </li>
            ))}
          </ol>
        )}
      </section>

      <Separator className="my-4" />
      <RunLogPanel client={client} taskId={taskId} initial={detail.runLogs} unavailable={detail.runLogsUnavailable} />

      <Separator className="my-4" />
      <ArtifactsPanel client={client} apiBase={apiBase} taskId={taskId} artifacts={detail.artifacts} taskStatus={task.status} />
    </section>
  );
}
