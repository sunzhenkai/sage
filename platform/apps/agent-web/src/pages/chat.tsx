import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Activity, Archive, ArchiveRestore, ListChecks, MessageSquare, MoreHorizontal, MessagesSquare, Plus, RotateCw, Search, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { PageHeader } from '@/components/layout/app-shell';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Empty, ErrorState, Kbd } from '@/components/ui/misc';
import { LoadingState, formatElapsed } from '@/components/bui/loading-state';
import { CardPane, PageColumn, PageContent, Quiet, SubPane } from '@/components/layout/page';
import { PromptBar, UserBubble, type PromptMenuItem, type PromptModel } from '@/components/bui/prompt-bar';
import { ArchiveToggle, SessionHeader, SessionList } from '@/components/bui/session-list';
import { StreamingText } from '@/components/bui/streaming-text';
import { TaskRows } from '@/components/bui/task-rows';
import { ThinkingTrace, type TraceRow } from '@/components/bui/thinking';
import { ToolChips } from '@/components/bui/tool-chips';
import { api } from '@/lib/api';
import { errorDisplay } from '@/lib/error-message';
import { useLocale, useT } from '@/lib/i18n';
import { isMock } from '@/lib/mock';
import { streamTimeline, type StreamState } from '@/lib/sse';
import type { ChatRun, TimelineEvent } from '@/lib/types';
import { cn, formatTime, relativeTime, shortId } from '@/lib/utils';
import { ChartCard, StackedBars, useChartTheme } from '@/components/charts';

export function ChatPage() {
  const { sessionId } = useParams();
  const [search, setSearch] = useSearchParams();
  const navigate = useNavigate();
  const t = useT();
  // `locale` is part of the query key so a language switch refetches the untitled-title fallback server-side.
  const locale = useLocale();
  const queryClient = useQueryClient();
  const [q, setQ] = useState('');
  const [archived, setArchived] = useState(false);
  const sessions = useQuery({ queryKey: ['chat', 'sessions', { q, archived, locale }], queryFn: () => api.chat.listSessions({ limit: 50, q: q || undefined, archived, locale }) });
  const create = useMutation({
    mutationFn: () => api.chat.createSession(),
    onSuccess: (session) => { void queryClient.invalidateQueries({ queryKey: ['chat', 'sessions'] }); const q = search.get('q'); void navigate(`/chat/${session.sessionId}${q ? `?q=${encodeURIComponent(q)}` : ''}`); }
  });

  useEffect(() => {
    if (search.get('new') === '1' && !create.isPending) { const q = search.get('q'); setSearch(q ? { q } : {}, { replace: true }); create.mutate(); }
  }, [search, setSearch, create]);

  return (
    <div className="flex min-h-0 flex-1">
      <SubPane>
        <PageHeader title={t('nav.chat')} actions={<Button variant="ghost" size="icon" title={t('chat.newSession')} onClick={() => create.mutate()} disabled={create.isPending}><Plus /></Button>} />
        <div className="flex items-center gap-1 border-b border-line px-2 py-1.5">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-faint" strokeWidth={1.75} />
            <Input placeholder={t('chat.filterSessions')} value={q} onChange={(e) => setQ(e.target.value)} className="h-7 pl-7 text-[12.5px]" />
          </div>
          <ArchiveToggle archived={archived} onChange={setArchived} />
        </div>
        <PageContent flush className="px-2.5 pb-2">
          {sessions.isLoading ? <SessionSkeleton /> : sessions.error ? <ErrorState error={sessions.error} /> : sessions.data?.items.length === 0 ? (
            <Empty icon={MessagesSquare} title={archived ? t('chat.empty.archived') : t('chat.empty.none')} hint={t('chat.empty.hint')}>
              <Button size="sm" onClick={() => create.mutate()}><Plus />{t('chat.newSession')}</Button>
            </Empty>
          ) : (
            <SessionList items={sessions.data?.items ?? []} activeId={sessionId} />
          )}
        </PageContent>
      </SubPane>
      <section className="flex min-w-0 flex-1 flex-col">
        {sessionId ? <SessionView key={sessionId} sessionId={sessionId} /> : (
          <Empty icon={MessageSquare} title={t('chat.noSelection.title')} hint={t('chat.noSelection.hint')}>
            <Button size="sm" onClick={() => create.mutate()}><Plus />{t('chat.newSession')}</Button>
            <Button size="sm" variant="secondary" onClick={() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }))}>{t('chat.commandMenu')} <Kbd className="ml-1">⌘K</Kbd></Button>
          </Empty>
        )}
      </section>
    </div>
  );
}

function SessionSkeleton() {
  return (
    <div className="flex flex-col gap-1">
      {Array.from({ length: 7 }, (_, i) => (
        <div key={i} className="flex flex-col gap-1.5 px-2.5 py-2.5">
          <div className="skeleton h-2.5" style={{ width: `${45 + ((i * 23) % 35)}%` }} />
          <div className="skeleton h-2 w-3/4 opacity-60" />
        </div>
      ))}
    </div>
  );
}

interface RunGroup { runId: string; userText: string[]; assistantText: string; events: TimelineEvent[]; status?: string; attempt?: number; at: string }

function groupTimeline(events: TimelineEvent[]): RunGroup[] {
  const groups = new Map<string, RunGroup>();
  for (const event of events) {
    let group = groups.get(event.runId);
    if (!group) { group = { runId: event.runId, userText: [], assistantText: '', events: [], at: event.occurredAt }; groups.set(event.runId, group); }
    group.events.push(event);
    const p = event.payload;
    if (p.kind === 'text') { if (p.messageId) group.userText.push(p.text); else group.assistantText += p.text; }
    if (p.kind === 'run') { group.status = p.status; group.attempt = p.attempt; }
  }
  return [...groups.values()];
}

function SessionView({ sessionId }: { sessionId: string }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const t = useT();
  const detail = useQuery({ queryKey: ['chat', 'session', sessionId], queryFn: () => api.chat.getSession(sessionId) });
  const providers = useQuery({ queryKey: ['providers', 'settings'], queryFn: api.providers.settings, retry: false });
  const [connectionId, setConnectionId] = useState<string>('');
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [stream, setStream] = useState<StreamState>('connecting');
  const [params] = useSearchParams();
  const [draft, setDraft] = useState(() => params.get('q') ?? '');
  const scroller = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useState<'chat' | 'runs'>('chat');
  const tasks = useQuery({ queryKey: ['tasks'], queryFn: () => api.tasks.list({ limit: 200 }), retry: false });

  useEffect(() => { if (!connectionId && providers.data?.providerConnectionId) setConnectionId(providers.data.providerConnectionId); }, [providers.data, connectionId]);

  useEffect(() => {
    let stop: (() => void) | undefined;
    let cancelled = false;
    void api.chat.events(sessionId, 0).then(({ events: initial }) => {
      if (cancelled) return;
      setEvents(initial);
      setLoaded(true);
      const last = initial.at(-1)?.sequence ?? 0;
      if (isMock()) { setStream('live'); return; }
      stop = streamTimeline((after) => api.chat.timelineUrl(sessionId, after), last, (event) => {
        setEvents((prev) => (prev.some((e) => e.sequence === event.sequence) ? prev : [...prev, event]));
        if (event.payload.kind === 'run') void queryClient.invalidateQueries({ queryKey: ['chat', 'session', sessionId] });
      }, setStream);
    }).catch(() => { setStream('closed'); setLoaded(true); });
    return () => { cancelled = true; stop?.(); };
  }, [sessionId, queryClient]);

  useEffect(() => { scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' }); }, [events.length]);

  const send = useMutation({
    mutationFn: (text: string) => api.chat.submit(sessionId, text, connectionId || undefined),
    onSuccess: () => { setDraft(''); void queryClient.invalidateQueries({ queryKey: ['chat', 'sessions'] }); }
  });
  const retry = useMutation({ mutationFn: (runId: string) => api.chat.retryRun(runId, connectionId || undefined) });
  const archive = useMutation({
    mutationFn: () => (detail.data?.session.archivedAt ? api.chat.unarchive(sessionId) : api.chat.archive(sessionId)),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ['chat'] }); }
  });
  const remove = useMutation({
    mutationFn: () => api.chat.remove(sessionId),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ['chat', 'sessions'] }); navigate('/chat'); }
  });

  const groups = useMemo(() => groupTimeline(events), [events]);
  const runs = useMemo(() => new Map<string, ChatRun>((detail.data?.runs ?? []).map((r) => [r.runId, r])), [detail.data]);
  const busy = groups.some((g) => (g.status ?? runs.get(g.runId)?.status) === 'active');
  const session = detail.data?.session;
  const submit = () => { const text = draft.trim(); if (text && !send.isPending) send.mutate(text); };
  const models: PromptModel[] = (providers.data?.providers ?? []).map((p) => ({ id: p.id, label: p.name, disabled: !p.available }));
  const sources: PromptMenuItem[] = (tasks.data?.tasks ?? []).slice(0, 8).map((task) => ({ key: task.taskId, icon: <ListChecks strokeWidth={1.75} />, label: task.taskId, hint: `${task.taskType ?? t('chat.sources.taskTypeFallback')} · ${task.status}`, insert: `@${task.taskId}` }));
  const commands: PromptMenuItem[] = [
    { key: 'new', icon: <Plus strokeWidth={1.75} />, label: '/new', hint: t('chat.commands.new'), run: () => { void navigate('/chat?new=1'); } },
    { key: 'archive', icon: <Archive strokeWidth={1.75} />, label: '/archive', hint: session?.archivedAt ? t('chat.commands.unarchive') : t('chat.commands.archive'), run: () => archive.mutate() },
    { key: 'retry', icon: <RotateCw strokeWidth={1.75} />, label: '/retry', hint: t('chat.commands.retry'), disabled: !groups.some((g) => (g.status ?? runs.get(g.runId)?.status) === 'failed'), run: () => { const last = [...groups].reverse().find((g) => (g.status ?? runs.get(g.runId)?.status) === 'failed'); if (last) retry.mutate(last.runId); } },
    { key: 'runs', icon: <Activity strokeWidth={1.75} />, label: '/runs', hint: t('chat.commands.runs'), run: () => setTab('runs') }
  ];
  const allRuns = detail.data?.runs ?? [];

  return (
    <>
      <SessionHeader id={sessionId} title={session?.title ?? t('common.untitledSession')} lastRun={allRuns[allRuns.length - 1]}
        meta={<><StreamIndicator state={stream} />{session?.archivedAt ? <Badge>{t('chat.header.archivedBadge')}</Badge> : null}<span>{t('chat.header.created', { time: relativeTime(session?.createdAt) })} · {allRuns.length} {t(allRuns.length === 1 ? 'chat.header.run' : 'chat.header.runs')}</span></>}
        tab={tab} onTab={setTab} tabs={[{ value: 'chat', label: t('nav.chat'), icon: <MessageSquare />, hint: t('chat.tabs.chatHint') }, { value: 'runs', label: t('chat.tabs.runs'), icon: <ListChecks />, count: allRuns.length, hint: t('chat.tabs.runsHint') }]}
        actions={<>
          <Button variant="ghost" size="icon" title={session?.archivedAt ? t('chat.unarchive') : t('chat.archive')} onClick={() => archive.mutate()}>{session?.archivedAt ? <ArchiveRestore /> : <Archive />}</Button>
          <Button variant="ghost" size="icon" title={t('chat.deleteSession')} onClick={() => { if (confirm(t('chat.deleteConfirm'))) remove.mutate(); }}><Trash2 /></Button>
          <Button variant="ghost" size="icon" title={t('chat.sessionTitleAttr', { id: sessionId })} onClick={() => { void navigator.clipboard?.writeText(sessionId); }}><MoreHorizontal /></Button>
        </>}
      />
      <CardPane width="chat" scrollRef={scroller}>
        {detail.error ? <ErrorState error={detail.error} /> : null}
          {tab === 'runs' ? (
            allRuns.length ? <><RunDurations runs={allRuns} /><TaskRows variant="list" rows={[...allRuns].reverse().map((r, i) => ({
              key: r.runId, status: r.status, step: allRuns.length - i,
              label: <span className="font-mono text-[12.5px]">{shortId(r.runId, 14)}</span>,
              amount: r.completedAt ? formatElapsed(new Date(r.completedAt).getTime() - new Date(r.startedAt).getTime()) : r.status === 'active' ? <LoadingState label={t('status.running')} since={r.startedAt} /> : '—',
              details: [{ label: t('chat.runs.started'), meta: formatTime(r.startedAt) }, { label: t('chat.runs.completed'), meta: formatTime(r.completedAt) }, { label: t('chat.runs.attempt'), meta: r.attempt }, ...(r.error ? [{ label: r.error.code, meta: errorDisplay(r.error).text }] : [])]
            }))} /></> : <Quiet>{t('chat.runs.empty')}</Quiet>
          ) : (
            <>
              {!loaded ? <ConversationSkeleton /> : groups.length === 0 ? (
                <Quiet>{t('chat.activity.empty')}</Quiet>
              ) : null}
              <div className="flex flex-col gap-8">
                {groups.map((group) => <RunBlock key={group.runId} group={group} run={runs.get(group.runId)} onRetry={() => retry.mutate(group.runId)} retrying={retry.isPending} onFollowUp={(text) => setDraft(text)} />)}
              </div>
            </>
          )}
      </CardPane>
      <PageColumn width="chat" className="pb-5 pt-3">
        <div>
          <PromptBar value={draft} onChange={setDraft} onSubmit={submit} models={models} model={connectionId} onModel={setConnectionId} sources={sources} commands={commands} busy={send.isPending}
            placeholder={isMock() ? t('chat.composer.mockPlaceholder') : t('chat.composer.placeholder')}
            status={send.error ? <span className="w-[220px] truncate text-[12px] text-red">{errorDisplay(send.error).text}</span> : busy ? <LoadingState label={t('status.running')} className="mr-1 scale-90" /> : null} />
        </div>
      </PageColumn>
    </>
  );
}

const toolIcon = (name: string) => (/read|fetch|snapshot|get|search/i.test(name) ? 'read' : /write|edit|create|save/i.test(name) ? 'write' : 'run');

function RunBlock({ group, run, onRetry, retrying, onFollowUp }: { group: RunGroup; run: ChatRun | undefined; onRetry: () => void; retrying: boolean; onFollowUp: (t: string) => void }) {
  const t = useT();
  const status = group.status ?? run?.status;
  const working = status === 'active';
  const started = run?.startedAt ?? group.at;
  const ended = run?.completedAt ?? (working ? undefined : group.events.at(-1)?.occurredAt);
  const took = ended ? formatElapsed(new Date(ended).getTime() - new Date(started).getTime()) : undefined;
  // tool events: pair started/completed by tool name
  const tools: { key: string; name: string; done: boolean; artifact?: string | undefined }[] = [];
  for (const e of group.events) {
    const p = e.payload;
    if (p.kind !== 'tool') continue;
    const open = tools.find((tool) => tool.name === p.toolName && !tool.done);
    if (p.status === 'completed' && open) { open.done = true; open.artifact = p.artifact?.name; }
    else tools.push({ key: String(e.sequence), name: p.toolName, done: p.status === 'completed', artifact: p.artifact?.name });
  }
  const artifacts = group.events.flatMap((e) => (e.payload.kind === 'artifact' ? [e.payload.artifact] : []));
  const taskEvents = group.events.flatMap((e) => (e.payload.kind === 'task' ? [{ seq: e.sequence, ...e.payload }] : []));
  const errors = group.events.flatMap((e) => (e.payload.kind === 'error' ? [{ seq: e.sequence, error: e.payload.error }] : []));
  const trace: TraceRow[] = [
    { key: 'start', primary: t('chat.run.started'), secondary: t('chat.run.attempt', { attempt: group.attempt ?? run?.attempt ?? 1 }), state: 'done' },
    ...tools.map((tool) => ({ key: `t${tool.key}`, primary: tool.done ? t('chat.run.called', { tool: tool.name }) : t('chat.run.calling', { tool: tool.name }), secondary: tool.artifact, mono: true, state: (tool.done || !working ? 'done' : 'active') as TraceRow['state'] })),
    ...taskEvents.map((task) => ({ key: `k${task.seq}`, primary: t('chat.run.taskStatus', { status: task.status.replace(/_/g, ' ') }), secondary: task.title, state: 'done' as const })),
    ...(working ? [{ key: 'gen', primary: group.assistantText ? t('chat.run.writing') : t('chat.run.waiting'), state: 'active' as const }]
      : [{ key: 'end', primary: status === 'failed' ? t('chat.run.failed') : t('chat.run.completed'), secondary: took, state: (status === 'failed' ? 'failed' : 'done') as TraceRow['state'] }])
  ];
  const toolCalls = tools.length === 1 ? t('chat.run.toolCallsOne', { tools: tools.length }) : t('chat.run.toolCallsMany', { tools: tools.length });
  const artifactCount = artifacts.length === 1 ? t('chat.run.artifactOne', { artifacts: artifacts.length }) : t('chat.run.artifactMany', { artifacts: artifacts.length });
  return (
    <section className="flex flex-col gap-3" style={{ animation: 'fade-up 360ms cubic-bezier(0.23,1,0.32,1) both' }}>
      {group.userText.map((text, i) => (
        <div key={i} className="flex justify-end">
          <UserBubble>{text}</UserBubble>
        </div>
      ))}
      <ThinkingTrace working={working} activeLabel={t('chat.run.thinking')} doneLabel={status === 'failed' ? t('chat.run.failedAfter', { took: took ?? '—' }) : t('chat.run.workedFor', { took: took ?? '—' })} rows={trace} defaultOpen={working} />
      {tools.length || artifacts.length ? (
        <ToolChips header={artifacts.length ? t('chat.run.toolCallsAndArtifacts', { tools: toolCalls, artifacts: artifactCount }) : toolCalls}
          steps={tools.map((tool) => ({ key: tool.key, icon: toolIcon(tool.name), label: tool.done ? t('chat.run.calledChip') : t('chat.run.callingChip'), chip: tool.name, mono: true, active: !tool.done && working, ...(tool.artifact ? { detail: [{ text: `→ ${tool.artifact}` }] } : {}) }))}
          files={artifacts.map((a) => ({ name: a.name, meta: `${Math.max(1, Math.round(a.sizeBytes / 1024))} KB` }))} />
      ) : null}
      {taskEvents.length ? (
        <TaskRows rows={taskEvents.map((task) => ({ key: String(task.seq), label: task.title, status: task.status, amount: task.promotionMode, ...(task.taskId ? { onOpen: () => { window.location.assign(`/tasks/${task.taskId}`); } } : {}), details: [{ label: t('chat.run.task'), meta: task.taskId ?? '—' }, ...(task.reason ? [{ label: t('chat.run.reason'), meta: task.reason }] : [])] }))} />
      ) : null}
      {group.assistantText ? <StreamingText text={group.assistantText} streaming={working} followUps={working ? [] : [t('chat.followUps.summarize'), t('chat.followUps.next')]} onFollowUp={onFollowUp} />
        : working ? <LoadingState label={t('chat.run.generating')} since={started} /> : null}
      {errors.map(({ seq, error }) => {
        const display = errorDisplay(error);
        return (
          <div key={seq} className="flex items-start gap-2.5 rounded-card bg-red-tint px-3 py-2.5 text-[13px]">
            <span className="mt-0.5 grid size-4 shrink-0 place-items-center rounded-full bg-red text-white"><svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round"><path d="M12 6v8M12 18.5v.5" /></svg></span>
            <div className="min-w-0 flex-1"><span className="font-medium text-red">{error.code}</span> <span className="text-ink-2">{display.text}</span>{display.detail ? <span className="ml-2 break-words font-mono text-[11px] text-faint">{display.detail}</span> : null}</div>
            {status === 'failed' ? <Button size="sm" variant="secondary" onClick={onRetry} disabled={retrying}><RotateCw />{t('common.retry')}</Button> : null}
          </div>
        );
      })}
    </section>
  );
}

function ConversationSkeleton() {
  return (
    <div className="flex flex-col gap-8">
      {[0, 1].map((i) => (
        <div key={i} className="flex flex-col gap-3">
          <div className="skeleton ml-auto h-8 w-56 rounded-xl" />
          <div className="skeleton h-3 w-32" /><div className="skeleton h-2.5 w-4/5" /><div className="skeleton h-2.5 w-3/5" />
        </div>
      ))}
    </div>
  );
}

function StreamIndicator({ state }: { state: StreamState }) {
  const t = useT();
  const map = { live: ['bg-green', 'chat.stream.live'], connecting: ['bg-amber', 'chat.stream.connecting'], reconnecting: ['bg-amber', 'chat.stream.reconnecting'], closed: ['bg-red', 'chat.stream.closed'] } as const;
  const [color, labelKey] = map[state];
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted">
      <span className="relative flex size-1.5">
        {state === 'live' ? <span className={cn('absolute inline-flex size-full animate-ping rounded-full opacity-60', color)} /> : null}
        <span className={cn('relative inline-flex size-1.5 rounded-full', color)} />
      </span>
      {t(labelKey)}
    </span>
  );
}

function RunDurations({ runs }: { runs: ChatRun[] }) {
  const t = useT();
  const ct = useChartTheme();
  const data = runs.map((r, i) => {
    const s = r.completedAt ? Math.round((new Date(r.completedAt).getTime() - new Date(r.startedAt).getTime()) / 100) / 10 : Math.round((Date.now() - new Date(r.startedAt).getTime()) / 100) / 10;
    return { label: `#${i + 1}`, succeeded: r.status === 'succeeded' ? s : 0, failed: r.status === 'failed' ? s : 0, active: r.status === 'active' || r.status === 'paused' ? s : 0 };
  });
  return (
    <ChartCard className="mb-5" title={t('chat.runs.durationTitle')} description={t('chat.runs.durationDescription')}>
      <StackedBars data={data} series={[{ key: 'succeeded', label: t('status.succeeded'), color: ct.status.succeeded! }, { key: 'failed', label: t('status.failed'), color: ct.status.failed! }, { key: 'active', label: t('status.running'), color: ct.status.active! }]} height={130} />
    </ChartCard>
  );
}
