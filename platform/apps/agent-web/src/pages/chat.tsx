import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, ArchiveRestore, ArrowUp, MessageSquare, MessagesSquare, Plus, RotateCw, Search, Sparkles, Trash2, Wrench } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { Crumb, PageHeader } from '@/components/layout/app-shell';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/input';
import { Empty, ErrorState, Kbd, Mono, Spinner } from '@/components/ui/misc';
import { StatusIcon } from '@/components/ui/status';
import { api } from '@/lib/api';
import { isMock } from '@/lib/mock';
import { streamTimeline, type StreamState } from '@/lib/sse';
import type { ChatRun, TimelineEvent } from '@/lib/types';
import { cn, relativeTime, shortId } from '@/lib/utils';

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
    onSuccess: (session) => { void queryClient.invalidateQueries({ queryKey: ['chat', 'sessions'] }); navigate(`/chat/${session.sessionId}`); }
  });

  useEffect(() => {
    if (search.get('new') === '1' && !create.isPending) { setSearch({}, { replace: true }); create.mutate(); }
  }, [search, setSearch, create]);

  return (
    <div className="flex min-h-0 flex-1">
      <section className="flex w-[280px] shrink-0 flex-col border-r border-line">
        <PageHeader title="Chat" actions={<Button variant="ghost" size="icon" title="New session" onClick={() => create.mutate()} disabled={create.isPending}><Plus /></Button>} />
        <div className="flex items-center gap-1 border-b border-line px-2 py-1.5">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-faint" strokeWidth={1.75} />
            <input
              placeholder="Filter sessions"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="h-7 w-full rounded-md bg-transparent pl-7 pr-2 text-[12.5px] placeholder:text-faint hover:bg-hover focus:bg-hover focus:outline-none"
            />
          </div>
          <Button variant="ghost" size="icon-sm" title={archived ? 'Showing archived' : 'Show archived'} className={cn(archived && 'bg-active text-fg')} onClick={() => setArchived((v) => !v)}><Archive /></Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
          {sessions.isLoading ? <SessionSkeleton /> : sessions.error ? <ErrorState error={sessions.error} /> : sessions.data?.items.length === 0 ? (
            <Empty icon={MessagesSquare} title={archived ? 'No archived sessions' : 'No sessions yet'} hint="Start a conversation with the run agent.">
              <Button size="sm" onClick={() => create.mutate()}><Plus />New session</Button>
            </Empty>
          ) : (
            sessions.data?.items.map((s) => {
              const active = s.sessionId === sessionId;
              return (
                <Link
                  key={s.sessionId}
                  to={`/chat/${s.sessionId}`}
                  className={cn('group flex flex-col gap-0.5 rounded-md px-2.5 py-[7px] transition-colors duration-75 hover:bg-hover', active && 'bg-active hover:bg-active')}
                >
                  <div className="flex items-center gap-2">
                    <span className={cn('truncate text-[13px] font-medium tracking-[-0.01em]', active ? 'text-fg' : 'text-fg-2')}>{s.title ?? 'Untitled session'}</span>
                    <span className="tabular ml-auto shrink-0 text-[11px] text-faint">{relativeTime(s.lastMessageAt ?? s.updatedAt).replace(' ago', '')}</span>
                  </div>
                  <span className="truncate text-xs text-muted">
                    {s.lastMessageRole === 'assistant' ? 'Agent: ' : s.lastMessageRole === 'user' ? 'You: ' : ''}{s.preview ?? shortId(s.sessionId)}
                  </span>
                </Link>
              );
            })
          )}
        </div>
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
  const [draft, setDraft] = useState('');
  const scroller = useRef<HTMLDivElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);

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
  useEffect(() => {
    const el = textarea.current;
    if (el) { el.style.height = 'auto'; el.style.height = `${Math.min(el.scrollHeight, 220)}px`; }
  }, [draft]);

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
  const busy = groups.some((g) => g.status === 'active');
  const session = detail.data?.session;
  const submit = () => { const text = draft.trim(); if (text && !send.isPending) send.mutate(text); };

  return (
    <>
      <PageHeader
        breadcrumb={<Crumb to="/chat">Chat</Crumb>}
        title={session?.title ?? 'Untitled session'}
        meta={<><StreamIndicator state={stream} />{session?.archivedAt ? <Badge>Archived</Badge> : null}</>}
        actions={<>
          <Mono className="mr-1 text-faint">{shortId(sessionId, 12)}</Mono>
          <Button variant="ghost" size="icon" title={session?.archivedAt ? 'Unarchive' : 'Archive'} onClick={() => archive.mutate()}>{session?.archivedAt ? <ArchiveRestore /> : <Archive />}</Button>
          <Button variant="ghost" size="icon" title="Delete session" onClick={() => { if (confirm('Delete this session permanently?')) remove.mutate(); }}><Trash2 /></Button>
        </>}
      />
      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto">
        {detail.error ? <ErrorState error={detail.error} /> : null}
        <div className="mx-auto max-w-[760px] px-6 pb-6 pt-10">
          <h2 className="text-[20px] font-semibold tracking-[-0.02em] text-fg">{session?.title ?? 'Untitled session'}</h2>
          <p className="mt-1 text-[12.5px] text-muted">{groups.length} run{groups.length === 1 ? '' : 's'} · created {relativeTime(session?.createdAt)}</p>
          <div className="mb-3 mt-7 flex items-center gap-2 border-b border-line pb-2 text-[13px] font-medium text-fg">Activity</div>
          {!loaded ? <ConversationSkeleton /> : groups.length === 0 ? (
            <p className="py-6 text-[12.5px] text-muted">No activity yet. Write the first message below — each one starts a run you can follow live.</p>
          ) : null}
          <ol className="relative">
            {groups.length ? <span className="absolute bottom-6 left-[11.5px] top-6 w-px bg-line-strong" /> : null}
            {groups.map((group) => {
              const run = runs.get(group.runId);
              const status = group.status ?? run?.status;
              const tools = group.events.filter((e) => e.payload.kind === 'tool' || e.payload.kind === 'task' || e.payload.kind === 'artifact');
              const errors = group.events.flatMap((e) => (e.payload.kind === 'error' ? [{ seq: e.sequence, error: e.payload.error }] : []));
              return (
                <li key={group.runId} className="animate-fade-in">
                  {group.userText.map((text, i) => (
                    <FeedItem key={i} avatar={<span className="grid size-6 place-items-center rounded-full bg-[#4f5bc4] text-[10.5px] font-semibold text-white">Y</span>} who="You" at={group.at}>
                      <div className="whitespace-pre-wrap text-[13.5px] leading-[21px] text-fg-2">{text}</div>
                    </FeedItem>
                  ))}
                  <FeedItem
                    avatar={<span className="grid size-6 place-items-center rounded-full border border-line-strong bg-panel text-muted"><Sparkles className="size-3" strokeWidth={1.75} /></span>}
                    who="Agent"
                    at={run?.completedAt ?? group.at}
                    meta={<span className="inline-flex items-center gap-1"><StatusIcon status={status} className="size-3" />{status ?? 'pending'}{group.attempt && group.attempt > 1 ? ` · attempt ${group.attempt}` : ''} · <Mono className="text-faint">{shortId(group.runId)}</Mono></span>}
                    action={status === 'failed' ? <button type="button" onClick={() => retry.mutate(group.runId)} disabled={retry.isPending} className="inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-[12px] text-muted hover:bg-hover hover:text-fg"><RotateCw className="size-3" />Retry</button> : null}
                  >
                    {tools.map((e) => (
                      <div key={e.sequence} className="flex items-center gap-2 py-0.5 text-[12.5px] text-muted">
                        <Wrench className="size-3 text-faint" />
                        {e.payload.kind === 'tool' ? <><span className="font-mono text-fg-2">{e.payload.toolName}</span>{e.payload.status}</>
                          : e.payload.kind === 'task' ? <><span className="text-fg-2">{e.payload.title}</span><StatusIcon status={e.payload.status} className="size-3" />{e.payload.status}{e.payload.taskId ? <Link className="text-accent hover:underline" to={`/tasks/${e.payload.taskId}`}>Open</Link> : null}</>
                          : e.payload.kind === 'artifact' ? <span className="text-fg-2">{e.payload.artifact.name}</span> : null}
                      </div>
                    ))}
                    {group.assistantText ? <div className="whitespace-pre-wrap text-[13.5px] leading-[21px] text-fg-2">{group.assistantText}</div>
                      : status === 'active' ? <div className="flex items-center gap-2 text-[12.5px] text-muted"><Spinner className="size-3" />Thinking…</div> : null}
                    {errors.map(({ seq, error }) => (
                      <div key={seq} className="text-[12.5px] leading-[19px] text-muted">
                        <span className="font-medium text-red">{error.code}</span> <span>{error.message}</span>
                      </div>
                    ))}
                  </FeedItem>
                </li>
              );
            })}
          </ol>
        </div>
      </div>
      <div className="px-6 pb-5">
        <div className="mx-auto max-w-[760px] rounded-lg border border-line-strong bg-sunken transition-colors focus-within:border-faint/70">
          <textarea
            ref={textarea}
            rows={1}
            className="block max-h-[220px] min-h-[44px] w-full resize-none bg-transparent px-3.5 pb-1 pt-3 text-[13.5px] leading-[21px] text-fg placeholder:text-faint focus:outline-none"
            placeholder="Leave a message…"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); } }}
          />
          <div className="flex items-center gap-2 px-2 pb-2">
            <Select className="h-6 w-auto max-w-[200px] border-transparent bg-transparent px-1.5 text-[12px] text-muted hover:bg-hover" value={connectionId} onChange={(e) => setConnectionId(e.target.value)} title="Provider connection">
              <option value="">Server default</option>
              {providers.data?.providers.map((p) => <option key={p.id} value={p.id} disabled={!p.available}>{p.name}{p.available ? '' : ' (unavailable)'}</option>)}
            </Select>
            {send.error ? <span className="truncate text-[12px] text-red">{send.error.message}</span> : busy ? <span className="flex items-center gap-1.5 text-[12px] text-muted"><Spinner className="size-3" />Run in progress</span> : null}
            <Button size="icon-sm" variant={draft.trim() ? 'default' : 'ghost'} className="ml-auto rounded-full" onClick={submit} disabled={!draft.trim() || send.isPending} title="Send (Enter)">{send.isPending ? <Spinner className="size-3" /> : <ArrowUp strokeWidth={2} />}</Button>
          </div>
        </div>
      </div>
    </>
  );
}

function FeedItem({ avatar, who, at, meta, action, children }: { avatar: React.ReactNode; who: string; at?: string | undefined; meta?: React.ReactNode; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="relative flex gap-3 py-2.5">
      <div className="relative z-10 shrink-0 rounded-full bg-panel ring-4 ring-panel">{avatar}</div>
      <div className="min-w-0 flex-1">
        <div className="flex h-6 items-center gap-1.5 text-[12.5px]">
          <span className="font-medium text-fg">{who}</span>
          {meta ? <span className="text-muted">{meta}</span> : null}
          <span className="text-faint">· {relativeTime(at)}</span>
          {action ? <span className="ml-auto">{action}</span> : null}
        </div>
        <div className="mt-0.5 flex flex-col gap-1">{children}</div>
      </div>
    </div>
  );
}

function ConversationSkeleton() {
  return (
    <div className="flex flex-col gap-8">
      {[0, 1].map((i) => (
        <div key={i} className="flex flex-col gap-4">
          <div className="skeleton ml-auto h-9 w-48 rounded-[14px]" />
          <div className="flex gap-3"><div className="skeleton size-6 rounded-full" /><div className="flex flex-1 flex-col gap-2"><div className="skeleton h-2.5 w-32" /><div className="skeleton h-2.5 w-4/5" /><div className="skeleton h-2.5 w-3/5" /></div></div>
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

