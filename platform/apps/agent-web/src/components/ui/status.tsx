import { cn } from '@/lib/utils';

/** Linear-style status glyphs (14px). */
export type StatusKind = 'backlog' | 'todo' | 'progress' | 'review' | 'done' | 'canceled' | 'failed' | 'paused' | 'warning';

export function statusKind(status: string | undefined): StatusKind {
  switch (status?.toLowerCase()) {
    case 'succeeded': case 'active': case 'open': case 'available': case 'ready': case 'alive': case 'present': return 'done';
    case 'running': case 'routed': case 'connecting': case 'live': return 'progress';
    case 'promotion_pending': case 'placeholder': case 'reconnecting': return 'review';
    case 'paused': case 'skipped': return 'paused';
    case 'effect_unknown': case 'missed': return 'warning';
    case 'failed': case 'closed': return 'failed';
    case 'cancelled': case 'deleted': return 'canceled';
    default: return 'todo';
  }
}

const colors: Record<StatusKind, string> = {
  backlog: 'text-faint', todo: 'text-muted', progress: 'text-amber', review: 'text-violet', done: 'text-accent',
  canceled: 'text-faint', failed: 'text-red', paused: 'text-blue', warning: 'text-amber'
};

/**
 * Known status words reuse the shared `status.*` vocabulary; anything else keeps the raw enum label.
 * Consumed by StatusBadge / TaskRows so the same enum always renders the same translated word.
 */
const statusKeys: Record<string, string> = {
  succeeded: 'status.succeeded', completed: 'status.completed', failed: 'status.failed', running: 'status.running',
  paused: 'status.paused', cancelled: 'status.cancelled', skipped: 'status.skipped', missed: 'status.missed',
  effect_unknown: 'status.effectUnknown', active: 'status.active', available: 'status.available', alive: 'status.alive',
  ready: 'status.ready', disabled: 'status.disabled', stale: 'status.stale', unavailable: 'status.unavailable', promoted: 'status.promoted'
};
export function statusLabelKey(status: string | undefined): string | undefined {
  return status === undefined ? undefined : statusKeys[status.toLowerCase()];
}

export function StatusIcon({ status, kind, className }: { status?: string | undefined; kind?: StatusKind; className?: string }) {
  const k = kind ?? statusKind(status);
  const cls = cn('size-3.5 shrink-0', colors[k], className);
  switch (k) {
    case 'backlog': return <svg viewBox="0 0 14 14" className={cls}><circle cx="7" cy="7" r="6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="1.4 1.74" /></svg>;
    case 'todo': return <svg viewBox="0 0 14 14" className={cls}><circle cx="7" cy="7" r="6" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>;
    case 'progress': return <svg viewBox="0 0 14 14" className={cls}><circle cx="7" cy="7" r="6" fill="none" stroke="currentColor" strokeWidth="1.5" /><path d="M7 3.5A3.5 3.5 0 0 1 7 10.5Z" fill="currentColor" /></svg>;
    case 'review': return <svg viewBox="0 0 14 14" className={cls}><circle cx="7" cy="7" r="6" fill="none" stroke="currentColor" strokeWidth="1.5" /><path d="M7 3.5A3.5 3.5 0 1 1 3.5 7H7Z" fill="currentColor" /></svg>;
    case 'done': return <svg viewBox="0 0 14 14" className={cls}><circle cx="7" cy="7" r="7" fill="currentColor" /><path d="M4.4 7.2 6.2 9l3.4-3.6" fill="none" stroke="var(--panel)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>;
    case 'failed': return <svg viewBox="0 0 14 14" className={cls}><circle cx="7" cy="7" r="7" fill="currentColor" /><path d="m4.8 4.8 4.4 4.4m0-4.4-4.4 4.4" stroke="var(--panel)" strokeWidth="1.5" strokeLinecap="round" /></svg>;
    case 'canceled': return <svg viewBox="0 0 14 14" className={cls}><circle cx="7" cy="7" r="7" fill="currentColor" /><path d="m4.8 4.8 4.4 4.4m0-4.4-4.4 4.4" stroke="var(--panel)" strokeWidth="1.5" strokeLinecap="round" /></svg>;
    case 'paused': return <svg viewBox="0 0 14 14" className={cls}><circle cx="7" cy="7" r="6" fill="none" stroke="currentColor" strokeWidth="1.5" /><path d="M5.6 4.8v4.4M8.4 4.8v4.4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>;
    case 'warning': return <svg viewBox="0 0 14 14" className={cls}><circle cx="7" cy="7" r="7" fill="currentColor" /><path d="M7 3.8v3.8" stroke="var(--panel)" strokeWidth="1.6" strokeLinecap="round" /><circle cx="7" cy="10" r="0.9" fill="var(--panel)" /></svg>;
  }
}
