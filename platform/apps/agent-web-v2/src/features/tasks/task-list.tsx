import { useState } from "react";
import { Search } from "lucide-react";
import type { ApiClient } from "@/lib/api";
import { useI18n, type MessageKey } from "@/lib/i18n";
import { formatFullTime, formatListTime } from "@/lib/format";
import { navigateTo, workspaceHref } from "@/app/router";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Banner, EmptyPanel, LoadingState } from "@/components/feedback";
import { errorMessage } from "@/features/chat/types";
import { countRunning, filterTasks, taskStatusKey, TASK_STATUS_FILTERS, type TaskStatusFilter } from "./logic";
import { useTaskList } from "./use-task-list";

/**
 * Task list (spec §7.1): server-side status filter, client-side substring
 * search over taskId/taskType/target, a running counter, and an empty state
 * that points back to Chat (keeping the session when the URL carries one).
 */

const FILTER_LABEL_KEYS: Readonly<Record<TaskStatusFilter, MessageKey>> = {
  all: "tasks.statusAll",
  running: "tasks.statusRunning",
  paused: "tasks.statusPaused",
  failed: "tasks.statusFailed",
  succeeded: "tasks.statusSucceeded",
  cancelled: "tasks.statusCancelled",
};

export function TaskList({
  client,
  currentTask,
  session,
  reloadToken,
}: {
  client: ApiClient;
  currentTask?: string | undefined;
  session?: string | undefined;
  /** Bump to force a reload (e.g. after a successful task control). */
  reloadToken?: number;
}) {
  const { t, locale } = useI18n();
  const [filter, setFilter] = useState<TaskStatusFilter>("all");
  const [search, setSearch] = useState("");
  const { loading, tasks, error } = useTaskList({ client, filter, reloadToken });

  const visible = filterTasks(tasks, search);
  const running = countRunning(tasks);

  return (
    <section aria-label={t("tasks.listLabel")} className="flex w-96 shrink-0 flex-col border-r">
      <div className="space-y-2 border-b p-3">
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold">{t("shell.navTasks")}</span>
          <Badge variant="info">{t("tasks.runningCount", { count: running })}</Badge>
        </div>
        <div role="group" aria-label={t("tasks.filterLabel")} className="flex flex-wrap gap-1">
          {TASK_STATUS_FILTERS.map((value) => (
            <Button
              key={value}
              variant={filter === value ? "secondary" : "ghost"}
              size="sm"
              aria-pressed={filter === value}
              onClick={() => setFilter(value)}
            >
              {t(FILTER_LABEL_KEYS[value])}
            </Button>
          ))}
        </div>
        <div className="relative">
          <Search aria-hidden="true" className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t("tasks.searchPlaceholder")}
            aria-label={t("tasks.searchLabel")}
            className="pl-8"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading ? (
          <LoadingState label={t("common.loading")} />
        ) : error ? (
          <Banner variant="error" className="m-2">
            {errorMessage(error, t("common.unknown"))}
          </Banner>
        ) : visible.length === 0 ? (
          tasks.length === 0 ? (
            <EmptyPanel
              className="m-2"
              title={t("tasks.empty")}
              description={t("tasks.emptyHint")}
              action={{
                label: t("tasks.emptyGoChat"),
                onClick: () => navigateTo(workspaceHref({ view: "chat", session })),
              }}
            />
          ) : (
            <EmptyPanel className="m-2" title={t("tasks.emptySearch")} />
          )
        ) : (
          <ul className="divide-y">
            {visible.map((task) => {
              const isCurrent = task.taskId === currentTask;
              const statusKey = taskStatusKey(task.status);
              return (
                <li key={task.taskId} className={cn("p-3", isCurrent && "bg-accent/60")}>
                  <a
                    href={workspaceHref({ view: "tasks", task: task.taskId, session })}
                    aria-current={isCurrent ? "page" : undefined}
                    className="block rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <div className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">{task.taskId}</span>
                      <Badge variant={task.status === "failed" ? "destructive" : task.status === "running" ? "info" : "secondary"}>
                        {statusKey ? t(statusKey) : `${task.status} `}
                      </Badge>
                    </div>
                    <div className="mt-1 truncate text-xs text-muted-foreground">
                      {task.taskType} · {task.targetSnapshot?.targetId ?? task.targetId}
                    </div>
                    <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                      <span>
                        {t("tasks.attemptLabel")} {task.attempt}
                      </span>
                      {task.projectionUpdatedAt ? (
                        <time dateTime={task.projectionUpdatedAt} title={formatFullTime(task.projectionUpdatedAt, locale)}>
                          {formatListTime(task.projectionUpdatedAt)}
                        </time>
                      ) : null}
                      <Badge variant="outline">{task.freshness}</Badge>
                    </div>
                  </a>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
