// Adapted from Beautiful UI "thinking-state" (MIT © 2026 Shane Levine): expandable agent trace.
import { useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

export type TraceRow = { key: string; primary: ReactNode; secondary?: ReactNode | undefined; mono?: boolean | undefined; state?: 'done' | 'active' | 'failed' | 'pending' | undefined; icon?: ReactNode | undefined; detail?: ReactNode | undefined; onClick?: () => void | undefined };

const Sparkle = ({ color }: { color: string }) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill={color} aria-hidden><path d="M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8z" /></svg>
);
const Chevron = ({ open, size = 14 }: { open: boolean; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="var(--ink-3)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 transition-transform duration-300" style={{ transform: open ? 'rotate(180deg)' : 'rotate(0)' }}><path d="M6 9l6 6 6-6" /></svg>
);

export function RowGlyph({ state }: { state: TraceRow['state'] }) {
  if (state === 'active') return <span className="size-3 shrink-0 rounded-full border-[1.5px] border-line-strong border-t-ink-2" style={{ animation: 'spin 700ms linear infinite' }} />;
  if (state === 'failed') return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--red)" strokeWidth="2.5" strokeLinecap="round" className="shrink-0"><path d="M18 6L6 18M6 6l12 12" /></svg>;
  if (state === 'pending') return <span className="size-3 shrink-0 rounded-full border-[1.5px] border-line-strong" />;
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--ink-3)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0"><path d="M20 6L9 17l-5-5" /></svg>;
}

/** Collapsible trace header ("Thinking" shimmer while working → settled label) with a hairline-railed step list. */
export function ThinkingTrace({ working, activeLabel = 'Thinking', doneLabel, rows, defaultOpen, icon, prose, className }: {
  working: boolean; activeLabel?: ReactNode; doneLabel: ReactNode; rows: TraceRow[]; defaultOpen?: boolean; icon?: ReactNode; prose?: boolean; className?: string;
}) {
  const [manual, setManual] = useState<boolean | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const open = manual ?? defaultOpen ?? working;
  return (
    <div className={cn('flex w-full flex-col', className)}>
      <button type="button" aria-expanded={open} onClick={() => setManual(!open)} className="-mx-1.5 flex w-fit items-center gap-2 rounded-control px-1.5 py-1 transition-colors duration-100 hover:bg-hover-2">
        <span className="flex shrink-0" style={{ color: working ? 'var(--ink-2)' : 'var(--ink-3)' }}>{icon ?? <Sparkle color={working ? 'var(--ink-2)' : 'var(--ink-3)'} />}</span>
        <span role="status" className="contents">
          {working ? <span className="shimmer-label whitespace-nowrap text-[13px] font-medium">{activeLabel}</span>
            : <span className="whitespace-nowrap text-[13px] font-medium text-ink-2" style={{ animation: 'fade-in 350ms ease-out both' }}>{doneLabel}</span>}
        </span>
        {rows.length ? <Chevron open={open} /> : null}
      </button>
      <div className="grid transition-[grid-template-rows,opacity] duration-400" style={{ gridTemplateRows: open ? '1fr' : '0fr', opacity: open ? 1 : 0, transitionTimingFunction: 'cubic-bezier(0.23, 1, 0.32, 1)' }}>
        <div className="overflow-hidden">
          <div className="relative ml-[5px] mt-1 pl-4">
            <span aria-hidden className="absolute bottom-2 left-[3px] top-[-8px] w-px bg-line" />
            <div className="flex flex-col gap-1 py-1">
              {rows.map((row, i) => {
                const isSel = selected === row.key;
                const body = (
                  <>
                    {prose ? null : row.icon ?? <RowGlyph state={row.state} />}
                    <span className={cn('min-w-0 text-[12.5px]', prose ? 'whitespace-normal leading-relaxed text-ink-2' : 'truncate font-medium text-ink')}>{row.primary}</span>
                    {row.secondary !== undefined ? <span className={cn('shrink-0 text-[11.5px] text-ink-3', row.mono && 'font-mono')}>{row.secondary}</span> : null}
                  </>
                );
                const cls = 'flex min-h-7 w-full items-center gap-2 rounded-[6px] px-1.5 py-0.5 text-left';
                const anim = { animation: `fade-up 320ms cubic-bezier(0.23,1,0.32,1) ${Math.min(i, 8) * 60}ms both` };
                return (
                  <div key={row.key} style={anim}>
                    {row.detail !== undefined || row.onClick ? (
                      <button type="button" aria-pressed={isSel} onClick={() => { row.onClick?.(); if (row.detail !== undefined) setSelected(isSel ? null : row.key); }} className={cn(cls, 'transition-colors duration-150', isSel ? 'bg-inset' : 'hover:bg-hover')}>{body}</button>
                    ) : <div className={cls}>{body}</div>}
                    {isSel && row.detail !== undefined ? <div className="mb-1 ml-6 mt-0.5" style={{ animation: 'fade-up 240ms cubic-bezier(0.23,1,0.32,1) both' }}>{row.detail}</div> : null}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
