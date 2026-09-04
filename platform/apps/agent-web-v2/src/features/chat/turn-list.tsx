import type { ReactNode } from "react";
import { Wrench } from "lucide-react";
import type { TimelineEvent, TimelinePayload } from "@sage/app-contracts";
import { useI18n, type MessageKey } from "@/lib/i18n";
import { formatArtifactKB } from "@/lib/format";
import { workspaceHref } from "@/app/router";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { InlineNotice } from "@/components/feedback";
import { Markdown, splitThinking } from "./markdown";
import { buildTimelineTurns, type TimelineTurn } from "./timeline";

/**
 * Conversation timeline (spec §6.5, §6.7): turns grouped by runId, user
 * messages with the promote action, assistant text through the safe-subset
 * Markdown renderer (thinking segments collapsible), and the tool / artifact /
 * error / task activity rows.
 */

type TaskStatus = Extract<TimelinePayload, { kind: "task" }>["status"];

function taskStatusLabel(t: (key: MessageKey) => string, status: TaskStatus): string {
  const keys: Record<TaskStatus, MessageKey> = {
    placeholder: "chat.taskStatus.placeholder",
    promotion_pending: "chat.taskStatus.promotion_pending",
    routed: "chat.taskStatus.routed",
    running: "chat.taskStatus.running",
    paused: "chat.taskStatus.paused",
    succeeded: "chat.taskStatus.succeeded",
    failed: "chat.taskStatus.failed",
    cancelled: "chat.taskStatus.cancelled",
    effect_unknown: "chat.taskStatus.effect_unknown",
  };
  return t(keys[status]);
}

/** Assistant text: split literal think tags first, Markdown for the rest (§6.6). */
export function AssistantText({ text }: { text: string }) {
  const { t } = useI18n();
  const segments = splitThinking(text);
  return (
    <>
      {segments.map((segment, index) =>
        segment.thinking ? (
          <details key={index} className="my-1 rounded-md border px-3 py-2 text-sm text-muted-foreground">
            <summary className="cursor-pointer font-medium">{t("chat.thoughtProcess")}</summary>
            <div className="mt-2">
              <Markdown text={segment.text} />
            </div>
          </details>
        ) : (
          <Markdown key={index} text={segment.text} />
        ),
      )}
    </>
  );
}

interface TurnActions {
  writable: boolean;
  connectionId: string | null;
  sessionId: string;
  pendingRetryRunId: string | null;
  onRetry: (runId: string) => void;
}

function ActivityRow({ event, actions }: { event: TimelineEvent; actions: TurnActions }) {
  const { t } = useI18n();
  const payload = event.payload;

  switch (payload.kind) {
    case "text":
      return (
        <div className="text-sm leading-relaxed">
          <AssistantText text={payload.text} />
        </div>
      );
    case "tool":
      return (
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Wrench className="h-3.5 w-3.5" aria-hidden="true" />
          <span className="font-medium text-foreground">{payload.toolName}</span>
          <Badge variant={payload.status === "completed" ? "success" : "info"}>
            {t(payload.status === "completed" ? "chat.toolCompleted" : "chat.toolStarted")}
          </Badge>
          {payload.artifact ? (
            <a
              href={payload.artifact.artifactRef}
              className="underline underline-offset-4"
              target="_blank"
              rel="noopener noreferrer"
            >
              {payload.artifact.name}
            </a>
          ) : null}
        </div>
      );
    case "artifact":
      return (
        <div className="text-xs text-muted-foreground">
          <a
            href={payload.artifact.artifactRef}
            className="font-medium text-foreground underline underline-offset-4"
            target="_blank"
            rel="noopener noreferrer"
          >
            {payload.artifact.name}
          </a>{" "}
          <span>
            {payload.artifact.mediaType} · {formatArtifactKB(payload.artifact.sizeBytes)}
          </span>
        </div>
      );
    case "error": {
      const { error } = payload;
      return (
        <InlineNotice variant="error" className="text-xs">
          <span className="font-medium">{error.code}</span>: {error.message}
          {error.retryable === true && actions.writable && actions.connectionId ? (
            <Button
              variant="outline"
              size="sm"
              className="ml-2"
              disabled={actions.pendingRetryRunId !== null}
              onClick={() => actions.onRetry(event.runId)}
            >
              {t("chat.retryRun")}
            </Button>
          ) : null}
        </InlineNotice>
      );
    }
    case "task": {
      const body: ReactNode = (
        <>
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">{payload.title}</span>
            <Badge variant="secondary">{taskStatusLabel(t, payload.status)}</Badge>
          </div>
          {payload.reason ? <div className="mt-1 text-xs text-muted-foreground">{payload.reason}</div> : null}
        </>
      );
      if (payload.taskId) {
        return (
          <a
            href={workspaceHref({ view: "tasks", task: payload.taskId, session: actions.sessionId })}
            className="block rounded-md border p-3 hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {body}
          </a>
        );
      }
      return <div className="rounded-md border p-3">{body}</div>;
    }
    case "run":
      return null;
  }
}

function Turn({ turn, actions, onPromote, pendingPromoteId }: {
  turn: TimelineTurn;
  actions: TurnActions;
  onPromote: (messageId: string) => void;
  pendingPromoteId: string | null;
}) {
  const { t } = useI18n();
  const user = turn.userMessage;
  return (
    <div className="space-y-3">
      {user ? (
        <div className="flex justify-end">
          <div className="max-w-[80%] space-y-2 rounded-lg bg-primary/10 px-4 py-3">
            <div className="text-xs font-medium text-muted-foreground">{t("chat.you")}</div>
            <div className="whitespace-pre-wrap text-sm">{user.text}</div>
            {actions.writable && user.promotionEligibility === "explicit" && user.messageId ? (
              <Button
                variant="outline"
                size="sm"
                disabled={pendingPromoteId !== null}
                onClick={() => onPromote(user.messageId ?? "")}
              >
                {t("chat.promoteToTask")}
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="space-y-2">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="font-medium">{t("chat.assistant")}</span>
          {turn.attempt > 1 ? <Badge variant="outline">{t("chat.attemptLabel", { n: turn.attempt })}</Badge> : null}
          {turn.failed ? <Badge variant="destructive">{t("chat.runFailed")}</Badge> : null}
        </div>
        {turn.items.map((event) => (
          <ActivityRow key={event.sequence} event={event} actions={actions} />
        ))}
        {turn.pending ? (
          <div role="status" className="text-sm text-muted-foreground">
            {t("chat.thinking")}
          </div>
        ) : null}
        {turn.failed && turn.showRetryEntry && actions.writable && actions.connectionId ? (
          <Button
            variant="outline"
            size="sm"
            disabled={actions.pendingRetryRunId !== null}
            onClick={() => actions.onRetry(turn.runId)}
          >
            {t("chat.retryRun")}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

export function TurnList({
  events,
  writable,
  connectionId,
  sessionId,
  pendingRetryRunId,
  onRetry,
  pendingPromoteId,
  onPromote,
}: {
  events: readonly TimelineEvent[];
  writable: boolean;
  connectionId: string | null;
  sessionId: string;
  pendingRetryRunId: string | null;
  onRetry: (runId: string) => void;
  pendingPromoteId: string | null;
  onPromote: (messageId: string) => void;
}) {
  const { t } = useI18n();
  const turns = buildTimelineTurns(events);
  const actions: TurnActions = { writable, connectionId, sessionId, pendingRetryRunId, onRetry };
  return (
    <div aria-label={t("chat.timelineLabel")} className="space-y-6 p-4">
      {turns.map((turn) => (
        <Turn key={turn.runId} turn={turn} actions={actions} onPromote={onPromote} pendingPromoteId={pendingPromoteId} />
      ))}
    </div>
  );
}
