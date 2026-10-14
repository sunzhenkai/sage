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
import { PageColumn, PageContent, Quiet } from '@/components/layout/page';
import { PromptBar, UserBubble, type PromptMenuItem, type PromptModel } from '@/components/bui/prompt-bar';
import { ArchiveToggle, SessionHeader, SessionList } from '@/components/bui/session-list';
import { StreamingText } from '@/components/bui/streaming-text';
import { TaskRows } from '@/components/bui/task-rows';
import { ThinkingTrace, type TraceRow } from '@/components/bui/thinking';
import { ToolChips } from '@/components/bui/tool-chips';
import { api } from '@/lib/api';
import { isMock } from '@/lib/mock';
import { streamTimeline, type StreamState } from '@/lib/sse';
import type { ChatRun, TimelineEvent } from '@/lib/types';
import { cn, formatTime, relativeTime, shortId } from '@/lib/utils';

export function ChatPage() {
  const { sessionId } = useParams();
  const [search, setSearch] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [q, setQ] = useState('');
  const [archived, setArchived] = useState(false);
  const sessions = useQuery({ queryKey: ['chat', 'sessions', { q, archived }], queryFn: () => api.chat.listSessions({ limit: 50, q: q || undefined, archived }) });
  const create = useMutation({
    mutationFn: () => api.chat.createSession(),
    onSuccess: (session) => { void queryClient.invalidateQueries({ queryKey: ['chat', 'sessions'] }); const q = search.get('q'); void navigate(`/chat/${session.sessionId}${q ? `?q=${encodeURIComponent(q)}` : ''}`); }
  });

  useEffect(() => {
    if (search.get('new') === '1' && !create.isPending) { const q = search.get('q'); setSearch(q ? { q } : {}, { replace: true }); create.mutate(); }
  }, [search, setSearch, create]);

  return (
    <div className="flex min-h-0 flex-1">
      <section className="flex w-[300px] shrink-0 flex-col border-r border-line">
        <PageHeader title="Chat" actions={<Button variant="ghost" size="icon" title="New session" onClick={() => create.mutate()} disabled={create.isPending}><Plus /></Button>} />
        <div className="flex items-center gap-1 border-b border-line px-2 py-1.5">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-faint" strokeWidth={1.75} />
            <Input placeholder="Filter sessions" value={q} onChange={(e) => setQ(e.target.value)} className="h-7 pl-7 text-[12.5px]" />
          </div>
          <ArchiveToggle archived={archived} onChange={setArchived} />
        </div>
        <PageContent flush className="px-2.5 pt-0.5">
          {sessions.isLoading ? <SessionSkeleton /> : sessions.error ? <ErrorState error={sessions.error} /> : sessions.data?.items.length === 0 ? (
            <Empty icon={MessagesSquare} title={archived ? 'No archived sessions' : 'No sessions yet'} hint="Start a conversation with the run agent.">
              <Button size="sm" onClick={() => create.mutate()}><Plus />New session</Button>
            </Empty>
          ) : (
            <SessionList items={sessions.data?.items ?? []} activeId={sessionId} />
          )}
        </PageContent>
      </section>
      <section className="flex min-w-0 flex-1 flex-col">
        {sessionId ? <SessionView key={sessionId} sessionId={sessionId} /> : (
          <Empty icon={MessageSquare} title="No session selected" hint="Pick a session from the list, or start a new one.">
            <Button size="sm" onClick={() => create.mutate()}><Plus />New session</Button>
            <Button size="sm" variant="secondary" onClick={() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }))}>Command menu <Kbd className="ml-1">⌘K</Kbd></Button>
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
  const sources: PromptMenuItem[] = (tasks.data?.tasks ?? []).slice(0, 8).map((t) => ({ key: t.taskId, icon: <ListChecks strokeWidth={1.75} />, label: t.taskId, hint: `${t.taskType ?? 'task'} · ${t.status}`, insert: `@${t.taskId}` }));
  const commands: PromptMenuItem[] = [
    { key: 'new', icon: <Plus strokeWidth={1.75} />, label: '/new', hint: 'Start a new session', run: () => { void navigate('/chat?new=1'); } },
    { key: 'archive', icon: <Archive strokeWidth={1.75} />, label: '/archive', hint: session?.archivedAt ? 'Unarchive this session' : 'Archive this session', run: () => archive.mutate() },
    { key: 'retry', icon: <RotateCw strokeWidth={1.75} />, label: '/retry', hint: 'Retry the last failed run', disabled: !groups.some((g) => (g.status ?? runs.get(g.runId)?.status) === 'failed'), run: () => { const last = [...groups].reverse().find((g) => (g.status ?? runs.get(g.runId)?.status) === 'failed'); if (last) retry.mutate(last.runId); } },
    { key: 'runs', icon: <Activity strokeWidth={1.75} />, label: '/runs', hint: 'Show run history', run: () => setTab('runs') }
  ];
  const allRuns = detail.data?.runs ?? [];

  return (
    <>
      <SessionHeader id={sessionId} title={session?.title ?? 'Untitled session'} lastRun={allRuns[allRuns.length - 1]}
        meta={<><StreamIndicator state={stream} />{session?.archivedAt ? <Badge>Archived</Badge> : null}<span>created {relativeTime(session?.createdAt)} · {allRuns.length} run{allRuns.length === 1 ? '' : 's'}</span></>}
        tab={tab} onTab={setTab} tabs={[{ value: 'chat', label: 'Conversation' }, { value: 'runs', label: 'Runs', count: allRuns.length }]}
        actions={<>
          <Button variant="ghost" size="icon" title={session?.archivedAt ? 'Unarchive' : 'Archive'} onClick={() => archive.mutate()}>{session?.archivedAt ? <ArchiveRestore /> : <Archive />}</Button>
          <Button variant="ghost" size="icon" title="Delete session" onClick={() => { if (confirm('Delete this session permanently?')) remove.mutate(); }}><Trash2 /></Button>
          <Button variant="ghost" size="icon" title={`Session ${sessionId}`} onClick={() => { void navigator.clipboard?.writeText(sessionId); }}><MoreHorizontal /></Button>
        </>}
      />
      <PageContent width="chat" scrollRef={scroller}>
        {detail.error ? <ErrorState error={detail.error} /> : null}
          {tab === 'runs' ? (
            allRuns.length ? <TaskRows variant="list" rows={[...allRuns].reverse().map((r, i) => ({
              key: r.runId, status: r.status, step: allRuns.length - i,
              label: <span className="font-mono text-[12.5px]">{shortId(r.runId, 14)}</span>,
              amount: r.completedAt ? formatElapsed(new Date(r.completedAt).getTime() - new Date(r.startedAt).getTime()) : r.status === 'active' ? <LoadingState label="Running" since={r.startedAt} /> : '—',
              details: [{ label: 'Started', meta: formatTime(r.startedAt) }, { label: 'Completed', meta: formatTime(r.completedAt) }, { label: 'Attempt', meta: r.attempt }, ...(r.error ? [{ label: r.error.code, meta: r.error.message }] : [])]
            }))} /> : <Quiet>No runs yet.</Quiet>
          ) : (
            <>
              {!loaded ? <ConversationSkeleton /> : groups.length === 0 ? (
                <Quiet>No activity yet. Write the first message below — each one starts a run you can follow live.</Quiet>
              ) : null}
              <div className="flex flex-col gap-8">
                {groups.map((group) => <RunBlock key={group.runId} group={group} run={runs.get(group.runId)} onRetry={() => retry.mutate(group.runId)} retrying={retry.isPending} onFollowUp={(t) => setDraft(t)} />)}
              </div>
            </>
          )}
      </PageContent>
      <PageColumn width="chat" className="pb-5 pt-1">
        <div>
          <PromptBar value={draft} onChange={setDraft} onSubmit={submit} models={models} model={connectionId} onModel={setConnectionId} sources={sources} commands={commands} busy={send.isPending}
            placeholder={isMock() ? 'Mock mode is read-only — sending is disabled' : 'Ask the run agent — @ to reference a task, / for commands'}
            status={send.error ? <span className="w-[220px] truncate text-[12px] text-red">{send.error.message}</span> : busy ? <LoadingState label="Running" className="mr-1 scale-90" /> : null} />
        </div>
      </PageColumn>
    </>
  );
}

const toolIcon = (name: string) => (/read|fetch|snapshot|get|search/i.test(name) ? 'read' : /write|edit|create|save/i.test(name) ? 'write' : 'run');

function RunBlock({ group, run, onRetry, retrying, onFollowUp }: { group: RunGroup; run: ChatRun | undefined; onRetry: () => void; retrying: boolean; onFollowUp: (t: string) => void }) {
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
    const open = tools.find((t) => t.name === p.toolName && !t.done);
    if (p.status === 'completed' && open) { open.done = true; open.artifact = p.artifact?.name; }
    else tools.push({ key: String(e.sequence), name: p.toolName, done: p.status === 'completed', artifact: p.artifact?.name });
  }
  const artifacts = group.events.flatMap((e) => (e.payload.kind === 'artifact' ? [e.payload.artifact] : []));
  const taskEvents = group.events.flatMap((e) => (e.payload.kind === 'task' ? [{ seq: e.sequence, ...e.payload }] : []));
  const errors = group.events.flatMap((e) => (e.payload.kind === 'error' ? [{ seq: e.sequence, error: e.payload.error }] : []));
  const trace: TraceRow[] = [
    { key: 'start', primary: 'Run started', secondary: `attempt ${group.attempt ?? run?.attempt ?? 1}`, state: 'done' },
    ...tools.map((t) => ({ key: `t${t.key}`, primary: t.done ? `Called ${t.name}` : `Calling ${t.name}`, secondary: t.artifact, mono: true, state: (t.done || !working ? 'done' : 'active') as TraceRow['state'] })),
    ...taskEvents.map((t) => ({ key: `k${t.seq}`, primary: `Task ${t.status.replace(/_/g, ' ')}`, secondary: t.title, state: 'done' as const })),
    ...(working ? [{ key: 'gen', primary: group.assistantText ? 'Writing the answer' : 'Waiting for the model', state: 'active' as const }]
      : [{ key: 'end', primary: status === 'failed' ? 'Run failed' : 'Run completed', secondary: took, state: (status === 'failed' ? 'failed' : 'done') as TraceRow['state'] }])
  ];
  return (
    <section className="flex flex-col gap-3" style={{ animation: 'fade-up 360ms cubic-bezier(0.23,1,0.32,1) both' }}>
      {group.userText.map((text, i) => (
        <div key={i} className="flex justify-end">
          <UserBubble>{text}</UserBubble>
        </div>
      ))}
      <ThinkingTrace working={working} activeLabel="Thinking" doneLabel={status === 'failed' ? `Failed after ${took ?? '—'}` : `Worked for ${took ?? '—'}`} rows={trace} defaultOpen={working} />
      {tools.length || artifacts.length ? (
        <ToolChips header={`${tools.length} tool call${tools.length === 1 ? '' : 's'}${artifacts.length ? `, ${artifacts.length} artifact${artifacts.length === 1 ? '' : 's'}` : ''}`}
          steps={tools.map((t) => ({ key: t.key, icon: toolIcon(t.name), label: t.done ? 'Called' : 'Calling', chip: t.name, mono: true, active: !t.done && working, ...(t.artifact ? { detail: [{ text: `→ ${t.artifact}` }] } : {}) }))}
          files={artifacts.map((a) => ({ name: a.name, meta: `${Math.max(1, Math.round(a.sizeBytes / 1024))} KB` }))} />
      ) : null}
      {taskEvents.length ? (
        <TaskRows rows={taskEvents.map((t) => ({ key: String(t.seq), label: t.title, status: t.status, amount: t.promotionMode, ...(t.taskId ? { onOpen: () => { window.location.assign(`/tasks/${t.taskId}`); } } : {}), details: [{ label: 'Task', meta: t.taskId ?? '—' }, ...(t.reason ? [{ label: 'Reason', meta: t.reason }] : [])] }))} />
      ) : null}
      {group.assistantText ? <StreamingText text={group.assistantText} streaming={working} followUps={working ? [] : ['Summarize that in 3 bullets', 'What should I do next?']} onFollowUp={onFollowUp} />
        : working ? <LoadingState label="Generating" since={started} /> : null}
      {errors.map(({ seq, error }) => (
        <div key={seq} className="flex items-start gap-2.5 rounded-card bg-red-tint px-3 py-2.5 text-[13px]">
          <span className="mt-0.5 grid size-4 shrink-0 place-items-center rounded-full bg-red text-white"><svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round"><path d="M12 6v8M12 18.5v.5" /></svg></span>
          <div className="min-w-0 flex-1"><span className="font-medium text-red">{error.code}</span> <span className="text-ink-2">{error.message}</span></div>
          {status === 'failed' ? <Button size="sm" variant="secondary" onClick={onRetry} disabled={retrying}><RotateCw />Retry</Button> : null}
        </div>
      ))}
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
  const map = { live: ['bg-green', 'Live'], connecting: ['bg-amber', 'Connecting'], reconnecting: ['bg-amber', 'Reconnecting'], closed: ['bg-red', 'Offline'] } as const;
  const [color, label] = map[state];
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted">
      <span className="relative flex size-1.5">
        {state === 'live' ? <span className={cn('absolute inline-flex size-full animate-ping rounded-full opacity-60', color)} /> : null}
        <span className={cn('relative inline-flex size-1.5 rounded-full', color)} />
      </span>
      {label}
    </span>
  );
}
