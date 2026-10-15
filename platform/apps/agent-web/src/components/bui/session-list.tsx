import type React from 'react';
import { useQueries } from '@tanstack/react-query';
import { MessageSquare } from 'lucide-react';
import { Link } from 'react-router';
import { api } from '@/lib/api';
import { useT } from '@/lib/i18n';
import type { ChatRun, SessionListItem } from '@/lib/types';
import { cn, relativeTimeShort } from '@/lib/utils';

type RunTone = 'active' | 'succeeded' | 'failed' | 'paused' | 'none';
const toneColor: Record<RunTone, string> = { active: 'var(--accent-ink)', succeeded: 'var(--green)', failed: 'var(--red)', paused: 'var(--orange)', none: 'var(--ink-3)' };
/** Status words reuse the shared `status.*` vocabulary; `none` is the only session-list-specific label. */
const toneKey: Record<RunTone, string> = { active: 'status.running', succeeded: 'status.completed', failed: 'status.failed', paused: 'status.paused', none: 'sessionList.noRuns' };

/** Stable hue (0-359) from an id. */
export function hueOf(id: string) { let h = 0; for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0; return h % 360; }

type DayBucket = 'today' | 'yesterday' | 'earlier';
/** Bucket keys (not labels) so the grouping stays locale-independent; the header resolves them via the dictionary. */
function dayBucket(iso: string | undefined): DayBucket {
  if (!iso) return 'earlier';
  const d = new Date(iso); const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const t = d.getTime();
  return t >= start ? 'today' : t >= start - 86_400_000 ? 'yesterday' : 'earlier';
}

function Avatar({ id, title, tone, compact }: { id: string; title: string; tone: RunTone; compact?: boolean }) {
  const t = useT();
  const h = hueOf(id);
  return (
    <span className={cn('relative grid shrink-0 place-items-center font-semibold', compact ? 'size-7 rounded-[8px] text-[12px]' : 'size-8 rounded-[9px] text-[12.5px]')}
      style={{ background: `oklch(0.68 0.13 ${h} / 0.16)`, color: `oklch(0.62 0.15 ${h})`, boxShadow: `inset 0 0 0 1px oklch(0.68 0.13 ${h} / 0.22)` }}>
      {title.trim()[0]?.toUpperCase() ?? <MessageSquare className="size-3.5" />}
      <span title={t(toneKey[tone])} className={cn('absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full ring-2 ring-[var(--panel)]', tone === 'active' && 'animate-pulse')} style={{ background: toneColor[tone] }} />
    </span>
  );
}

/** Last N run outcomes as colored ticks (oldest → newest). */
function RunTicks({ runs }: { runs: ChatRun[] }) {
  const t = useT();
  const last = runs.slice(-5);
  return (
    <span className="flex items-end gap-[2px]" aria-label={t('sessionList.recentRuns')}>
      {Array.from({ length: 5 }, (_, i) => {
        const r = last[i - (5 - last.length)];
        return <span key={i} className="w-[3px] rounded-full" style={{ height: r ? 10 : 4, background: r ? toneColor[r.status as RunTone] : 'var(--line-strong)' }} />;
      })}
    </span>
  );
}

export function SessionList({ items, activeId }: { items: SessionListItem[]; activeId?: string | undefined }) {
  const t = useT();
  const visible = items.slice(0, 30);
  const details = useQueries({ queries: visible.map((s) => ({ queryKey: ['chat', 'session', s.sessionId], queryFn: () => api.chat.getSession(s.sessionId), staleTime: 30_000 })) });
  const groups: Array<{ key: DayBucket; rows: Array<{ s: SessionListItem; runs: ChatRun[]; messages: number }> }> = [];
  visible.forEach((s, i) => {
    const d = details[i]?.data;
    const key = dayBucket(s.lastMessageAt ?? s.updatedAt);
    let g = groups.find((x) => x.key === key); if (!g) { g = { key, rows: [] }; groups.push(g); }
    g.rows.push({ s, runs: d?.runs ?? [], messages: d?.messages.length ?? 0 });
  });
  return (
    <div className="flex flex-col gap-2 pb-4">
      {groups.map((g) => (
        <div key={g.key}>
          <div className="t-meta sticky top-0 z-10 flex items-center gap-2 bg-panel px-2 pb-1 pt-2.5 font-medium">{t(`sessionList.buckets.${g.key}`)}<span className="tabular-nums font-normal">{g.rows.length}</span></div>
          <div className="flex flex-col gap-2 pt-1">
            {g.rows.map(({ s, runs, messages }) => {
              const active = s.sessionId === activeId;
              const last = runs[runs.length - 1];
              const tone: RunTone = last ? (last.status as RunTone) : 'none';
              const title = s.title ?? t('common.untitledSession');
              return (
                <Link key={s.sessionId} to={`/chat/${s.sessionId}`}
                  className={cn('group flex items-start gap-2.5 rounded-[10px] px-2 py-2 transition-colors duration-75', active ? 'bg-surface shadow-card ring-1 ring-accent' : 'shadow-card hover:bg-hover-2')}>
                  <Avatar id={s.sessionId} title={title} tone={tone} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className={cn('truncate text-[13px] font-medium tracking-[-0.01em]', active ? 'text-ink' : 'text-fg-2')}>{title}</span>
                      <span className="ml-auto shrink-0 text-[11px] tabular-nums text-ink-3">{relativeTimeShort(s.lastMessageAt ?? s.updatedAt)}</span>
                    </span>
                    <span className="mt-0.5 block truncate text-[12px] text-ink-2">{s.lastMessageRole === 'assistant' ? t('sessionList.agentPrefix') : s.lastMessageRole === 'user' ? t('sessionList.youPrefix') : ''}{s.preview ?? '—'}</span>
                    <span className="mt-1.5 flex items-center gap-2 text-[11px] text-ink-3">
                      <span className="inline-flex items-center gap-1" style={{ color: toneColor[tone] }}><span className={cn('size-1.5 rounded-full', tone === 'active' && 'animate-pulse')} style={{ background: toneColor[tone] }} />{t(toneKey[tone])}</span>
                      <span className="rounded-[5px] px-1 tabular-nums shadow-[inset_0_0_0_1px_var(--line)]">{runs.length} {t(runs.length === 1 ? 'sessionList.runOne' : 'sessionList.runMany')}</span>
                      <span className="tabular-nums">{messages} {t('sessionList.messages')}</span>
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
  const t = useT();
  return (
    <div className="flex rounded-control bg-surface p-0.5 shadow-card">
      {[false, true].map((v) => (
        <button key={String(v)} type="button" onClick={() => onChange(v)}
          className={cn('h-6 rounded-[6px] px-2 text-[12px] font-medium transition-colors', archived === v ? 'bg-hover-2 text-ink' : 'text-ink-3 hover:text-ink')}>
          {v ? t('sessionList.filterArchived') : t('sessionList.filterActive')}
        </button>
      ))}
    </div>
  );
}

/** Single chat page header: identity on the left; view switch (icon segmented control) + actions on the right. Page bg, one bottom hairline. */
export function SessionHeader<T extends string>({ id, title, lastRun, meta, actions, tabs, tab, onTab }: {
  id: string; title: string; lastRun?: ChatRun | undefined; meta?: React.ReactNode; actions?: React.ReactNode;
  tabs: Array<{ value: T; label: string; icon: React.ReactNode; count?: number | undefined; hint?: string | undefined }>; tab: T; onTab: (v: T) => void;
}) {
  const t = useT();
  const tone: RunTone = lastRun ? (lastRun.status as RunTone) : 'none';
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const index = tabs.findIndex((item) => item.value === tab);
    const next = tabs[(index + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
    if (next) { onTab(next.value); (e.currentTarget.querySelector(`[data-value="${next.value}"]`) as HTMLElement | null)?.focus(); }
  };
  return (
    <header className="gutter-x flex h-[var(--header-h)] shrink-0 items-center gap-2.5 border-b border-line bg-panel">
      <Avatar id={id} title={title} tone={tone} compact />
      <h1 title={t('sessionList.sessionTitle')} className="-mx-1 min-w-0 cursor-text truncate rounded-[6px] px-1 text-[14px] font-semibold tracking-[-0.01em] text-ink hover:bg-hover">{title}</h1>
      <span title={t(toneKey[tone])} className={cn('size-2 shrink-0 rounded-full', tone === 'active' && 'animate-pulse')} style={{ background: toneColor[tone] }} />
      {meta ? <span className="t-meta flex min-w-0 items-center gap-1.5 truncate">{meta}</span> : null}
      <div className="ml-auto flex shrink-0 items-center gap-2">
        <div role="tablist" aria-label={t('sessionList.sessionView')} onKeyDown={onKey} className="flex items-center gap-0.5 rounded-control bg-surface p-0.5 shadow-card">
          {tabs.map((tabItem) => {
            const sel = tab === tabItem.value;
            return (
              <button key={tabItem.value} data-value={tabItem.value} role="tab" type="button" aria-selected={sel} tabIndex={sel ? 0 : -1}
                title={tabItem.hint ?? tabItem.label} aria-label={tabItem.label} onClick={() => onTab(tabItem.value)}
                className={cn('flex h-6 items-center gap-1.5 rounded-[5px] px-2 text-[12px] font-medium outline-none transition-colors focus-visible:shadow-[0_0_0_2px_var(--accent)] [&_svg]:size-3.5', sel ? 'bg-hover-2 text-ink' : 'text-ink-3 hover:bg-hover hover:text-ink')}>
                {tabItem.icon}<span>{tabItem.label}</span>{tabItem.count !== undefined ? <span className="text-[11px] font-normal tabular-nums text-ink-3">{tabItem.count}</span> : null}
              </button>
            );
          })}
        </div>
        <span className="h-5 w-px bg-line" />
        <div className="flex items-center gap-0.5">{actions}</div>
      </div>
    </header>
  );
}
