// Adapted from Beautiful UI "flowchart" (MIT © 2026 Shane Levine): workflow steps on a dotted canvas.
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export type FlowNode = { key: string; kind: string; tone: 'purple' | 'amber' | 'green' | 'blue' | 'neutral'; icon: ReactNode; title: ReactNode; sub?: ReactNode | undefined; body?: ReactNode | undefined };
const TONES = { purple: '#9a5cff', amber: '#f09a2f', green: 'var(--green)', blue: 'var(--accent)', neutral: 'var(--ink-3)' } as const;

export function Flowchart({ nodes, className }: { nodes: FlowNode[]; className?: string }) {
  return (
    <div className={cn('dotted-canvas rounded-card px-6 py-6 shadow-hairline', className)}>
      <div className="mx-auto flex max-w-[400px] flex-col">
        {nodes.map((n, i) => {
          const color = TONES[n.tone];
          return (
            <div key={n.key} className="flex flex-col" style={{ animation: `fade-up 400ms cubic-bezier(0.23,1,0.32,1) ${i * 90}ms both` }}>
              {i > 0 ? <span aria-hidden className="mx-auto h-8 w-px bg-line-strong" /> : null}
              <span className="mb-1.5 w-fit rounded-[6px] px-1.5 py-[3px] text-[11.5px] font-medium" style={{ color, background: `color-mix(in srgb, ${color} 14%, var(--surface))` }}>{n.kind}</span>
              <div className="rounded-[14px] bg-surface p-3 shadow-card">
                <div className="flex items-center gap-3">
                  <span className="grid size-9 shrink-0 place-items-center rounded-[9px] [&_svg]:size-4" style={{ color, background: `color-mix(in srgb, ${color} 14%, var(--surface))` }}>{n.icon}</span>
                  <div className="min-w-0">
                    <div className="truncate text-[13.5px] font-semibold text-ink">{n.title}</div>
                    {n.sub ? <div className="truncate text-[12.5px] text-ink-2">{n.sub}</div> : null}
                  </div>
                </div>
                {n.body ? <div className="mt-2.5 flex flex-wrap items-center gap-1.5 text-[12.5px] text-ink-2">{n.body}</div> : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Small bordered chip used inside flow node bodies (e.g. "order", "flavor ▾"). */
export function FlowChip({ children, dot }: { children: ReactNode; dot?: string }) {
  return <span className="inline-flex h-[26px] items-center gap-1.5 rounded-control bg-surface px-2 text-[12.5px] font-medium text-ink shadow-btn">{dot ? <span className="size-1.5 rounded-full" style={{ background: dot }} /> : null}{children}</span>;
}
