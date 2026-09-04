import { useState } from "react";
import { apiClient, type ApiClient } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { EmptyPanel } from "@/components/feedback";
import { TaskList } from "./task-list";
import { TaskDetail } from "./task-detail";

/**
 * Tasks workspace (spec §7): status-filtered + searchable list on the left,
 * the projection detail (timeline / run logs / artifacts / controls) on the
 * right. Without a `task` in the URL the detail area stays an empty panel —
 * no stale detail is kept (spec §7.2.5, §13.3).
 */

export interface TasksViewProps {
  task?: string | undefined;
  session?: string | undefined;
  /** Injectable for tests/embedding (spec §2.1). */
  client?: ApiClient;
  apiBase?: string;
}

export function TasksView({ task, session, client = apiClient, apiBase = "/v1" }: TasksViewProps) {
  const { t } = useI18n();
  const [listReloadToken, setListReloadToken] = useState(0);

  return (
    <div className="flex h-full min-h-0">
      <TaskList client={client} currentTask={task} session={session} reloadToken={listReloadToken} />
      {task ? (
        <TaskDetail
          client={client}
          apiBase={apiBase}
          taskId={task}
          onChanged={() => setListReloadToken((token) => token + 1)}
        />
      ) : (
        <div className="flex flex-1 items-center justify-center p-6">
          <EmptyPanel title={t("shell.navTasks")} description={t("tasks.selectTask")} />
        </div>
      )}
    </div>
  );
}
