import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, ArchiveRestore, ArrowUp, Bot, Plus, RotateCw, Trash2, User, Wrench } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { PageHeader } from '@/components/layout/app-shell';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input, Select, Textarea } from '@/components/ui/input';
import { Empty, ErrorState, Kbd, Loading, Mono, Spinner } from '@/components/ui/misc';
import { api } from '@/lib/api';
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
      <section className="flex w-[300px] shrink-0 flex-col border-r">
        <PageHeader title="Chat" actions={<Button size="sm" onClick={() => create.mutate()} disabled={create.isPending}><Plus />New</Button>} />
        <div className="flex gap-1.5 border-b p-2">
          <Input placeholder="Filter sessions…" value={q} onChange={(e) => setQ(e.target.value)} />
          <Button variant={archived ? 'secondary' : 'ghost'} size="icon" title="Show archived" onClick={() => setArchived((v) => !v)}><Archive /></Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {sessions.isLoading ? <Loading /> : sessions.error ? <ErrorState error={sessions.error} /> : sessions.data?.items.length === 0 ? <Empty title="No sessions" hint="Create one to start chatting." /> : (
            sessions.data?.items.map((s) => (
              <button key={s.sessionId} onClick={() => navigate(`/chat/${s.sessionId}`)}
                className={cn('flex w-full flex-col gap-0.5 border-b border-border/60 px-3 py-2 text-left hover:bg-hover', s.sessionId === sessionId && 'bg-hover')}>
                <div className="flex items-center gap-2">
                  <span className="truncate text-[13px] font-medium">{s.title ?? 'Untitled'}</span>
                  <span className="ml-auto shrink-0 text-[11px] text-muted">{relativeTime(s.lastMessageAt ?? s.updatedAt)}</span>
                </div>
                <span className="truncate text-xs text-muted">{s.preview ?? shortId(s.sessionId)}</span>
              </button>
            ))
          )}
        </div>
      </section>
      <section className="flex min-w-0 flex-1 flex-col">
        {sessionId ? <SessionView key={sessionId} sessionId={sessionId} /> : <Empty title="Select a session" hint="Pick a session on the left, or press ⌘K → New chat session." />}
      </section>
    </div>
  );
}

interface RunGroup { runId: string; userText: string[]; assistantText: string; events: TimelineEvent[]; status?: string; attempt?: number }

function groupTimeline(events: TimelineEvent[]): RunGroup[] {
  const groups = new Map<string, RunGroup>();
  for (const event of events) {
    let group = groups.get(event.runId);
    if (!group) { group = { runId: event.runId, userText: [], assistantText: '', events: [] }; groups.set(event.runId, group); }
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
  const [stream, setStream] = useState<StreamState>('connecting');
  const [draft, setDraft] = useState('');
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => { if (!connectionId && providers.data?.providerConnectionId) setConnectionId(providers.data.providerConnectionId); }, [providers.data, connectionId]);

  useEffect(() => {
    let stop: (() => void) | undefined;
    let cancelled = false;
    void api.chat.events(sessionId, 0).then(({ events: initial }) => {
      if (cancelled) return;
      setEvents(initial);
      const last = initial.at(-1)?.sequence ?? 0;
      stop = streamTimeline((after) => api.chat.timelineUrl(sessionId, after), last, (event) => {
        setEvents((prev) => (prev.some((e) => e.sequence === event.sequence) ? prev : [...prev, event]));
        if (event.payload.kind === 'run') void queryClient.invalidateQueries({ queryKey: ['chat', 'session', sessionId] });
      }, setStream);
    }).catch(() => setStream('closed'));
    return () => { cancelled = true; stop?.(); };
  }, [sessionId, queryClient]);

  useEffect(() => { scroller.current?.scrollTo({ top: scroller.current.scrollHeight }); }, [events.length]);

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
        meta={<><Mono className="text-muted">{shortId(sessionId, 12)}</Mono><StreamBadge state={stream} />{session?.archivedAt ? <Badge>archived</Badge> : null}</>}
        actions={<>
          <Button variant="ghost" size="icon" title={session?.archivedAt ? 'Unarchive' : 'Archive'} onClick={() => archive.mutate()}>{session?.archivedAt ? <ArchiveRestore /> : <Archive />}</Button>
          <Button variant="ghost" size="icon" title="Delete session" onClick={() => { if (confirm('Delete this session permanently?')) remove.mutate(); }}><Trash2 /></Button>
        </>}
      />
      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto">
        {detail.error ? <ErrorState error={detail.error} /> : null}
        <div className="mx-auto flex max-w-3xl flex-col gap-5 px-6 py-6">
          {detail.isLoading ? <Loading /> : groups.length === 0 ? <Empty title="No messages yet" hint="Send the first message below." /> : null}
          {groups.map((group) => {
            const run = runs.get(group.runId);
            const status = group.status ?? run?.status;
            return (
              <div key={group.runId} className="flex flex-col gap-3">
                {group.userText.map((text, i) => (
                  <div key={i} className="flex gap-3">
                    <div className="grid size-6 shrink-0 place-items-center rounded-full bg-subtle border"><User className="size-3.5 text-muted" /></div>
                    <div className="whitespace-pre-wrap pt-0.5 leading-relaxed">{text}</div>
                  </div>
                ))}
                <div className="flex gap-3">
                  <div className="grid size-6 shrink-0 place-items-center rounded-full bg-accent/15"><Bot className="size-3.5 text-accent" /></div>
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 flex items-center gap-2 text-[11px] text-muted">
                      <StatusBadge status={status} />
                      <Mono>{shortId(group.runId)}</Mono>
                      {group.attempt ? <span>attempt {group.attempt}</span> : null}
                      {status === 'failed' ? <Button size="sm" variant="ghost" onClick={() => retry.mutate(group.runId)} disabled={retry.isPending}><RotateCw />Retry</Button> : null}
                    </div>
                    {group.events.filter((e) => e.payload.kind === 'tool' || e.payload.kind === 'task' || e.payload.kind === 'artifact').map((e) => (
                      <div key={e.sequence} className="mb-1 flex items-center gap-2 rounded-md border bg-subtle px-2 py-1 text-xs text-muted">
                        <Wrench className="size-3" />
                        {e.payload.kind === 'tool' ? <>{e.payload.toolName} · {e.payload.status}</> : e.payload.kind === 'task' ? <>task “{e.payload.title}” · {e.payload.status}{e.payload.taskId ? <a className="ml-1 text-accent" href={`/tasks/${e.payload.taskId}`}>open</a> : null}</> : e.payload.kind === 'artifact' ? <>artifact {e.payload.artifact.name}</> : null}
                      </div>
                    ))}
                    {group.assistantText ? <div className="whitespace-pre-wrap leading-relaxed">{group.assistantText}</div> : status === 'active' ? <Spinner /> : null}
                    {group.events.map((e) => e.payload.kind === 'error' ? (
                      <div key={e.sequence} className="mt-1 rounded-md border border-danger/30 bg-danger/5 px-2 py-1.5 text-xs text-danger">{e.payload.error.code}: {e.payload.error.message}</div>
                    ) : null)}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <div className="border-t p-3">
        <div className="mx-auto max-w-3xl rounded-lg border bg-panel focus-within:border-accent/60">
          <Textarea rows={3} className="border-0 bg-transparent focus:ring-0" placeholder="Message… (Enter to send, Shift+Enter for newline)" value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); } }} />
          <div className="flex items-center gap-2 border-t px-2 py-1.5">
            <Select className="h-6 w-56 text-xs" value={connectionId} onChange={(e) => setConnectionId(e.target.value)} title="Provider connection">
              <option value="">(server default)</option>
              {providers.data?.providers.map((p) => <option key={p.id} value={p.id} disabled={!p.available}>{p.name}{p.available ? '' : ' (unavailable)'}</option>)}
            </Select>
            {send.error ? <span className="truncate text-xs text-danger">{send.error.message}</span> : busy ? <span className="text-xs text-muted">Run in progress…</span> : null}
            <span className="ml-auto flex items-center gap-1 text-[11px] text-muted"><Kbd>↵</Kbd></span>
            <Button size="icon" onClick={submit} disabled={!draft.trim() || send.isPending}>{send.isPending ? <Spinner className="text-accent-fg" /> : <ArrowUp />}</Button>
          </div>
        </div>
      </div>
    </>
  );
}

function StreamBadge({ state }: { state: StreamState }) {
  const tone = state === 'live' ? 'success' : state === 'closed' ? 'danger' : 'warning';
  return <Badge tone={tone}>SSE {state}</Badge>;
}
