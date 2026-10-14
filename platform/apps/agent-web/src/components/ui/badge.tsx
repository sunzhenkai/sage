import { cn } from '@/lib/utils';

const tones = {
  neutral: 'text-muted bg-subtle border-border',
  accent: 'text-accent bg-accent/10 border-accent/25',
  success: 'text-success bg-success/10 border-success/25',
  warning: 'text-warning bg-warning/10 border-warning/25',
  danger: 'text-danger bg-danger/10 border-danger/25'
} as const;
export type Tone = keyof typeof tones;

export function Badge({ tone = 'neutral', className, children }: { tone?: Tone; className?: string; children: React.ReactNode }) {
  return <span className={cn('inline-flex h-5 items-center gap-1 rounded border px-1.5 text-[11px] font-medium', tones[tone], className)}>{children}</span>;
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
  const tone = statusTone(status);
  const color = { neutral: 'bg-muted', accent: 'bg-accent', success: 'bg-success', warning: 'bg-warning', danger: 'bg-danger' }[tone];
  return <span className={cn('inline-block size-2 rounded-full', color, status === 'running' || status === 'active' ? 'animate-pulse' : '')} />;
}

export function StatusBadge({ status }: { status: string | undefined }) {
  return <Badge tone={statusTone(status)}><StatusDot status={status} />{status ?? 'unknown'}</Badge>;
}
