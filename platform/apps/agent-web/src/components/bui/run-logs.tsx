import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ViewTab, ViewTabs } from '@/components/layout/app-shell';
import { Quiet } from '@/components/layout/page';
import { ToolChips } from '@/components/bui/tool-chips';
import { Button } from '@/components/ui/button';
import { ErrorState, Loading } from '@/components/ui/misc';
import { api } from '@/lib/api';
import { useT } from '@/lib/i18n';
import type { RunLogEvent } from '@/lib/types';
import { shortId } from '@/lib/utils';

const PAGE = 100;

function mergeEvents(current: readonly RunLogEvent[], incoming: readonly RunLogEvent[]): RunLogEvent[] {
  const bySequence = new Map<number, RunLogEvent>();
  for (const event of current) bySequence.set(event.sequence, event);
  for (const event of incoming) bySequence.set(event.sequence, event);
  return [...bySequence.values()].sort((a, b) => a.sequence - b.sequence);
}

export function RunLogs({ taskId, live = false }: { taskId: string; live?: boolean }) {
  const t = useT();
  const [selected, setSelected] = useState<{ runId: string; attemptId: string } | undefined>();
  const [events, setEvents] = useState<RunLogEvent[]>([]);
  const [earliest, setEarliest] = useState<number | undefined>();
  const [latest, setLatest] = useState<number | undefined>();
  const [hasEarlier, setHasEarlier] = useState(false);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const [follow, setFollow] = useState(true);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);

  const meta = useQuery({
    queryKey: ['task', taskId, 'run-logs-meta', selected],
    queryFn: () => api.tasks.runLogs(taskId, selected ? { ...selected, limit: 1 } : { limit: 1 }),
    ...(live ? { refetchInterval: 5_000 } : {})
  });

  const attemptKey = meta.data?.selected === undefined ? '' : `${meta.data.selected.runId}|${meta.data.selected.attemptId}`;
  const selectedAttempt = meta.data?.attempts.find((a) => a.runId === meta.data?.selected?.runId && a.attemptId === meta.data?.selected?.attemptId);
  const lastSequence = typeof selectedAttempt?.lastSequence === 'number' ? selectedAttempt.lastSequence : undefined;
  const firstSequence = typeof selectedAttempt?.firstSequence === 'number' ? selectedAttempt.firstSequence : 1;

  useEffect(() => {
    setEvents([]);
    setEarliest(undefined);
    setLatest(undefined);
    setHasEarlier(false);
    setFollow(true);
    stickToBottom.current = true;
  }, [taskId, attemptKey]);

  useEffect(() => {
    if (meta.data === undefined || meta.data.attempts.length === 0 || meta.data.selected === undefined || lastSequence === undefined) return;
    let cancelled = false;
    const load = async (): Promise<void> => {
      const start = Math.max(firstSequence, lastSequence - PAGE + 1);
      const page = await api.tasks.runLogs(taskId, {
        runId: meta.data.selected!.runId,
        attemptId: meta.data.selected!.attemptId,
        fromSequence: start,
        limit: PAGE
      });
      if (cancelled) return;
      setEvents((prev) => mergeEvents(prev, page.events));
      const first = page.events[0]?.sequence;
      const last = page.events.at(-1)?.sequence;
      if (first !== undefined) setEarliest((value) => value === undefined ? first : Math.min(value, first));
      if (last !== undefined) setLatest((value) => value === undefined ? last : Math.max(value, last));
      setHasEarlier(start > firstSequence);
    };
    void load();
    return () => { cancelled = true; };
  }, [taskId, attemptKey, firstSequence, lastSequence, meta.data?.selected?.runId, meta.data?.selected?.attemptId]);

  useEffect(() => {
    const selectedAttemptIds = meta.data?.selected;
    if (!live || selectedAttemptIds === undefined || latest === undefined) return;
    let cancelled = false;
    const tick = async (): Promise<void> => {
      const page = await api.tasks.runLogs(taskId, {
        runId: selectedAttemptIds.runId,
        attemptId: selectedAttemptIds.attemptId,
        fromSequence: latest + 1,
        limit: PAGE
      });
      if (cancelled || page.events.length === 0) return;
      setEvents((prev) => mergeEvents(prev, page.events));
      const last = page.events.at(-1)?.sequence;
      if (last !== undefined) setLatest(last);
    };
    const id = window.setInterval(() => { void tick(); }, 5_000);
    return () => { cancelled = true; window.clearInterval(id); };
  }, [live, taskId, attemptKey, latest, meta.data?.selected?.runId, meta.data?.selected?.attemptId]);

  useEffect(() => {
    if (!follow || !stickToBottom.current) return;
    const node = scrollerRef.current;
    if (node === null) return;
    node.scrollTop = node.scrollHeight;
  }, [events, follow]);

  const loadEarlier = async (): Promise<void> => {
    if (meta.data?.selected === undefined || earliest === undefined || earliest <= firstSequence) return;
    setLoadingEarlier(true);
    try {
      const start = Math.max(firstSequence, earliest - PAGE);
      const page = await api.tasks.runLogs(taskId, {
        runId: meta.data.selected.runId,
        attemptId: meta.data.selected.attemptId,
        fromSequence: start,
        limit: Math.max(1, earliest - start)
      });
      const node = scrollerRef.current;
      const previousHeight = node?.scrollHeight ?? 0;
      const previousTop = node?.scrollTop ?? 0;
      setEvents((prev) => mergeEvents(prev, page.events));
      const first = page.events[0]?.sequence;
      if (first !== undefined) setEarliest(first);
      setHasEarlier(start > firstSequence);
      requestAnimationFrame(() => {
        if (node === null) return;
        node.scrollTop = previousTop + (node.scrollHeight - previousHeight);
      });
    } finally {
      setLoadingEarlier(false);
    }
  };

  const onScroll = (): void => {
    const node = scrollerRef.current;
    if (node === null) return;
    const distance = node.scrollHeight - node.scrollTop - node.clientHeight;
    const atBottom = distance < 48;
    stickToBottom.current = atBottom;
    setFollow(atBottom);
  };

  const sorted = useMemo(() => [...events].sort((a, b) => a.sequence - b.sequence), [events]);
  const lifecycleOnly = sorted.length > 0 && sorted.every((event) => /^(run|engine|context)\./.test(event.type));

  if (meta.isLoading) return <Loading rows={4} />;
  if (meta.error) return <ErrorState error={meta.error} />;
  const data = meta.data;
  if (!data || data.attempts.length === 0) {
    return (
      <div className="space-y-2">
        <Quiet>{t('tasks.runLogs.empty')}</Quiet>
        <p className="text-[12px] text-faint">{t('tasks.runLogs.historicalHint')}</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-col gap-3">
      <ViewTabs>
        {data.attempts.map((a) => {
          const active = data.selected?.runId === a.runId && data.selected.attemptId === a.attemptId;
          return <ViewTab key={`${a.runId}|${a.attemptId}`} active={active} onClick={() => setSelected({ runId: a.runId, attemptId: a.attemptId })}>{shortId(a.runId)} · {shortId(a.attemptId)}</ViewTab>;
        })}
      </ViewTabs>
      {lifecycleOnly ? <p className="text-[12px] text-faint">{t('tasks.runLogs.sparseHint')}</p> : null}
      <div className="flex items-center gap-2">
        {hasEarlier ? (
          <Button type="button" size="sm" variant="secondary" disabled={loadingEarlier} onClick={() => { void loadEarlier(); }}>
            {loadingEarlier ? t('tasks.runLogs.loadingEarlier') : t('tasks.runLogs.loadEarlier')}
          </Button>
        ) : null}
        {live ? (
          <Button type="button" size="sm" variant={follow ? 'secondary' : 'default'} onClick={() => { setFollow(true); stickToBottom.current = true; }}>
            {t('tasks.runLogs.follow')}
          </Button>
        ) : null}
      </div>
      <div ref={scrollerRef} onScroll={onScroll} className="max-h-[min(70vh,560px)] min-h-[240px] overflow-y-auto rounded-card border border-line">
        {sorted.length === 0 ? <div className="p-3"><Quiet>{t('tasks.runLogs.empty')}</Quiet></div> : (
          <ToolChips header={t('tasks.runLogs.eventsIn', { count: sorted.length, attempt: shortId(data.selected?.attemptId ?? '') })}
            steps={sorted.map((e) => ({
              key: e.eventId,
              icon: /tool/.test(e.type) ? 'run' : /model/.test(e.type) ? 'think' : /artifact|write/.test(e.type) ? 'write' : 'read',
              label: e.type,
              chip: `#${e.sequence}  ${JSON.stringify(e.payload).slice(0, 80)}`,
              mono: true,
              detail: JSON.stringify(e.payload, null, 2).split('\n').map((text) => ({ text }))
            }))} />
        )}
      </div>
    </div>
  );
}
