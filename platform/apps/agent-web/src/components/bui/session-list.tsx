import type React from 'react';
import { useQueries } from '@tanstack/react-query';
import { MessageSquare } from 'lucide-react';
import { Link } from 'react-router';
import { api } from '@/lib/api';
import type { ChatRun, SessionListItem } from '@/lib/types';
import { cn, relativeTime } from '@/lib/utils';

type RunTone = 'active' | 'succeeded' | 'failed' | 'paused' | 'none';
const toneColor: Record<RunTone, string> = { active: 'var(--accent)', succeeded: 'var(--green)', failed: 'var(--red)', paused: 'var(--orange)', none: 'var(--ink-3)' };
const toneLabel: Record<RunTone, string> = { active: 'Running', succeeded: 'Completed', failed: 'Failed', paused: 'Paused', none: 'No runs' };

/** Stable hue (0-359) from an id. */
export function hueOf(id: string) { let h = 0; for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0; return h % 360; }

function dayBucket(iso: string | undefined): 'Today' | 'Yesterday' | 'Earlier' {
  if (!iso) return 'Earlier';
  const d = new Date(iso); const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const t = d.getTime();
  return t >= start ? 'Today' : t >= start - 86_400_000 ? 'Yesterday' : 'Earlier';
}

function Avatar({ id, title, tone }: { id: string; title: string; tone: RunTone }) {
  const h = hueOf(id);
  return (
    <span className="relative grid size-8 shrink-0 place-items-center rounded-[9px] text-[12.5px] font-semibold"
      style={{ background: `oklch(0.68 0.13 ${h} / 0.16)`, color: `oklch(0.62 0.15 ${h})`, boxShadow: `inset 0 0 0 1px oklch(0.68 0.13 ${h} / 0.22)` }}>
      {title.trim()[0]?.toUpperCase() ?? <MessageSquare className="size-3.5" />}
      <span title={toneLabel[tone]} className={cn('absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full ring-2 ring-[var(--panel)]', tone === 'active' && 'animate-pulse')} style={{ background: toneColor[tone] }} />
    </span>
  );
}

/** Last N run outcomes as colored ticks (oldest → newest). */
function RunTicks({ runs }: { runs: ChatRun[] }) {
  const last = runs.slice(-5);
  return (
    <span className="flex items-end gap-[2px]" aria-label="Recent runs">
      {Array.from({ length: 5 }, (_, i) => {
        const r = last[i - (5 - last.length)];
        return <span key={i} className="w-[3px] rounded-full" style={{ height: r ? 10 : 4, background: r ? toneColor[r.status as RunTone] : 'var(--line-strong)' }} />;
      })}
    </span>
  );
}

export function SessionList({ items, activeId }: { items: SessionListItem[]; activeId?: string | undefined }) {
  const visible = items.slice(0, 30);
  const details = useQueries({ queries: visible.map((s) => ({ queryKey: ['chat', 'session', s.sessionId], queryFn: () => api.chat.getSession(s.sessionId), staleTime: 30_000 })) });
  const groups: Array<{ label: string; rows: Array<{ s: SessionListItem; runs: ChatRun[]; messages: number }> }> = [];
  visible.forEach((s, i) => {
    const d = details[i]?.data;
    const label = dayBucket(s.lastMessageAt ?? s.updatedAt);
    let g = groups.find((x) => x.label === label); if (!g) { g = { label, rows: [] }; groups.push(g); }
    g.rows.push({ s, runs: d?.runs ?? [], messages: d?.messages.length ?? 0 });
  });
  return (
    <div className="flex flex-col pb-2">
      {groups.map((g) => (
        <div key={g.label}>
          <div className="t-meta sticky top-0 z-10 flex items-center gap-2 bg-panel px-2.5 pb-1 pt-3 font-medium">{g.label}<span className="tabular-nums font-normal">{g.rows.length}</span></div>
          <div className="flex flex-col gap-0.5">
            {g.rows.map(({ s, runs, messages }) => {
              const active = s.sessionId === activeId;
              const last = runs[runs.length - 1];
              const tone: RunTone = last ? (last.status as RunTone) : 'none';
              const title = s.title ?? 'Untitled session';
              return (
                <Link key={s.sessionId} to={`/chat/${s.sessionId}`}
                  className={cn('group flex items-start gap-2.5 rounded-[10px] px-2 py-2 transition-colors duration-75', active ? 'bg-surface shadow-card' : 'hover:bg-hover')}>
                  <Avatar id={s.sessionId} title={title} tone={tone} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className={cn('truncate text-[13px] font-medium tracking-[-0.01em]', active ? 'text-ink' : 'text-fg-2')}>{title}</span>
                      <span className="ml-auto shrink-0 text-[11px] tabular-nums text-ink-3">{relativeTime(s.lastMessageAt ?? s.updatedAt).replace(' ago', '')}</span>
                    </span>
                    <span className="mt-0.5 block truncate text-[12px] text-ink-2">{s.lastMessageRole === 'assistant' ? 'Agent: ' : s.lastMessageRole === 'user' ? 'You: ' : ''}{s.preview ?? '—'}</span>
                    <span className="mt-1.5 flex items-center gap-2 text-[11px] text-ink-3">
                      <span className="inline-flex items-center gap-1" style={{ color: toneColor[tone] }}><span className={cn('size-1.5 rounded-full', tone === 'active' && 'animate-pulse')} style={{ background: toneColor[tone] }} />{toneLabel[tone]}</span>
                      <span className="rounded-[5px] bg-inset px-1 tabular-nums shadow-[inset_0_0_0_1px_var(--line)]">{runs.length} run{runs.length === 1 ? '' : 's'}</span>
                      <span className="tabular-nums">{messages} msg</span>
                      <span className="ml-auto"><RunTicks runs={runs} /></span>
                    </span>
                  </span>
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

export function ArchiveToggle({ archived, onChange }: { archived: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex rounded-control bg-inset p-0.5 shadow-[inset_0_0_0_1px_var(--line)]">
      {[false, true].map((v) => (
        <button key={String(v)} type="button" onClick={() => onChange(v)}
          className={cn('h-6 rounded-[6px] px-2 text-[12px] font-medium transition-colors', archived === v ? 'bg-surface text-ink shadow-btn' : 'text-ink-3 hover:text-ink')}>
          {v ? 'Archived' : 'Active'}
        </button>
      ))}
    </div>
  );
}

/** Single chat page header: identity row + quiet underline tabs, page bg, one bottom hairline. */
export function SessionHeader<T extends string>({ id, title, lastRun, meta, actions, tabs, tab, onTab }: {
  id: string; title: string; lastRun?: ChatRun | undefined; meta?: React.ReactNode; actions?: React.ReactNode;
  tabs: Array<{ value: T; label: string; count?: number | undefined }>; tab: T; onTab: (v: T) => void;
}) {
  const tone: RunTone = lastRun ? (lastRun.status as RunTone) : 'none';
  return (
    <header className="gutter-x shrink-0 border-b border-line bg-panel pt-2.5">
      <div className="flex h-9 items-center gap-2.5">
        <Avatar id={id} title={title} tone={tone} />
        <h1 title="Session title" className="-mx-1 min-w-0 cursor-text truncate rounded-[6px] px-1 text-[15px] font-semibold tracking-[-0.015em] text-ink hover:bg-hover">{title}</h1>
        <span title={toneLabel[tone]} className={cn('size-2 shrink-0 rounded-full', tone === 'active' && 'animate-pulse')} style={{ background: toneColor[tone] }} />
        {meta ? <span className="t-meta flex min-w-0 items-center gap-1.5 truncate">{meta}</span> : null}
        <div className="ml-auto flex shrink-0 items-center gap-0.5">{actions}</div>
      </div>
      <nav className="mt-1.5 flex gap-5" role="tablist">
        {tabs.map((t) => (
          <button key={t.value} role="tab" aria-selected={tab === t.value} type="button" onClick={() => onTab(t.value)}
            className={cn('-mb-px flex items-center gap-1.5 border-b-2 pb-2 pt-1 text-[13px] font-medium transition-colors', tab === t.value ? 'border-accent text-ink' : 'border-transparent text-ink-3 hover:text-ink-2')}>
            {t.label}{t.count !== undefined ? <span className="text-[11.5px] font-normal tabular-nums text-ink-3">{t.count}</span> : null}
          </button>
        ))}
      </nav>
    </header>
  );
}
