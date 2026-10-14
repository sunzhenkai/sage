// Adapted from Beautiful UI "tool-chips" (MIT © 2026 Shane Levine): tool calls as compact chip rows.
import { useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

const Icons: Record<string, ReactNode> = {
  think: <path d="M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8z" />,
  write: <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z" /></g>,
  run: <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 17l6-5-6-5M12 19h8" /></g>,
  read: <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /></g>,
  task: <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="16" rx="3" /><path d="M8 12l3 3 5-6" /></g>,
  error: <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="9" /><path d="M12 7v6M12 16.5v.5" /></g>
};
export type ToolIcon = keyof typeof Icons | string;
export type ToolStep = { key: string; icon: ToolIcon; label: ReactNode; chip?: ReactNode | undefined; mono?: boolean | undefined; detail?: { text: string | undefined; tone?: 'add' | 'del' | 'muted' | undefined }[]; active?: boolean | undefined; trailing?: ReactNode | undefined };

export function ToolChips({ header, steps, files, defaultOpen = true, className }: { header: ReactNode; steps: ToolStep[]; files?: { name: string; meta?: ReactNode; onClick?: () => void }[]; defaultOpen?: boolean; className?: string }) {
  const [open, setOpen] = useState(defaultOpen);
  const [rows, setRows] = useState<Set<string>>(new Set());
  const toggle = (k: string) => setRows((cur) => { const n = new Set(cur); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  return (
    <div className={cn('w-full max-w-[460px]', className)}>
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="-mx-1.5 flex w-fit items-center gap-1.5 rounded-control px-1.5 py-1 text-[12.5px] text-ink-2 transition-colors duration-100 hover:bg-hover-2">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="transition-transform duration-200" style={{ transform: open ? 'rotate(0deg)' : 'rotate(-90deg)' }}><path d="M6 9l6 6 6-6" /></svg>
        <span className="tabular-nums">{header}</span>
      </button>
      <div className="grid transition-[grid-template-rows,opacity] duration-300" style={{ gridTemplateRows: open ? '1fr' : '0fr', opacity: open ? 1 : 0 }}>
        <div className="-mx-1 overflow-hidden px-1.5 pb-1">
          <div className="mt-1.5 flex flex-col gap-1">
            {steps.map((row) => {
              const rowOpen = rows.has(row.key);
              const expandable = !!row.detail?.length;
              return (
                <div key={row.key} style={{ animation: 'fade-up 300ms cubic-bezier(0.23,1,0.32,1) both' }}>
                  <button type="button" aria-expanded={rowOpen} disabled={!expandable} onClick={() => toggle(row.key)} className="group/row -mx-[3px] flex h-7 w-[calc(100%+6px)] min-w-0 items-center gap-2 rounded-control px-[3px] text-left transition-colors duration-100 enabled:hover:bg-hover-2">
                    <span className={cn('relative flex size-4 shrink-0 items-center justify-center', row.icon === 'error' ? 'text-red' : 'text-ink-3')}>
                      {row.active ? <span className="size-3 rounded-full border-[1.5px] border-line-strong border-t-ink-2" style={{ animation: 'spin 700ms linear infinite' }} /> : (
                        <svg width="13" height="13" viewBox="0 0 24 24" fill={row.icon === 'think' ? 'currentColor' : 'none'} stroke="currentColor" className={cn('transition-opacity duration-100', expandable && 'group-hover/row:opacity-0', rowOpen && 'opacity-0')}>{Icons[row.icon] ?? Icons.run}</svg>
                      )}
                      {expandable ? <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className={cn('absolute transition-[opacity,transform] duration-150 group-hover/row:opacity-100', rowOpen ? 'opacity-100' : 'opacity-0')} style={{ transform: rowOpen ? 'rotate(0deg)' : 'rotate(-90deg)' }}><path d="M6 9l6 6 6-6" /></svg> : null}
                    </span>
                    <span className={cn('shrink-0 text-[12.5px] font-medium', row.active ? 'shimmer-label' : 'text-ink')}>{row.label}</span>
                    {row.chip !== undefined ? <span className={cn('inline-flex h-[22px] min-w-0 flex-1 items-center truncate rounded-chip bg-surface px-1.5 text-[11.5px] text-ink-2 shadow-hairline', row.mono && 'font-mono')}>{row.chip}</span> : <span className="flex-1" />}
                    {row.trailing}
                  </button>
                  {expandable ? (
                    <div className="grid transition-[grid-template-rows,opacity] duration-300" style={{ gridTemplateRows: rowOpen ? '1fr' : '0fr', opacity: rowOpen ? 1 : 0, transitionTimingFunction: 'cubic-bezier(0.23, 1, 0.32, 1)' }}>
                      <div className="min-h-0 overflow-hidden">
                        <div className="mb-1 ml-2 mt-0.5 flex flex-col gap-0.5 border-l border-line py-0.5 pl-3.5">
                          {row.detail!.map((line, i) => <span key={i} className={cn('truncate font-mono text-[11.5px] leading-[1.6]', line.tone === 'add' ? 'text-green' : line.tone === 'del' ? 'text-red' : 'text-ink-2')}>{line.text}</span>)}
                        </div>
                      </div>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
          {files?.length ? (
            <div className="mt-2.5 flex flex-wrap gap-1.5 border-t border-line pt-2.5">
              {files.map((f) => (
                <button key={f.name} type="button" onClick={f.onClick} className="inline-flex h-7 items-center gap-1.5 rounded-control bg-surface px-2 font-mono text-[12px] text-ink shadow-btn transition-colors hover:bg-inset">
                  {f.name}{f.meta !== undefined ? <span className="text-ink-3">{f.meta}</span> : null}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** File chip (tool-chips diff chip). */
export function FileChip({ name, meta, active, onClick }: { name: ReactNode; meta?: ReactNode | undefined; active?: boolean; onClick?: () => void }) {
  return (
    <button type="button" onClick={onClick} className={cn('inline-flex h-8 items-center gap-1.5 rounded-control px-2.5 font-mono text-[12px] text-ink shadow-btn transition-colors', active ? 'bg-hover-2' : 'bg-surface hover:bg-inset')}>
      {name}{meta !== undefined ? <span className="text-ink-3">{meta}</span> : null}
    </button>
  );
}
