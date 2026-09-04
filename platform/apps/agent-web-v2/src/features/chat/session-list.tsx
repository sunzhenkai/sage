import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Archive, ArchiveRestore, Plus, Search, Trash2 } from "lucide-react";
import type { ListSessionsResponse, Session, SessionHistoryItem, SessionHistoryStatus } from "@sage/app-contracts";
import type { ApiClient } from "@/lib/api";
import { useI18n, type MessageKey } from "@/lib/i18n";
import { formatFullTime, formatListTime } from "@/lib/format";
import { navigateTo, workspaceHref } from "@/app/router";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Banner, EmptyPanel, InlineNotice, LoadingState } from "@/components/feedback";
import { errorMessage } from "./types";

/**
 * Session list (spec §6.1): paginated `GET /chat/sessions` with status /
 * archive / title-search filters, load-more, New Chat, and the
 * archive / restore / delete session actions (delete is two-step).
 */

type SessionAction = "archive" | "restore" | "delete";

const STATUS_TABS: ReadonlyArray<{ value: SessionHistoryStatus; labelKey: MessageKey }> = [
  { value: "all", labelKey: "chat.statusAll" },
  { value: "open", labelKey: "chat.statusOpen" },
  { value: "closed", labelKey: "chat.statusClosed" },
];

function buildListPath(args: {
  status: SessionHistoryStatus;
  archived: boolean;
  query: string;
  locale: string;
  cursor?: string | undefined;
}): string {
  const params = new URLSearchParams({ limit: "30", status: args.status, locale: args.locale });
  if (args.archived) params.set("archived", "true");
  if (args.query) params.set("q", args.query);
  if (args.cursor) params.set("cursor", args.cursor);
  return `/chat/sessions?${params.toString()}`;
}

export function SessionList({ client, currentSession }: { client: ApiClient; currentSession?: string | undefined }) {
  const { t, locale } = useI18n();
  const [statusFilter, setStatusFilter] = useState<SessionHistoryStatus>("all");
  const [archivedView, setArchivedView] = useState(false);
  const [searchInput, setSearchInput] = useState("");
  const [committedQuery, setCommittedQuery] = useState("");
  const [items, setItems] = useState<SessionHistoryItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const [pendingActionId, setPendingActionId] = useState<string | null>(null);
  const actionGuardRef = useRef(false);
  const loadingMoreRef = useRef(false);
  const [creating, setCreating] = useState(false);
  const creatingRef = useRef(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Reload the first page whenever filters / archive view / locale change
  // (spec §6.1, §13.9); delete confirmation is cleared on reload.
  useEffect(() => {
    const controller = new AbortController();
    setConfirmingDeleteId(null);
    setLoading(true);
    setListError(null);
    client
      .request<ListSessionsResponse>(
        buildListPath({ status: statusFilter, archived: archivedView, query: committedQuery, locale }),
        { signal: controller.signal },
      )
      .then((response) => {
        if (controller.signal.aborted) return;
        setItems(response.items);
        setNextCursor(response.nextCursor);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setListError(errorMessage(error, t("common.unknown")));
        setItems([]);
        setNextCursor(undefined);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [client, statusFilter, archivedView, committedQuery, locale, t]);

  // Typing never fires requests; submitting the form reloads page one (§6.1).
  const onSearchSubmit = (event: FormEvent) => {
    event.preventDefault();
    setCommittedQuery(searchInput.trim());
  };

  const onLoadMore = () => {
    if (!nextCursor || loadingMoreRef.current) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    client
      .request<ListSessionsResponse>(
        buildListPath({ status: statusFilter, archived: archivedView, query: committedQuery, locale, cursor: nextCursor }),
      )
      .then((response) => {
        setItems((prev) => {
          const seen = new Set(prev.map((item) => item.sessionId));
          return [...prev, ...response.items.filter((item) => !seen.has(item.sessionId))];
        });
        setNextCursor(response.nextCursor);
      })
      .catch((error: unknown) => {
        setListError(errorMessage(error, t("common.unknown")));
      })
      .finally(() => {
        loadingMoreRef.current = false;
        setLoadingMore(false);
      });
  };

  // New Chat (§6.1): synchronous guard; failure re-enables the button and
  // shows the error in this area.
  const onNewChat = () => {
    if (creatingRef.current) return;
    creatingRef.current = true;
    setCreating(true);
    setCreateError(null);
    client
      .request<Session>("/chat/sessions", { method: "POST", body: {} })
      .then((session) => navigateTo(`/?session=${encodeURIComponent(session.sessionId)}`))
      .catch((error: unknown) => setCreateError(errorMessage(error, t("common.unknown"))))
      .finally(() => {
        creatingRef.current = false;
        setCreating(false);
      });
  };

  // One session action at a time (§6.1); success removes the row and shows a
  // success notice.
  const runAction = useCallback(
    (item: SessionHistoryItem, action: SessionAction) => {
      if (actionGuardRef.current) return;
      actionGuardRef.current = true;
      setPendingActionId(item.sessionId);
      setActionError(null);
      const finish = (message: string) => {
        setItems((prev) => prev.filter((entry) => entry.sessionId !== item.sessionId));
        setNotice(message);
        setConfirmingDeleteId(null);
      };
      const request =
        action === "delete"
          ? client.request<void>(`/chat/sessions/${encodeURIComponent(item.sessionId)}`, { method: "DELETE" })
          : client.request<unknown>(
              `/chat/sessions/${encodeURIComponent(item.sessionId)}/${action === "archive" ? "archive" : "unarchive"}`,
              { method: "POST", body: {} },
            );
      request
        .then(() =>
          finish(
            t(action === "archive" ? "chat.archivedNotice" : action === "restore" ? "chat.restoredNotice" : "chat.deletedNotice"),
          ),
        )
        .catch((error: unknown) => setActionError(errorMessage(error, t("common.unknown"))))
        .finally(() => {
          actionGuardRef.current = false;
          setPendingActionId(null);
        });
    },
    [client, t],
  );

  return (
    <section aria-label={t("chat.listLabel")} className="flex w-80 shrink-0 flex-col border-r">
      <div className="space-y-2 border-b p-3">
        <Button onClick={onNewChat} disabled={creating} className="w-full">
          <Plus aria-hidden="true" />
          {t("shell.newChat")}
        </Button>
        {createError ? <InlineNotice variant="error">{createError}</InlineNotice> : null}

        <div role="group" aria-label={t("chat.archiveView")} className="flex gap-1">
          <Button
            variant={archivedView ? "ghost" : "secondary"}
            size="sm"
            className="flex-1"
            aria-pressed={!archivedView}
            onClick={() => setArchivedView(false)}
          >
            {t("chat.conversations")}
          </Button>
          <Button
            variant={archivedView ? "secondary" : "ghost"}
            size="sm"
            className="flex-1"
            aria-pressed={archivedView}
            onClick={() => setArchivedView(true)}
          >
            {t("chat.archiveView")}
          </Button>
        </div>

        <div role="group" aria-label={t("common.status")} className="flex gap-1">
          {STATUS_TABS.map((tab) => (
            <Button
              key={tab.value}
              variant={statusFilter === tab.value ? "secondary" : "ghost"}
              size="sm"
              className="flex-1"
              aria-pressed={statusFilter === tab.value}
              onClick={() => setStatusFilter(tab.value)}
            >
              {t(tab.labelKey)}
            </Button>
          ))}
        </div>

        <form onSubmit={onSearchSubmit} className="flex gap-2" role="search">
          <Input
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder={t("chat.searchPlaceholder")}
            aria-label={t("chat.searchLabel")}
            className="min-w-0 flex-1"
          />
          <Button type="submit" variant="outline" size="icon" aria-label={t("common.search")}>
            <Search aria-hidden="true" />
          </Button>
        </form>
      </div>

      {notice ? (
        <Banner variant="success" className="m-2" onDismiss={() => setNotice(null)}>
          {notice}
        </Banner>
      ) : null}
      {actionError ? (
        <Banner variant="error" className="m-2" onDismiss={() => setActionError(null)}>
          {actionError}
        </Banner>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading ? (
          <LoadingState label={t("common.loading")} />
        ) : listError ? (
          <Banner variant="error" className="m-2">
            {listError}
          </Banner>
        ) : items.length === 0 ? (
          <EmptyPanel
            className="m-2"
            title={archivedView ? t("chat.emptyArchived") : t("chat.empty")}
          />
        ) : (
          <ul className="divide-y">
            {items.map((item) => {
              const isCurrent = item.sessionId === currentSession;
              const busy = pendingActionId !== null;
              const confirming = confirmingDeleteId === item.sessionId;
              return (
                <li key={item.sessionId} className={cn("p-3", isCurrent && "bg-accent/60")}>
                  <a
                    href={workspaceHref({ view: "chat", session: item.sessionId })}
                    aria-current={isCurrent ? "page" : undefined}
                    className="block rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <div className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">
                        {item.title ?? t("chat.untitled")}
                      </span>
                      <Badge variant={item.status === "open" ? "info" : "secondary"}>
                        {t(item.status === "open" ? "chat.statusOpen" : "chat.statusClosed")}
                      </Badge>
                    </div>
                    <div className="mt-1 truncate text-xs text-muted-foreground">
                      {item.preview ?? t("chat.noPreview")}
                    </div>
                    <time
                      className="mt-1 block text-xs text-muted-foreground"
                      dateTime={item.updatedAt}
                      title={formatFullTime(item.updatedAt, locale)}
                    >
                      {formatListTime(item.updatedAt)}
                    </time>
                  </a>

                  {confirming ? (
                    <div role="alert" className="mt-2 space-y-2 rounded-md border border-destructive/50 p-2">
                      <div className="text-xs font-medium">{t("chat.deleteTitle")}</div>
                      <div className="text-xs text-muted-foreground">{t("chat.deleteBody")}</div>
                      <div className="flex gap-2">
                        <Button
                          variant="destructive"
                          size="sm"
                          disabled={busy}
                          onClick={() => runAction(item, "delete")}
                        >
                          {t("common.confirm")}
                        </Button>
                        <Button variant="outline" size="sm" disabled={busy} onClick={() => setConfirmingDeleteId(null)}>
                          {t("common.cancel")}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-2 flex gap-1">
                      {archivedView ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={busy}
                          onClick={() => runAction(item, "restore")}
                          aria-label={`${t("chat.restore")}: ${item.title ?? t("chat.untitled")}`}
                        >
                          <ArchiveRestore aria-hidden="true" />
                          {t("chat.restore")}
                        </Button>
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={busy}
                          onClick={() => runAction(item, "archive")}
                          aria-label={`${t("chat.archive")}: ${item.title ?? t("chat.untitled")}`}
                        >
                          <Archive aria-hidden="true" />
                          {t("chat.archive")}
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={busy}
                        onClick={() => setConfirmingDeleteId(item.sessionId)}
                        aria-label={`${t("common.delete")}: ${item.title ?? t("chat.untitled")}`}
                      >
                        <Trash2 aria-hidden="true" />
                        {t("common.delete")}
                      </Button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {!loading && !listError && nextCursor ? (
          <div className="p-3">
            <Button variant="outline" className="w-full" onClick={onLoadMore} disabled={loadingMore}>
              {loadingMore ? t("common.loadingMore") : t("common.loadMore")}
            </Button>
          </div>
        ) : null}
      </div>
    </section>
  );
}
