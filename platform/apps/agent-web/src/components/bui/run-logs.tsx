import { useQuery } from '@tanstack/react-query';
import { ArrowDown, Check, ChevronRight, ChevronsDownUp, ChevronsUpDown, Copy, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { EmptyPane } from '@/components/bui/artifacts';
import { ViewTab, ViewTabs } from '@/components/layout/app-shell';
import { Quiet } from '@/components/layout/page';
import { Button } from '@/components/ui/button';
import { ErrorState, Loading } from '@/components/ui/misc';
import { api } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { eventTone, extractDetailSections, formatDurationMs, formatEventTime, parseEventAtMs, summarizeRunLogEvent } from '@/lib/run-log-format';
import type { RunLogAttempt, RunLogEvent } from '@/lib/types';
import { cn, relativeTime, shortId } from '@/lib/utils';

const PAGE = 100;
const MAX_CATCHUP_PAGES = 5;

function mergeEvents(current: readonly RunLogEvent[], incoming: readonly RunLogEvent[]): RunLogEvent[] {
  const bySequence = new Map<number, RunLogEvent>();
  for (const event of current) bySequence.set(event.sequence, event);
  for (const event of incoming) bySequence.set(event.sequence, event);
  return [...bySequence.values()].sort((a, b) => a.sequence - b.sequence);
}

function formatAttemptLabel(attempt: RunLogAttempt, taskId: string): string {
  const prefix = `attempt-${taskId}-`;
  if (attempt.attemptId.startsWith(prefix)) {
    return `#${attempt.attemptId.slice(prefix.length)}`;
  }
  return `${shortId(attempt.runId)} · ${shortId(attempt.attemptId)}`;
}

function toneBadgeClass(tone: 'error' | 'success' | 'active' | 'neutral'): string {
  switch (tone) {
    case 'error':
      return 'bg-red-tint text-red';
    case 'success':
      return 'bg-green-tint text-green';
    case 'active':
      return 'bg-accent-tint text-accent-ink';
    default:
      return 'bg-inset text-ink-2';
  }
}

export function RunLogs({ taskId, live = false, fill = false }: { taskId: string; live?: boolean; fill?: boolean }) {
  const t = useT();
  const [selected, setSelected] = useState<{ runId: string; attemptId: string } | undefined>();
  const [events, setEvents] = useState<RunLogEvent[]>([]);
  const [earliest, setEarliest] = useState<number | undefined>();
  const [hasEarlier, setHasEarlier] = useState(false);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [follow, setFollow] = useState(live);
  const [atBottom, setAtBottom] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [copiedId, setCopiedId] = useState<string | undefined>();

  const scrollerRef = useRef<HTMLDivElement>(null);
  const latestRef = useRef<number | undefined>(undefined);
  const inFlightRef = useRef(false);
  const programmaticScrollRef = useRef(false);
  const autoExpandedRef = useRef<Set<string>>(new Set());
  const prevLiveRef = useRef(live);
  const userScrolledUpRef = useRef(false);

  const meta = useQuery({
    queryKey: ['task', taskId, 'run-logs-meta', selected],
    queryFn: () => api.tasks.runLogs(taskId, selected ? { ...selected, limit: 1 } : { limit: 1 }),
    refetchInterval: live ? 2_000 : false
  });

  const attempts = meta.data?.attempts ?? [];
  const selectedIds = meta.data?.selected;
  const attemptKey = selectedIds === undefined ? '' : `${selectedIds.runId}|${selectedIds.attemptId}`;
  const selectedAttempt = attempts.find((a) => a.runId === selectedIds?.runId && a.attemptId === selectedIds?.attemptId);
  const latestAttempt = attempts[0];
  const hasNewerAttempt = selected !== undefined && latestAttempt !== undefined && (
    latestAttempt.runId !== selected.runId || latestAttempt.attemptId !== selected.attemptId
  );
  const lastSequence = typeof selectedAttempt?.lastSequence === 'number' ? selectedAttempt.lastSequence : undefined;
  const firstSequence = typeof selectedAttempt?.firstSequence === 'number' ? selectedAttempt.firstSequence : 1;

  const scrollToBottom = useCallback(() => {
    const node = scrollerRef.current;
    if (node === null) return;
    programmaticScrollRef.current = true;
    requestAnimationFrame(() => {
      node.scrollTop = node.scrollHeight;
      setAtBottom(true);
      requestAnimationFrame(() => {
        programmaticScrollRef.current = false;
      });
    });
  }, []);

  // Reset per-task / per-attempt state when switching tasks or attempts.
  useEffect(() => {
    setEvents([]);
    setEarliest(undefined);
    latestRef.current = undefined;
    inFlightRef.current = false;
    setHasEarlier(false);
    setExpanded(new Set());
    autoExpandedRef.current = new Set();
    userScrolledUpRef.current = false;
    setFollow(live && !hasNewerAttempt);
  }, [taskId, attemptKey]);

  // Turn follow on when live becomes true (unless user explicitly scrolled up),
  // and refetch once when live transitions true -> false to catch terminal events.
  useEffect(() => {
    const wasLive = prevLiveRef.current;
    prevLiveRef.current = live;
    if (!wasLive && live && !userScrolledUpRef.current && !hasNewerAttempt) {
      setFollow(true);
    } else if (wasLive && !live) {
      void meta.refetch();
    }
  }, [live, hasNewerAttempt, meta.refetch]);

  // Single unified effect for initial tail load + incremental catch-up when lastSequence advances.
  useEffect(() => {
    if (selectedIds === undefined || lastSequence === undefined) return;
    if (latestRef.current !== undefined && lastSequence <= latestRef.current) return;
    if (inFlightRef.current) return;
    let cancelled = false;
    inFlightRef.current = true;

    const load = async (): Promise<void> => {
      try {
        if (latestRef.current === undefined) {
          const start = Math.max(firstSequence, lastSequence - PAGE + 1);
          const page = await api.tasks.runLogs(taskId, {
            runId: selectedIds.runId,
            attemptId: selectedIds.attemptId,
            fromSequence: start,
            limit: PAGE
          });
          if (cancelled) return;
          setEvents((prev) => mergeEvents(prev, page.events));
          const first = page.events[0]?.sequence;
          const last = page.events.at(-1)?.sequence;
          if (first !== undefined) setEarliest((value) => (value === undefined ? first : Math.min(value, first)));
          if (last !== undefined) latestRef.current = last;
          setHasEarlier(start > firstSequence);
          return;
        }

        let cursor: number | undefined = latestRef.current + 1;
        for (let i = 0; i < MAX_CATCHUP_PAGES && cursor !== undefined; i += 1) {
          const page = await api.tasks.runLogs(taskId, {
            runId: selectedIds.runId,
            attemptId: selectedIds.attemptId,
            fromSequence: cursor,
            limit: PAGE
          });
          if (cancelled) return;
          if (page.events.length > 0) {
            setEvents((prev) => mergeEvents(prev, page.events));
            const last = page.events.at(-1)?.sequence;
            if (last !== undefined) latestRef.current = Math.max(latestRef.current ?? 0, last);
          }
          cursor = page.nextFromSequence;
        }
      } finally {
        inFlightRef.current = false;
      }
    };

    void load();
    return () => { cancelled = true; };
  }, [taskId, attemptKey, firstSequence, lastSequence, selectedIds?.runId, selectedIds?.attemptId]);

  const sorted = useMemo(() => [...events].sort((a, b) => a.sequence - b.sequence), [events]);
  const tailSequence = sorted.at(-1)?.sequence;

  // Auto-scroll when follow is active and new events arrive.
  useEffect(() => {
    if (!follow || sorted.length === 0) return;
    scrollToBottom();
  }, [follow, sorted.length, tailSequence, scrollToBottom]);

  // Auto-expand error rows once on first appearance.
  useEffect(() => {
    const newlyFailed: string[] = [];
    for (const ev of sorted) {
      if (eventTone(ev) === 'error' && !autoExpandedRef.current.has(ev.eventId)) {
        autoExpandedRef.current.add(ev.eventId);
        newlyFailed.push(ev.eventId);
      }
    }
    if (newlyFailed.length > 0) {
      setExpanded((prev) => {
        const next = new Set(prev);
        for (const id of newlyFailed) next.add(id);
        return next;
      });
    }
  }, [sorted]);

  const handleRefresh = useCallback(async (): Promise<void> => {
    setRefreshing(true);
    try {
      const res = await meta.refetch();
      const target = res.data?.selected ?? selectedIds;
      if (target !== undefined && latestRef.current !== undefined && !inFlightRef.current) {
        inFlightRef.current = true;
        try {
          const page = await api.tasks.runLogs(taskId, {
            runId: target.runId,
            attemptId: target.attemptId,
            fromSequence: latestRef.current + 1,
            limit: PAGE
          });
          if (page.events.length > 0) {
            setEvents((prev) => mergeEvents(prev, page.events));
            const last = page.events.at(-1)?.sequence;
            if (last !== undefined) latestRef.current = Math.max(latestRef.current ?? 0, last);
          }
        } finally {
          inFlightRef.current = false;
        }
      }
    } finally {
      setRefreshing(false);
    }
  }, [meta, selectedIds, taskId]);

  const loadEarlier = async (): Promise<void> => {
    if (selectedIds === undefined || earliest === undefined || earliest <= firstSequence) return;
    setLoadingEarlier(true);
    try {
      const start = Math.max(firstSequence, earliest - PAGE);
      const page = await api.tasks.runLogs(taskId, {
        runId: selectedIds.runId,
        attemptId: selectedIds.attemptId,
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
        programmaticScrollRef.current = true;
        node.scrollTop = previousTop + (node.scrollHeight - previousHeight);
        requestAnimationFrame(() => {
          programmaticScrollRef.current = false;
        });
      });
    } finally {
      setLoadingEarlier(false);
    }
  };

  const onScroll = (): void => {
    if (programmaticScrollRef.current) return;
    const node = scrollerRef.current;
    if (node === null) return;
    const scrollable = node.scrollHeight > node.clientHeight + 4;
    const distance = node.scrollHeight - node.scrollTop - node.clientHeight;
    const nearBottom = !scrollable || distance < 24;
    setAtBottom(nearBottom);
    if (!scrollable) return;
    if (distance >= 48 && follow) {
      userScrolledUpRef.current = true;
      setFollow(false);
    } else if (nearBottom && live && !follow && !hasNewerAttempt) {
      userScrolledUpRef.current = false;
      setFollow(true);
    }
  };

  const toggleFollow = (): void => {
    if (follow && !hasNewerAttempt) {
      userScrolledUpRef.current = true;
      setFollow(false);
      return;
    }
    userScrolledUpRef.current = false;
    if (hasNewerAttempt) setSelected(undefined);
    setFollow(true);
    scrollToBottom();
    void handleRefresh();
  };

  const toggleRow = (eventId: string): void => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(eventId)) next.delete(eventId);
      else next.add(eventId);
      return next;
    });
  };

  const allExpanded = sorted.length > 0 && sorted.every((ev) => expanded.has(ev.eventId));
  const toggleAll = (): void => {
    if (allExpanded) {
      setExpanded(new Set());
    } else {
      setExpanded(new Set(sorted.map((ev) => ev.eventId)));
    }
  };

  const copyPayload = (ev: RunLogEvent): void => {
    void navigator.clipboard?.writeText(JSON.stringify(ev.payload, null, 2)).then(() => {
      setCopiedId(ev.eventId);
      window.setTimeout(() => setCopiedId((cur) => (cur === ev.eventId ? undefined : cur)), 1_500);
    });
  };

  const lifecycleOnly = sorted.length > 0 && sorted.every((event) => /^(run|engine|context)\./.test(event.type));
  const baseMs = useMemo(() => {
    for (const ev of sorted) {
      const ms = parseEventAtMs(ev.payload);
      if (ms !== undefined) return ms;
    }
    return undefined;
  }, [sorted]);

  if (meta.isLoading) {
    return fill ? <div className="p-4"><Loading rows={4} /></div> : <div className="p-4"><Loading rows={4} /></div>;
  }
  if (meta.error) {
    return <div className="p-4"><ErrorState error={meta.error} /></div>;
  }
  if (!meta.data || attempts.length === 0) {
    if (fill) {
      return (
        <EmptyPane title={t('tasks.runLogs.empty')}>
          <p className="text-[12px] text-faint">{t('tasks.runLogs.historicalHint')}</p>
        </EmptyPane>
      );
    }
    return (
      <div className="space-y-2 p-4">
        <Quiet>{t('tasks.runLogs.empty')}</Quiet>
        <p className="text-center text-[12px] text-faint">{t('tasks.runLogs.historicalHint')}</p>
      </div>
    );
  }

  return (
    <div className={cn('flex flex-col', fill && 'min-h-0 flex-1')}>
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2.5">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {attempts.length > 1 ? (
            <ViewTabs>
              {attempts.map((a) => {
                const active = selectedIds?.runId === a.runId && selectedIds.attemptId === a.attemptId;
                return (
                  <ViewTab
                    key={`${a.runId}|${a.attemptId}`}
                    active={active}
                    onClick={() => setSelected({ runId: a.runId, attemptId: a.attemptId })}
                  >
                    {formatAttemptLabel(a, taskId)}
                  </ViewTab>
                );
              })}
            </ViewTabs>
          ) : selectedAttempt !== undefined ? (
            <span className="font-mono text-[12px] text-ink-2">{formatAttemptLabel(selectedAttempt, taskId)}</span>
          ) : null}
          <span className="text-[12px] tabular-nums text-ink-3">
            {t('tasks.runLogs.attemptSummary', { count: selectedAttempt?.eventCount ?? sorted.length })}
            {selectedAttempt?.lastWrittenAt ? ` · ${relativeTime(selectedAttempt.lastWrittenAt)}` : ''}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {hasEarlier ? (
            <Button type="button" size="sm" variant="secondary" disabled={loadingEarlier} onClick={() => { void loadEarlier(); }}>
              {loadingEarlier ? t('tasks.runLogs.loadingEarlier') : t('tasks.runLogs.loadEarlier')}
            </Button>
          ) : null}
          {sorted.length > 0 ? (
            <Button type="button" size="sm" variant="ghost" onClick={toggleAll}>
              {allExpanded ? <ChevronsDownUp /> : <ChevronsUpDown />}
              {allExpanded ? t('tasks.runLogs.collapseAll') : t('tasks.runLogs.expandAll')}
            </Button>
          ) : null}
          <Button type="button" size="icon-sm" variant="ghost" title={t('tasks.runLogs.refresh')} onClick={() => { void handleRefresh(); }}>
            <RefreshCw className={cn((meta.isFetching || refreshing) && 'animate-spin')} />
          </Button>
          {live ? (
            <Button
              type="button"
              size="sm"
              variant={follow && !hasNewerAttempt ? 'ghost' : 'secondary'}
              aria-pressed={follow && !hasNewerAttempt}
              className={cn(follow && !hasNewerAttempt && 'bg-accent-tint text-accent-ink ring-1 ring-inset ring-accent/30 hover:bg-accent-tint')}
              onClick={toggleFollow}
            >
              {follow && !hasNewerAttempt ? <span className="size-1.5 rounded-full bg-green animate-pulse" /> : null}
              {hasNewerAttempt
                ? t('tasks.runLogs.newerAttempt')
                : follow
                  ? t('tasks.runLogs.following')
                  : t('tasks.runLogs.follow')}
            </Button>
          ) : !atBottom && sorted.length > 0 ? (
            <Button type="button" size="sm" variant="secondary" onClick={scrollToBottom}>
              <ArrowDown />
              {t('tasks.runLogs.jumpToBottom')}
            </Button>
          ) : null}
        </div>
      </div>

      {lifecycleOnly ? (
        <div className="shrink-0 border-b border-line bg-inset px-4 py-2 text-[12px] text-ink-2">
          {t('tasks.runLogs.sparseHint')}
        </div>
      ) : null}

      <div
        ref={scrollerRef}
        onScroll={onScroll}
        className={cn('overflow-y-auto px-4 py-3', fill ? 'min-h-0 flex-1' : 'max-h-[min(70vh,600px)] min-h-[240px]')}
      >
        {sorted.length === 0 ? (
          <Quiet>{t('tasks.runLogs.empty')}</Quiet>
        ) : (
          <div className="flex flex-col gap-1.5">
            {sorted.map((ev) => {
              const isOpen = expanded.has(ev.eventId);
              const tone = eventTone(ev);
              const time = formatEventTime(ev.payload, baseMs);
              const summary = summarizeRunLogEvent(ev);
              const durationMs = typeof ev.payload.durationMs === 'number' ? ev.payload.durationMs : undefined;
              const tokens = typeof ev.payload.tokens === 'number' ? ev.payload.tokens : undefined;
              const sections = isOpen ? extractDetailSections(ev) : [];

              return (
                <div
                  key={ev.eventId}
                  className={cn(
                    'w-full overflow-hidden rounded-control border transition-colors',
                    tone === 'error' ? 'border-red/30 bg-red-tint/30' : 'border-line bg-surface'
                  )}
                >
                  <button
                    type="button"
                    aria-expanded={isOpen}
                    onClick={() => toggleRow(ev.eventId)}
                    className="flex w-full items-start gap-2.5 px-3 py-2 text-left transition-colors hover:bg-hover"
                  >
                    <ChevronRight className={cn('mt-0.5 size-3.5 shrink-0 text-ink-3 transition-transform duration-150', isOpen && 'rotate-90')} />
                    <span className="w-8 shrink-0 pt-0.5 font-mono text-[11px] tabular-nums text-ink-3">#{ev.sequence}</span>
                    {time.clock !== undefined ? (
                      <span className="shrink-0 pt-0.5 font-mono text-[11px] tabular-nums text-ink-3" title={time.elapsed}>
                        {time.elapsed ?? time.clock}
                      </span>
                    ) : null}
                    <span className={cn('shrink-0 rounded-chip px-1.5 py-0.5 font-mono text-[11px] font-medium', toneBadgeClass(tone))}>
                      {ev.type}
                    </span>
                    <span className={cn('min-w-0 flex-1 break-words text-[12.5px] leading-[18px]', tone === 'error' ? 'text-red' : 'text-ink')}>
                      {summary}
                    </span>
                    {durationMs !== undefined || tokens !== undefined ? (
                      <span className="shrink-0 pt-0.5 font-mono text-[11px] tabular-nums text-ink-3">
                        {[
                          durationMs !== undefined ? formatDurationMs(durationMs) : undefined,
                          tokens !== undefined ? `${tokens} tok` : undefined
                        ].filter((x): x is string => x !== undefined).join(' · ')}
                      </span>
                    ) : null}
                  </button>

                  {isOpen ? (
                    <div className="space-y-3 border-t border-line bg-inset/60 px-3.5 py-3">
                      {sections.map((section) => (
                        <div key={section.key}>
                          <div className={cn('mb-1 text-[11px] font-medium', section.tone === 'error' ? 'text-red' : 'text-ink-3')}>
                            {t(section.labelKey)}
                          </div>
                          <pre className={cn(
                            'max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-chip border bg-surface p-2.5 font-mono text-[11.5px] leading-[1.6]',
                            section.tone === 'error' ? 'border-red/30 text-red' : 'border-line text-ink'
                          )}>
                            {section.text}
                          </pre>
                        </div>
                      ))}

                      <div>
                        <div className="mb-1 flex items-center justify-between">
                          <span className="text-[11px] font-medium text-ink-3">{t('tasks.runLogs.rawPayload')}</span>
                          <Button type="button" size="sm" variant="ghost" onClick={() => copyPayload(ev)}>
                            {copiedId === ev.eventId ? <Check /> : <Copy />}
                            {copiedId === ev.eventId ? t('common.copied') : t('common.copy')}
                          </Button>
                        </div>
                        <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-all rounded-chip border border-line bg-surface p-2.5 font-mono text-[11.5px] leading-[1.6] text-ink-2">
                          {JSON.stringify(ev.payload, null, 2)}
                        </pre>
                      </div>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
