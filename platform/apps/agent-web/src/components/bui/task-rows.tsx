// Adapted from Beautiful UI "task-rows" (MIT © 2026 Shane Levine): live task status capsules / list.
import { useState, type ReactNode } from 'react';
import { useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { statusLabelKey } from '@/components/ui/status';
import { StatusGlyph, StatusPill, toneFor } from './atoms';

export type TaskRowItem = { key: string; label: ReactNode; amount?: ReactNode | undefined; status: string; step?: ReactNode | undefined; pill?: ReactNode | undefined; details?: { label: ReactNode | undefined; meta: ReactNode }[]; onOpen?: () => void | undefined };

export function TaskRows({ rows, variant = 'capsules', className }: { rows: TaskRowItem[]; variant?: 'capsules' | 'list'; className?: string }) {
  const t = useT();
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const list = variant === 'list';
  return (
    <div className={cn('flex w-full flex-col', list ? 'overflow-hidden rounded-card bg-surface shadow-card' : 'gap-2', className)}>
      {rows.map((row, i) => {
        const isOpen = !!open[row.key];
        const hasDetails = !!row.details?.length;
        const pillKey = statusLabelKey(row.status);
        return (
          <div key={row.key} className={cn('self-stretch overflow-hidden transition-[border-radius,background-color] duration-300 hover:bg-inset', list ? 'border-b border-line last:border-0' : 'bg-surface shadow-card')}
            style={{ borderRadius: list ? 0 : isOpen ? 14 : 22, animation: `fade-up 450ms cubic-bezier(0.23,1,0.32,1) ${Math.min(i, 10) * 40}ms both` }}>
            <div className="flex h-11 w-full items-center gap-2.5 px-2.5">
              <span className="flex size-6 shrink-0 items-center justify-center"><StatusGlyph status={row.status} step={row.step} /></span>
              <button type="button" onClick={row.onOpen} className="min-w-0 flex-1 truncate text-left text-[13px] font-medium text-ink hover:underline-offset-2 enabled:hover:underline" disabled={!row.onOpen}>{row.label}</button>
              {row.amount !== undefined ? <span className="shrink-0 text-[12.5px] tabular-nums text-ink-2">{row.amount}</span> : null}
              {row.pill !== undefined ? row.pill : <StatusPill tone={toneFor(row.status)}>{pillKey === undefined ? String(row.status).replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase()) : t(pillKey)}</StatusPill>}
              <button type="button" aria-expanded={isOpen} aria-label={t('taskRows.details')} disabled={!hasDetails} onClick={() => setOpen((c) => ({ ...c, [row.key]: !isOpen }))} className="-ml-1 flex size-7 shrink-0 items-center justify-center rounded-full text-ink-3 enabled:hover:bg-hover-2 disabled:opacity-30">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="transition-transform duration-300" style={{ transform: isOpen ? 'rotate(180deg)' : 'rotate(0)' }}><path d="M6 9l6 6 6-6" /></svg>
              </button>
            </div>
            {hasDetails ? (
              <div className="grid transition-[grid-template-rows,opacity] duration-300" style={{ gridTemplateRows: isOpen ? '1fr' : '0fr', opacity: isOpen ? 1 : 0, transitionTimingFunction: 'cubic-bezier(0.23, 1, 0.32, 1)' }}>
                <div className="overflow-hidden">
                  <div className="mb-2.5 grid grid-cols-[24px_1fr] gap-2.5 px-2.5">
                    <span aria-hidden className="mx-auto h-full w-px bg-line" />
                    <div className="flex flex-col gap-1.5">
                      {row.details!.map((d, j) => (
                        <div key={j} className="flex items-center justify-between gap-3">
                          <span className="truncate text-[12px] text-ink-2">{d.label}</span>
                          <span className="shrink-0 font-mono text-[11.5px] tabular-nums text-ink-3">{d.meta}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
