import { useEffect, useState } from "react";
import type { ApiClient } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { workspaceHref } from "@/app/router";
import { formatFullTime } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { EmptyPanel, InlineNotice, LoadingState } from "@/components/feedback";
import { errorMessage } from "@/features/chat/types";
import type { ScheduleTriggerHistory, ScheduleTriggerKind } from "@/types/schedules";
import { isScheduleAuthError } from "./logic";
import { ScheduleAuthGuidance } from "./auth-guidance";

const KIND_VARIANTS: Record<ScheduleTriggerKind, "success" | "destructive" | "warning" | "outline"> = {
  SUCCEEDED: "success",
  FAILED: "destructive",
  SKIPPED: "warning",
  MISSED: "outline",
};

/**
 * Trigger history panel (spec §10.2): loads `GET /v1/schedules/:id/triggers`
 * when expanded and whenever `reloadToken` changes (a successful control
 * operation on the same schedule refreshes it, spec §10.1 rule 5). A 401 /
 * SCHEDULE_AUTHENTICATION_REQUIRED response renders the configuration
 * guidance (spec §10.3) instead of the raw HTTP error.
 */
export function TriggerHistoryPanel({
  client,
  scheduleId,
  reloadToken,
  session,
}: {
  client: ApiClient;
  scheduleId: string;
  /** Bump to force a reload after a successful control operation. */
  reloadToken: number;
  /** Preserved in task links so the Tasks view keeps the chat session. */
  session?: string | undefined;
}) {
  const { t, locale } = useI18n();
  const [history, setHistory] = useState<ScheduleTriggerHistory | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    client
      .request<ScheduleTriggerHistory>(`/schedules/${encodeURIComponent(scheduleId)}/triggers`, {
        signal: controller.signal,
      })
      .then((data) => {
        if (controller.signal.aborted) return;
        setHistory(data);
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
  }, [client, scheduleId, reloadToken]);

  return (
    <section aria-label={t("schedules.historyLabel")} className="ml-6 space-y-2 rounded-md border p-3">
      <h3 className="text-xs font-semibold">{t("schedules.historyLabel")}</h3>
      {loading && !history ? (
        <LoadingState label={t("common.loading")} />
      ) : error ? (
        isScheduleAuthError(error) ? (
          <ScheduleAuthGuidance />
        ) : (
          <InlineNotice variant="error">
            {t("schedules.historyLoadFailed")}: {errorMessage(error, t("common.unknown"))}
          </InlineNotice>
        )
      ) : !history || history.events.length === 0 ? (
        <EmptyPanel title={t("schedules.historyEmpty")} className="py-6" />
      ) : (
        <ul className="space-y-2">
          {history.events.map((event) => (
            <li key={event.occurrenceId} className="flex flex-wrap items-center gap-2 text-xs">
              <span className="font-mono font-medium">{event.occurrenceId}</span>
              <span className="text-muted-foreground">{formatFullTime(event.occurredAtMs, locale)}</span>
              <Badge variant={KIND_VARIANTS[event.kind]}>{t(`schedules.kind${capitalize(event.kind)}`)}</Badge>
              {event.taskId ? (
                <a
                  className="font-medium text-primary underline underline-offset-4"
                  href={workspaceHref({ view: "tasks", task: event.taskId, session })}
                >
                  {t("schedules.viewTask")}: {event.taskId}
                </a>
              ) : null}
              {event.errorCode ? (
                <span className="text-destructive">
                  {t("schedules.errorCodeLabel")}: {event.errorCode}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function capitalize(kind: ScheduleTriggerKind): "Succeeded" | "Failed" | "Skipped" | "Missed" {
  switch (kind) {
    case "SUCCEEDED":
      return "Succeeded";
    case "FAILED":
      return "Failed";
    case "SKIPPED":
      return "Skipped";
    case "MISSED":
      return "Missed";
  }
}
