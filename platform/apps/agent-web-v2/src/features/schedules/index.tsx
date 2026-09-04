import { useRef, useState } from "react";
import { ChevronDown, ChevronRight, Pause, Play, RefreshCw, Trash2 } from "lucide-react";
import { apiClient, type ApiClient } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Banner, EmptyPanel, InlineNotice, LoadingState } from "@/components/feedback";
import { errorMessage } from "@/features/chat/types";
import type { ScheduleState, ScheduleTriggerRule, ScheduleView } from "@/types/schedules";
import { useSchedules } from "./use-schedules";
import { TriggerHistoryPanel } from "./trigger-history";
import { ScheduleAuthGuidance } from "./auth-guidance";
import { isScheduleAuthError } from "./logic";

const STATE_VARIANTS: Record<ScheduleState, "success" | "warning" | "outline"> = {
  ACTIVE: "success",
  PAUSED: "warning",
  DELETED: "outline",
};

const STATE_LABEL_KEYS: Record<ScheduleState, "schedules.stateActive" | "schedules.statePaused" | "schedules.stateDeleted"> = {
  ACTIVE: "schedules.stateActive",
  PAUSED: "schedules.statePaused",
  DELETED: "schedules.stateDeleted",
};

type ScheduleAction = "pause" | "resume" | "delete";

/**
 * Schedules view (spec §10): schedule list with trigger / release binding /
 * next fire time, per-schedule Pause / Resume / Delete controls (delete uses
 * the two-step inline confirmation, spec §14.6), and an expandable trigger
 * history panel per schedule (§10.2). Authentication failures (401 /
 * SCHEDULE_AUTHENTICATION_REQUIRED) render configuration guidance instead of
 * the raw HTTP error (§10.3). While any operation runs, a global busy state
 * disables all schedule actions (§10.1 rule 6, §13.7).
 */
export function SchedulesView({
  session,
  client = apiClient,
}: {
  /** Preserved in trigger-history task links. */
  session?: string | undefined;
  /** Injectable for tests/embedding (spec §2.1). */
  client?: ApiClient;
}) {
  const { t } = useI18n();
  const list = useSchedules(client);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [historyToken, setHistoryToken] = useState(0);
  const busyRef = useRef(false);

  const runAction = (schedule: ScheduleView, action: ScheduleAction) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setActionError(null);
    const id = schedule.definition.scheduleId;
    const path = `/schedules/${encodeURIComponent(id)}`;
    const request =
      action === "delete"
        ? client.request<void>(path, { method: "DELETE" })
        : client.request<unknown>(`${path}/${action}`, { method: "POST" });
    request
      .then(() => {
        // Refresh the list after every success; the expanded history of the
        // same (non-deleted) schedule refreshes too (spec §10.1 rule 5).
        list.reload();
        if (action === "delete") {
          setConfirmingId(null);
          if (expandedId === id) setExpandedId(null);
        } else if (expandedId === id) {
          setHistoryToken((token) => token + 1);
        }
      })
      .catch((err: unknown) => {
        // Local operation failure stays separate from the list data (spec §5.2).
        setActionError(errorMessage(err, t("common.unknown")));
      })
      .finally(() => {
        busyRef.current = false;
        setBusy(false);
      });
  };

  return (
    <section aria-label={t("schedules.viewLabel")} className="space-y-4 p-6">
      <header className="flex items-center justify-between gap-4">
        <h1 className="text-lg font-semibold">{t("shell.navSchedules")}</h1>
        <Button variant="outline" size="sm" disabled={busy} onClick={() => list.reload()}>
          <RefreshCw aria-hidden="true" />
          {t("common.refresh")}
        </Button>
      </header>

      {actionError ? (
        <InlineNotice variant="error">
          {t("schedules.controlFailed")}: {actionError}
        </InlineNotice>
      ) : null}

      <section aria-label={t("schedules.listLabel")} className="rounded-lg border p-4">
        {list.loading ? (
          <LoadingState label={t("common.loading")} description={t("common.loadingDescription")} />
        ) : list.error ? (
          isScheduleAuthError(list.error) ? (
            <ScheduleAuthGuidance />
          ) : (
            <Banner variant="error" title={t("schedules.loadFailed")}>
              {errorMessage(list.error, t("common.unknown"))}
            </Banner>
          )
        ) : list.schedules.length === 0 ? (
          <EmptyPanel title={t("schedules.emptyList")} />
        ) : (
          <ul className="divide-y">
            {list.schedules.map((schedule) => {
              const id = schedule.definition.scheduleId;
              const expanded = expandedId === id;
              const confirming = confirmingId === id;
              return (
                <li key={id} className="space-y-2 py-3">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      aria-expanded={expanded}
                      aria-label={t("schedules.historyToggle", { id })}
                      disabled={busy}
                      onClick={() => {
                        setConfirmingId(null);
                        setExpandedId(expanded ? null : id);
                      }}
                      className="flex min-w-0 flex-1 items-center gap-1 text-left text-sm font-medium cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {expanded ? (
                        <ChevronDown className="h-4 w-4 shrink-0" aria-hidden="true" />
                      ) : (
                        <ChevronRight className="h-4 w-4 shrink-0" aria-hidden="true" />
                      )}
                      <span className="truncate font-mono">{id}</span>
                    </button>
                    <Badge variant={STATE_VARIANTS[schedule.state]}>{t(STATE_LABEL_KEYS[schedule.state])}</Badge>
                    <div className="flex items-center gap-1">
                      {schedule.state === "ACTIVE" ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={busy}
                          aria-label={`${t("schedules.pause")}: ${id}`}
                          onClick={() => runAction(schedule, "pause")}
                        >
                          <Pause aria-hidden="true" />
                          {t("schedules.pause")}
                        </Button>
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={busy}
                          aria-label={`${t("schedules.resume")}: ${id}`}
                          onClick={() => runAction(schedule, "resume")}
                        >
                          <Play aria-hidden="true" />
                          {t("schedules.resume")}
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={busy}
                        aria-label={`${t("common.delete")}: ${id}`}
                        onClick={() => setConfirmingId(confirming ? null : id)}
                      >
                        <Trash2 aria-hidden="true" />
                        {t("common.delete")}
                      </Button>
                    </div>
                  </div>

                  <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 pl-6 text-xs">
                    <dt className="text-muted-foreground">{t("schedules.taskLabel")}</dt>
                    <dd className="font-mono">{schedule.definition.invocation.task}</dd>
                    <dt className="text-muted-foreground">{t("schedules.triggerLabel")}</dt>
                    <dd className="font-mono">{formatTrigger(schedule.definition.trigger, (minutes) => t("schedules.triggerIntervalMinutes", { minutes }))}</dd>
                    <dt className="text-muted-foreground">{t("schedules.releaseBindingLabel")}</dt>
                    <dd className="font-mono">{formatReleaseBinding(schedule)}</dd>
                    <dt className="text-muted-foreground">{t("schedules.nextFireLabel")}</dt>
                    <dd className="font-mono">
                      {typeof schedule.nextFireAtMs === "number"
                        ? new Date(schedule.nextFireAtMs).toISOString()
                        : t("common.none")}
                    </dd>
                  </dl>

                  {confirming ? (
                    <div role="alert" className="ml-6 space-y-2 rounded-md border border-destructive/50 p-3">
                      <div className="text-xs font-medium">{t("schedules.deleteTitle")}</div>
                      <div className="text-xs text-muted-foreground">{t("schedules.deleteBody")}</div>
                      <div className="flex gap-2">
                        <Button
                          variant="destructive"
                          size="sm"
                          disabled={busy}
                          onClick={() => runAction(schedule, "delete")}
                        >
                          {t("common.confirm")}
                        </Button>
                        <Button variant="outline" size="sm" disabled={busy} onClick={() => setConfirmingId(null)}>
                          {t("common.cancel")}
                        </Button>
                      </div>
                    </div>
                  ) : null}

                  {expanded ? (
                    <TriggerHistoryPanel client={client} scheduleId={id} reloadToken={historyToken} session={session} />
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </section>
  );
}

/** cron renders `expression (timezone)`; interval renders minutes (spec §10.1). */
function formatTrigger(trigger: ScheduleTriggerRule, intervalText: (minutes: number) => string): string {
  if (trigger.kind === "cron") return `${trigger.expression} (${trigger.timezone})`;
  return intervalText(Math.round(trigger.everyMs / 60_000));
}

/** `FIXED <releaseId>` or `FOLLOW` (spec §10.1). */
function formatReleaseBinding(schedule: ScheduleView): string {
  const binding = schedule.definition.releaseBinding;
  return binding.strategy === "FIXED" ? `FIXED ${binding.releaseId}` : "FOLLOW";
}
