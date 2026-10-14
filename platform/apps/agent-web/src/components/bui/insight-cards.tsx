// Adapted from Beautiful UI "insight-cards" (MIT © 2026 Shane Levine): paged agent insights with live charts.
// The original uses `liveline`; charts here reuse the app's pinned recharts.
import { useState, type ReactNode } from 'react';
import { Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, YAxis } from 'recharts';
import { cn } from '@/lib/utils';

export type InsightSeries = { name: string; color: string; value: ReactNode; delta?: ReactNode | undefined; positive?: boolean | undefined; data: number[] };
export type InsightPage = { key: string; sentence: ReactNode; series: InsightSeries[]; snapshot?: string | undefined; prompt?: string | undefined };

export function InsightCards({ pages, title = 'Insights', onPrompt, className }: { pages: InsightPage[]; title?: ReactNode; onPrompt?: (p: string) => void; className?: string }) {
  const [i, setI] = useState(0);
  const page = pages[Math.min(i, pages.length - 1)];
  if (!page) return null;
  const len = Math.max(...page.series.map((s) => s.data.length));
  const rows = Array.from({ length: len }, (_, k) => Object.fromEntries([['k', k], ...page.series.map((s) => [s.name, s.data[k] ?? null])]));
  const Arrow = ({ d }: { d: string }) => <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>;
  return (
    <div className={cn('flex flex-col', className)}>
      <div className="flex items-center gap-1.5">
        <span className="text-[13px] font-semibold text-ink">{title}</span>
        <span className="text-[13px] tabular-nums text-ink-3">{pages.length}</span>
        <span className="ml-auto flex items-center gap-0.5 text-ink-2">
          <button type="button" aria-label="Previous insight" disabled={i === 0} onClick={() => setI(i - 1)} className="flex size-6 items-center justify-center rounded-[6px] hover:bg-hover disabled:opacity-35"><Arrow d="M15 18l-6-6 6-6" /></button>
          <button type="button" aria-label="Next insight" disabled={i >= pages.length - 1} onClick={() => setI(i + 1)} className="flex size-6 items-center justify-center rounded-[6px] hover:bg-hover disabled:opacity-35"><Arrow d="M9 18l6-6-6-6" /></button>
        </span>
      </div>
      <p key={page.key} className="mt-1.5 text-[13.5px] leading-[1.6] text-ink-2" style={{ animation: 'fade-in 300ms ease-out both' }}>{page.sentence}</p>
      <div key={`${page.key}-card`} className="mt-2.5 rounded-[12px] bg-surface p-3 shadow-card" style={{ animation: 'fade-up 360ms cubic-bezier(0.16,1,0.3,1) both' }}>
        <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${page.series.length}, minmax(0, 1fr))` }}>
          {page.series.map((s) => (
            <div key={s.name} className="min-w-0">
              <div className="flex items-center gap-1.5 text-[12.5px] text-ink-2"><span className="size-2 rounded-full" style={{ background: s.color }} />{s.name}</div>
              <div className={cn('mt-0.5 text-[20px] font-semibold tracking-[-0.02em] tabular-nums', s.positive === undefined ? 'text-ink' : s.positive ? 'text-green' : 'text-red')}>{s.value}</div>
              {s.delta !== undefined ? <div className={cn('font-mono text-[12px] tabular-nums', s.positive === undefined ? 'text-ink-3' : s.positive ? 'text-green' : 'text-red')}>{s.delta}</div> : null}
            </div>
          ))}
        </div>
        <div className="mt-3 overflow-hidden rounded-[10px] shadow-hairline">
          <div className="flex h-9 items-center justify-between border-b border-line px-3 text-[12px] text-ink-3">
            <span>{page.snapshot ?? 'Trend snapshot'}</span>
            <span className="rounded-full bg-field px-2 py-0.5 text-[11.5px] text-ink-2">{len} pts</span>
          </div>
          <div className="h-[150px] px-1 py-2">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={rows} margin={{ top: 8, right: 8, bottom: 4, left: 8 }}>
                <YAxis hide domain={['dataMin - 1', 'dataMax + 1']} />
                <Tooltip cursor={{ stroke: 'var(--ink)', strokeOpacity: 0.26 }} content={({ active, payload }) => active && payload?.length ? (
                  <div className="flex items-center gap-3 rounded-[8px] border border-line-strong px-[9px] py-[5px] text-[11.5px] tabular-nums shadow-overlay" style={{ background: 'var(--tooltip-bg)', color: 'var(--tooltip-fg)' }}>
                    {payload.map((p) => <span key={String(p.dataKey)} className="inline-flex items-center gap-1.5"><span className="size-2 rounded-full" style={{ background: String(p.color) }} />{String(p.value)}</span>)}
                  </div>) : null} />
                {page.series.map((s) => <ReferenceLine key={`${s.name}-ref`} y={s.data.at(-1) ?? 0} stroke={s.color} strokeOpacity={0.45} strokeDasharray="3 4" />)}
                {page.series.map((s) => <Line key={s.name} dataKey={s.name} stroke={s.color} strokeWidth={2} type="monotone" dot={false} activeDot={{ r: 3.5, strokeWidth: 0 }} isAnimationActive={false} connectNulls />)}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
      {page.prompt ? <button type="button" onClick={() => onPrompt?.(page.prompt!)} className="mt-2.5 w-fit rounded-full bg-surface px-3 py-1.5 text-[13px] text-ink shadow-btn transition-colors hover:bg-inset">{page.prompt}</button> : null}
    </div>
  );
}
