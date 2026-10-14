import { cn } from '@/lib/utils';
import { StatusPill, toneFor } from '@/components/bui/atoms';
import { StatusIcon } from './status';

export type Tone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger';
const dots: Record<Tone, string> = { neutral: 'bg-faint', accent: 'bg-accent', success: 'bg-green', warning: 'bg-amber', danger: 'bg-red' };

/** Linear "chip": hairline outline, tiny dot, medium weight. */
export function Badge({ tone = 'neutral', dot = tone !== 'neutral', className, children }: { tone?: Tone; dot?: boolean; className?: string; children: React.ReactNode }) {
  return (
    <span className={cn('inline-flex h-[22px] max-w-full items-center gap-1.5 rounded-full bg-field px-2 text-[11.5px] font-medium text-ink-2', className)}>
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
    <StatusPill tone={toneFor(status)}>{label(status ?? 'unknown')}</StatusPill>
  );
}
