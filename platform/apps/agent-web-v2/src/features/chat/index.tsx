import { useRef, useState, type ReactNode } from "react";
import type { PromoteChatMessageRequest, RetryRunRequest } from "@sage/app-contracts";
import { apiClient, type ApiClient } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { workspaceHref } from "@/app/router";
import { Badge } from "@/components/ui/badge";
import { Banner, EmptyPanel, InlineNotice, LoadingState } from "@/components/feedback";
import { SessionList } from "./session-list";
import { Composer } from "./composer";
import { TurnList } from "./turn-list";
import { EventStreamPanel } from "./event-stream-panel";
import { useChatSession, type EventSourceFactory } from "./use-chat-session";
import { useChatRuntime } from "./use-chat-runtime";
import { hasTaskEvent } from "./timeline";
import { errorMessage, type PromotionResponse } from "./types";

/**
 * Chat workspace (spec §6). Left column: session list (§6.1). Right column:
 * session restore + live timeline (§6.2), composer with runtime selection
 * (§6.3/§6.4/§6.9), turns with retry/promote (§6.7) and the raw event stream
 * panel (§6.8).
 */

export interface ChatViewProps {
  session?: string | undefined;
  /** Injectable for tests/embedding (spec §2.1). */
  client?: ApiClient;
  apiBase?: string;
  /** Injectable for tests; `null` forces the offline state. */
  eventSourceFactory?: EventSourceFactory | null;
}

interface Notice {
  variant: "success" | "error";
  content: ReactNode;
}

function ChatDetail({
  sessionId,
  client,
  apiBase,
  eventSourceFactory,
}: {
  sessionId: string;
  client: ApiClient;
  apiBase: string;
  eventSourceFactory?: EventSourceFactory | null | undefined;
}) {
  const { t } = useI18n();
  const { restore, session, events, connection, error, refresh } = useChatSession({
    client,
    sessionId,
    apiBase,
    ...(eventSourceFactory !== undefined ? { eventSourceFactory } : {}),
  });
  const runtime = useChatRuntime(client);

  const [notice, setNotice] = useState<Notice | null>(null);
  const [pendingRetryRunId, setPendingRetryRunId] = useState<string | null>(null);
  const [pendingPromoteId, setPendingPromoteId] = useState<string | null>(null);
  const retryGuardRef = useRef(false);
  const promoteGuardRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const writable = restore === "ready" && session !== null && session.status === "open" && !session.archivedAt;

  const onRetry = (runId: string) => {
    if (retryGuardRef.current || !runtime.connectionId) return;
    retryGuardRef.current = true;
    setPendingRetryRunId(runId);
    setNotice(null);
    const body: RetryRunRequest = { provider: { connectionId: runtime.connectionId } };
    client
      .request<unknown>(`/chat/runs/${encodeURIComponent(runId)}/retry`, { method: "POST", body })
      .then(() => {
        setNotice({ variant: "success", content: t("chat.retryAccepted") });
        void refresh();
      })
      .catch((retryError: unknown) =>
        setNotice({ variant: "error", content: errorMessage(retryError, t("common.unknown")) }),
      )
      .finally(() => {
        retryGuardRef.current = false;
        setPendingRetryRunId(null);
      });
  };

  const onPromote = (messageId: string) => {
    if (promoteGuardRef.current || !messageId) return;
    promoteGuardRef.current = true;
    setPendingPromoteId(messageId);
    setNotice(null);
    const body: PromoteChatMessageRequest = { mode: "explicit", taskType: "sage.agent-task.v1" };
    client
      .request<PromotionResponse>(`/chat/messages/${encodeURIComponent(messageId)}/promotions`, { method: "POST", body })
      .then((response) => {
        const taskId = response.association?.taskId;
        setNotice({
          variant: "success",
          content: (
            <>
              {t("chat.promoteAccepted")}{" "}
              {taskId ? (
                <a
                  href={workspaceHref({ view: "tasks", task: taskId, session: sessionId })}
                  className="font-medium underline underline-offset-4"
                >
                  {t("chat.viewTask")}
                </a>
              ) : null}
            </>
          ),
        });
        void refresh();
      })
      .catch((promoteError: unknown) =>
        setNotice({ variant: "error", content: errorMessage(promoteError, t("common.unknown")) }),
      )
      .finally(() => {
        promoteGuardRef.current = false;
        setPendingPromoteId(null);
      });
  };

  // After a successful send: catch up incrementally, and pin to the bottom
  // when the user was already near it (spec §6.3).
  const onSent = () => {
    const el = scrollRef.current;
    const nearBottom = !el || el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    void refresh();
    if (nearBottom && el) {
      requestAnimationFrame(() => {
        el.scrollTop = el.scrollHeight;
      });
    }
  };

  if (restore === "loading") {
    return <LoadingState label={t("common.loading")} description={t("common.loadingDescription")} className="flex-1" />;
  }

  if (restore === "not-found") {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <EmptyPanel title={t("chat.sessionUnavailable")} description={t("chat.sessionUnavailableRetention")} />
      </div>
    );
  }

  const composerArea = () => {
    if (restore === "error" || session === null) {
      return (
        <div className="border-t p-3">
          <InlineNotice variant="info">{t("chat.readonlyUnavailable")}</InlineNotice>
        </div>
      );
    }
    if (session.status === "closed") {
      return (
        <div className="border-t p-3">
          <InlineNotice variant="info">{t("chat.readonlyClosed")}</InlineNotice>
        </div>
      );
    }
    if (session.archivedAt) {
      return (
        <div className="border-t p-3">
          <InlineNotice variant="info">{t("chat.readonlyArchived")}</InlineNotice>
        </div>
      );
    }
    if (runtime.status === "loading") {
      return (
        <div className="border-t p-3">
          <LoadingState label={t("common.loading")} className="py-4" />
        </div>
      );
    }
    if (!runtime.connectionId) {
      return (
        <div className="border-t p-3">
          <InlineNotice variant="warning">
            {t("chat.needProvider")}{" "}
            <a
              href={workspaceHref({ view: "providers", session: sessionId })}
              className="font-medium underline underline-offset-4"
            >
              {t("chat.configureProviders")}
            </a>
          </InlineNotice>
        </div>
      );
    }
    return (
      <div>
        <div className="flex items-center gap-2 border-t px-3 pt-3">
          <label htmlFor="sage-chat-runtime" className="text-xs text-muted-foreground">
            {t("chat.runtimeLabel")}
          </label>
          <select
            id="sage-chat-runtime"
            aria-label={t("chat.runtimeLabel")}
            value={runtime.connectionId}
            onChange={(event) => runtime.select(event.target.value)}
            className="h-8 rounded-md border border-input bg-transparent px-2 text-xs shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
          >
            {runtime.connections.map((connection) => (
              <option key={connection.id} value={connection.id}>
                {connection.name}
              </option>
            ))}
          </select>
        </div>
        <Composer client={client} sessionId={sessionId} connectionId={runtime.connectionId} onSent={onSent} />
      </div>
    );
  };

  const connectionLabel =
    connection === "live"
      ? t("chat.connectionLive")
      : connection === "connecting"
        ? t("chat.connectionConnecting")
        : t("chat.connectionOffline");

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col" aria-label={t("chat.detailLabel")}>
      <header className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
        <h1 className="min-w-0 flex-1 truncate text-sm font-semibold">
          {session?.title ?? t("chat.untitled")}
        </h1>
        {session ? (
          <Badge variant={session.status === "open" ? "info" : "secondary"}>
            {t(session.status === "open" ? "chat.statusOpen" : "chat.statusClosed")}
          </Badge>
        ) : null}
        {session?.archivedAt ? <Badge variant="warning">{t("chat.archivedBadge")}</Badge> : null}
        {restore === "ready" ? (
          <span role="status" className="flex items-center gap-1 text-xs text-muted-foreground">
            <span
              aria-hidden="true"
              className={
                connection === "live"
                  ? "inline-block h-2 w-2 rounded-full bg-success"
                  : connection === "connecting"
                    ? "inline-block h-2 w-2 rounded-full bg-warning"
                    : "inline-block h-2 w-2 rounded-full bg-destructive"
              }
            />
            {connectionLabel}
          </span>
        ) : null}
        {events.length > 0 && !hasTaskEvent(events) ? (
          <a
            href={workspaceHref({ view: "tasks", session: sessionId })}
            className="text-xs font-medium text-primary underline underline-offset-4"
          >
            {t("chat.openTaskWorkspace")}
          </a>
        ) : null}
      </header>

      {restore === "error" ? (
        <div className="p-4">
          <Banner variant="error" title={t("chat.restoreFailed")}>
            {error}
          </Banner>
        </div>
      ) : null}

      {notice ? (
        <div className="px-4 pt-3">
          <Banner variant={notice.variant} onDismiss={() => setNotice(null)}>
            {notice.content}
          </Banner>
        </div>
      ) : null}

      {restore === "ready" ? (
        <>
          <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
            <TurnList
              events={events}
              writable={writable}
              connectionId={runtime.connectionId}
              sessionId={sessionId}
              pendingRetryRunId={pendingRetryRunId}
              onRetry={onRetry}
              pendingPromoteId={pendingPromoteId}
              onPromote={onPromote}
            />
          </div>
          <EventStreamPanel events={events} />
        </>
      ) : null}

      {composerArea()}
    </div>
  );
}

export function ChatView({ session, client = apiClient, apiBase = "/v1", eventSourceFactory }: ChatViewProps) {
  const { t } = useI18n();
  return (
    <div className="flex h-full min-h-0">
      <SessionList client={client} currentSession={session} />
      {session ? (
        <ChatDetail sessionId={session} client={client} apiBase={apiBase} eventSourceFactory={eventSourceFactory} />
      ) : (
        <div className="flex flex-1 items-center justify-center p-6">
          <EmptyPanel title={t("shell.navChat")} description={t("chat.noSessionSelected")} />
        </div>
      )}
    </div>
  );
}
