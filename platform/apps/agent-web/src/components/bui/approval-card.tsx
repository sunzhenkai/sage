// Adapted from Beautiful UI "approval-card" (MIT © 2026 Shane Levine): human-in-the-loop question card.
import { useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

export type ApprovalOption = { key: string; label: ReactNode; description?: ReactNode | undefined; danger?: boolean | undefined };

export function ApprovalCard({ eyebrow, question, options, onConfirm, busy, confirmLabel = 'Continue', onDismiss, className }: {
  eyebrow?: ReactNode; question: ReactNode; options: ApprovalOption[]; onConfirm: (key: string) => void; busy?: boolean; confirmLabel?: string; onDismiss?: () => void; className?: string;
}) {
  const [picked, setPicked] = useState<string | null>(null);
  return (
    <div className={cn('w-full overflow-hidden rounded-[14px] bg-surface shadow-card', className)} style={{ animation: 'fade-up 360ms cubic-bezier(0.22,1,0.36,1) both' }}>
      <div className="px-3.5 pb-2 pt-3">
        {eyebrow ? <div className="mb-1 flex items-center gap-1.5 text-[12px] font-medium text-ink-3">{eyebrow}</div> : null}
        <div className="text-[14px] font-medium leading-[1.4] tracking-[-0.01em] text-ink">{question}</div>
      </div>
      <div className="flex flex-col gap-0.5 px-1.5 pb-1.5" role="radiogroup">
        {options.map((o, i) => {
          const on = picked === o.key;
          return (
            <button key={o.key} type="button" role="radio" aria-checked={on} onClick={() => setPicked(o.key)}
              className={cn('flex min-h-9 w-full items-center gap-2.5 rounded-control px-2 py-1.5 text-left transition-colors duration-100', on ? 'bg-hover-2' : 'hover:bg-hover')}>
              <span className={cn('grid size-5 shrink-0 place-items-center rounded-[6px] text-[11px] font-semibold tabular-nums', on ? 'bg-ink text-surface' : 'bg-field text-ink-2 shadow-hairline')}>{i + 1}</span>
              <span className="min-w-0 flex-1">
                <span className={cn('block text-[13px] font-medium', o.danger ? 'text-red' : 'text-ink')}>{o.label}</span>
                {o.description ? <span className="block text-[12px] text-ink-3">{o.description}</span> : null}
              </span>
            </button>
          );
        })}
      </div>
      <div className="flex items-center justify-end gap-1.5 border-t border-line px-2.5 py-2">
        {onDismiss ? <button type="button" onClick={onDismiss} className="h-[27px] rounded-full px-3 text-[13px] font-medium text-ink-2 hover:bg-hover">Not now</button> : null}
        <button type="button" disabled={!picked || busy} onClick={() => picked && onConfirm(picked)} className="h-[27px] rounded-full bg-ink px-3 text-[13px] font-medium text-canvas shadow-[inset_0_1px_0_rgba(255,255,255,0.14)] transition-[opacity,transform] hover:opacity-90 active:scale-[0.96] disabled:opacity-40">{busy ? 'Working…' : confirmLabel}</button>
      </div>
    </div>
  );
}
