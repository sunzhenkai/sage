import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { ViewTab, ViewTabs } from '@/components/layout/app-shell';
import { Quiet } from '@/components/layout/page';
import { ToolChips } from '@/components/bui/tool-chips';
import { ErrorState, Loading } from '@/components/ui/misc';
import { api } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { shortId } from '@/lib/utils';

export function RunLogs({ taskId, live = false }: { taskId: string; live?: boolean }) {
  const t = useT();
  const [selected, setSelected] = useState<{ runId: string; attemptId: string } | undefined>();
  const logs = useQuery({
    queryKey: ['task', taskId, 'run-logs', selected],
    queryFn: () => api.tasks.runLogs(taskId, selected ? { ...selected, limit: 500 } : { limit: 500 }),
    ...(live ? { refetchInterval: 5_000 } : {})
  });
  if (logs.isLoading) return <Loading rows={4} />;
  if (logs.error) return <ErrorState error={logs.error} />;
  const data = logs.data;
  if (!data || data.attempts.length === 0) return <Quiet>{t('tasks.runLogs.empty')}</Quiet>;
  return (
    <div className="flex flex-col gap-3">
      <ViewTabs>
        {data.attempts.map((a) => {
          const active = data.selected?.runId === a.runId && data.selected.attemptId === a.attemptId;
          return <ViewTab key={`${a.runId}|${a.attemptId}`} active={active} onClick={() => setSelected({ runId: a.runId, attemptId: a.attemptId })}>{shortId(a.runId)} · {shortId(a.attemptId)}</ViewTab>;
        })}
      </ViewTabs>
      <ToolChips header={t('tasks.runLogs.eventsIn', { count: data.events.length, attempt: shortId(data.selected?.attemptId ?? '') })}
        steps={data.events.map((e) => ({ key: e.eventId, icon: /tool/.test(e.type) ? 'run' : /model/.test(e.type) ? 'think' : /artifact|write/.test(e.type) ? 'write' : 'read', label: e.type, chip: `#${e.sequence}  ${JSON.stringify(e.payload).slice(0, 80)}`, mono: true, detail: JSON.stringify(e.payload, null, 2).split('\n').map((text) => ({ text })) }))} />
      {data.nextFromSequence ? <p className="text-[12px] text-ink-3">{t('tasks.runLogs.more')}</p> : null}
    </div>
  );
}
