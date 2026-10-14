import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, ArchiveRestore, ArrowUp, MessageSquare, MessagesSquare, Plus, RotateCw, Search, Sparkles, Trash2, Wrench } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { PageHeader } from '@/components/layout/app-shell';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/input';
import { Empty, ErrorState, Kbd, Mono, Spinner } from '@/components/ui/misc';
import { StatusIcon } from '@/components/ui/status';
import { api } from '@/lib/api';
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
    onSuccess: (session) => { void queryClient.invalidateQueries({ queryKey: ['chat', 'sessions'] }); navigate(`/chat/${session.sessionId}`); }
  });

  useEffect(() => {
    if (search.get('new') === '1' && !create.isPending) { setSearch({}, { replace: true }); create.mutate(); }
  }, [search, setSearch, create]);

  return (
    <div className="flex min-h-0 flex-1">
      <section className="flex w-[300px] shrink-0 flex-col border-r border-line">
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
                  className={cn('group flex flex-col gap-0.5 rounded-md px-2.5 py-2 transition-colors duration-100 hover:bg-hover', active && 'bg-active hover:bg-active')}
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
        <div className="mx-auto flex max-w-[760px] flex-col gap-8 px-8 pb-10 pt-8">
          {!loaded ? <ConversationSkeleton /> : groups.length === 0 ? (
            <Empty icon={Sparkles} title="Start the conversation" hint="Messages are durable; each one starts a run you can follow live here." />
          ) : null}
          {groups.map((group) => {
            const run = runs.get(group.runId);
            const status = group.status ?? run?.status;
            const tools = group.events.filter((e) => e.payload.kind === 'tool' || e.payload.kind === 'task' || e.payload.kind === 'artifact');
            const errors = group.events.flatMap((e) => (e.payload.kind === 'error' ? [{ seq: e.sequence, error: e.payload.error }] : []));
            return (
              <article key={group.runId} className="animate-fade-in flex flex-col gap-4">
                {group.userText.map((text, i) => (
                  <div key={i} className="flex justify-end">
                    <div className="max-w-[78%] whitespace-pre-wrap rounded-[14px] rounded-br-[4px] border border-line bg-raised px-3.5 py-2 text-[13.5px] leading-[22px] text-fg shadow-card">{text}</div>
                  </div>
                ))}
                <div className="flex gap-3">
                  <div className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-accent-soft text-accent ring-1 ring-accent/25"><Sparkles className="size-3.5" strokeWidth={1.75} /></div>
                  <div className="min-w-0 flex-1">
                    <div className="mb-1.5 flex h-6 items-center gap-2 text-xs">
                      <span className="font-medium text-fg">Agent</span>
                      <span className="text-faint">{formatTime(group.at)}</span>
                      <span className="flex items-center gap-1 text-muted"><StatusIcon status={status} className="size-3" />{status ?? 'pending'}</span>
                      {group.attempt && group.attempt > 1 ? <span className="text-faint">· attempt {group.attempt}</span> : null}
                      {status === 'failed' ? (
                        <Button size="sm" variant="ghost" className="ml-auto" onClick={() => retry.mutate(group.runId)} disabled={retry.isPending}><RotateCw />Retry</Button>
                      ) : null}
                    </div>
                    {tools.length ? (
                      <div className="mb-2 flex flex-col gap-1">
                        {tools.map((e) => (
                          <div key={e.sequence} className="flex h-7 items-center gap-2 rounded-md border border-line bg-sunken px-2 text-xs text-muted">
                            <Wrench className="size-3 text-faint" />
                            {e.payload.kind === 'tool' ? <><span className="font-mono text-fg-2">{e.payload.toolName}</span><span>{e.payload.status}</span></>
                              : e.payload.kind === 'task' ? <><span className="text-fg-2">{e.payload.title}</span><StatusIcon status={e.payload.status} className="size-3" /><span>{e.payload.status}</span>{e.payload.taskId ? <Link className="ml-auto text-accent hover:underline" to={`/tasks/${e.payload.taskId}`}>Open task</Link> : null}</>
                              : e.payload.kind === 'artifact' ? <span className="text-fg-2">{e.payload.artifact.name}</span> : null}
                          </div>
                        ))}
                      </div>
                    ) : null}
                    {group.assistantText ? <div className="whitespace-pre-wrap text-[13.5px] leading-[22px] text-fg">{group.assistantText}</div>
                      : status === 'active' ? <div className="flex items-center gap-2 text-xs text-muted"><Spinner />Thinking…</div> : null}
                    {errors.map(({ seq, error }) => (
                      <div key={seq} className="mt-1 rounded-lg border border-red/20 bg-red/[0.06] px-3 py-2.5">
                        <div className="flex items-center gap-2 text-xs font-medium text-red"><StatusIcon kind="failed" className="size-3" />{error.code}</div>
                        <div className="mt-1 break-words text-[12.5px] leading-5 text-fg-2">{error.message}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </div>
      <div className="px-6 pb-5">
        <div className="mx-auto max-w-[760px] rounded-xl border border-line-strong bg-raised shadow-[0_4px_16px_-6px_rgb(0_0_0/0.25)] transition-[border-color,box-shadow] focus-within:border-accent/50 focus-within:shadow-[0_0_0_3px_var(--accent-soft),0_4px_16px_-6px_rgb(0_0_0/0.25)]">
          <textarea
            ref={textarea}
            rows={1}
            className="block max-h-[220px] min-h-[52px] w-full resize-none bg-transparent px-4 pb-1 pt-3.5 text-[13.5px] leading-[22px] text-fg placeholder:text-faint focus:outline-none"
            placeholder="Message the agent…"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); } }}
          />
          <div className="flex items-center gap-2 px-2.5 pb-2.5 pt-1">
            <Select className="h-7 w-auto max-w-[220px] border-transparent bg-transparent text-xs text-muted hover:border-line-strong hover:bg-hover" value={connectionId} onChange={(e) => setConnectionId(e.target.value)} title="Provider connection">
              <option value="">Server default</option>
              {providers.data?.providers.map((p) => <option key={p.id} value={p.id} disabled={!p.available}>{p.name}{p.available ? '' : ' (unavailable)'}</option>)}
            </Select>
            {send.error ? <span className="truncate text-xs text-red">{send.error.message}</span> : busy ? <span className="flex items-center gap-1.5 text-xs text-muted"><Spinner className="size-3" />Run in progress</span> : null}
            <span className="ml-auto hidden items-center gap-1 text-[11px] text-faint sm:flex"><Kbd>↵</Kbd> send <Kbd className="ml-1">⇧↵</Kbd> newline</span>
            <Button size="icon" className="rounded-lg" onClick={submit} disabled={!draft.trim() || send.isPending} title="Send">{send.isPending ? <Spinner className="text-accent-fg" /> : <ArrowUp strokeWidth={2.25} />}</Button>
          </div>
        </div>
      </div>
    </>
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

