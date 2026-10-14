import { cn } from '@/lib/utils';
import { StatusIcon } from './status';

const tones = {
  neutral: 'text-fg-2 border-line-strong',
  accent: 'text-fg-2 border-line-strong',
  success: 'text-fg-2 border-line-strong',
  warning: 'text-fg-2 border-line-strong',
  danger: 'text-fg-2 border-line-strong'
} as const;
export type Tone = keyof typeof tones;
const dots: Record<Tone, string> = { neutral: 'bg-faint', accent: 'bg-accent', success: 'bg-green', warning: 'bg-amber', danger: 'bg-red' };

/** Linear "chip": hairline outline, tiny dot, medium weight. */
export function Badge({ tone = 'neutral', dot = tone !== 'neutral', className, children }: { tone?: Tone; dot?: boolean; className?: string; children: React.ReactNode }) {
  return (
    <span className={cn('inline-flex h-[22px] max-w-full items-center gap-1.5 rounded-full border px-2 text-[12px]', tones[tone], className)}>
      {dot ? <span className={cn('size-1.5 shrink-0 rounded-full', dots[tone])} /> : null}
      <span className="truncate">{children}</span>
    </span>
  );
}

export function statusTone(status: string | undefined): Tone {
  switch (status?.toLowerCase()) {
    case 'succeeded': case 'active': case 'open': case 'available': case 'ready': case 'alive': return 'success';
    case 'running': case 'routed': return 'accent';
    case 'paused': case 'skipped': case 'effect_unknown': case 'promotion_pending': return 'warning';
    case 'failed': case 'cancelled': case 'missed': case 'deleted': return 'danger';
    default: return 'neutral';
  }
}

export function StatusDot({ status }: { status: string | undefined }) {
  return <StatusIcon status={status} />;
}

const label = (s: string) => s.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase());

export function StatusBadge({ status }: { status: string | undefined }) {
  return (
    <span className="inline-flex h-[22px] items-center gap-1.5 rounded-full border border-line-strong py-0 pl-1.5 pr-2 text-2xs font-medium text-fg-2">
      <StatusIcon status={status} />{label(status ?? 'unknown')}
    </span>
  );
}
