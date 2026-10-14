import { AlertCircle, Inbox, KeyRound, type LucideIcon } from 'lucide-react';
import { Link } from 'react-router';
import { ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';

export function Card({ className, children }: { className?: string; children: React.ReactNode }) {
  return <section className={cn('overflow-hidden rounded-lg border border-line', className)}>{children}</section>;
}
export function CardHeader({ title, description, actions }: { title: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="flex min-h-10 items-center justify-between gap-3 border-b border-line px-4 py-2">
      <div className="min-w-0">
        <div className="text-[13px] font-medium tracking-[-0.01em] text-fg">{title}</div>
        {description ? <div className="text-xs text-muted">{description}</div> : null}
      </div>
      {actions}
    </div>
  );
}
export function Section({ title, description, children, className }: { title: string; description?: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn('flex flex-col gap-3', className)}>
      <div>
        <h2 className="text-[13px] font-semibold tracking-[-0.01em]">{title}</h2>
        {description ? <p className="mt-0.5 text-xs text-muted">{description}</p> : null}
      </div>
      {children}
    </section>
  );
}
export function Kbd({ children, className }: { children: React.ReactNode; className?: string }) {
  return <kbd className={cn('inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-[4px] border border-line-strong bg-raised px-1 font-sans text-[10.5px] font-medium text-muted shadow-[0_1px_0_var(--line-strong)]', className)}>{children}</kbd>;
}
export function Spinner({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={cn('size-3.5 animate-spin text-muted', className)}>
      <circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" strokeOpacity="0.2" strokeWidth="1.8" />
      <path d="M8 1.5a6.5 6.5 0 0 1 6.5 6.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
/** Skeleton list rows instead of a bare spinner. */
export function Loading({ rows = 6, label }: { rows?: number; label?: string }) {
  return (
    <div className="animate-fade-in flex flex-col" aria-label={label ?? 'Loading'}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex h-[38px] items-center gap-3 px-6">
          <div className="skeleton size-3.5 rounded-full" />
          <div className="skeleton h-2.5" style={{ width: `${28 + ((i * 37) % 40)}%` }} />
          <div className="skeleton ml-auto h-2.5 w-14" />
        </div>
      ))}
    </div>
  );
}
export function Empty({ title, hint, icon: Icon = Inbox, children }: { title: string; hint?: string; icon?: LucideIcon; children?: React.ReactNode }) {
  return (
    <div className="animate-fade-in flex flex-1 flex-col items-center justify-center gap-2 px-6 py-16 text-center">
      <Icon className="mb-2 size-9 text-faint/70" strokeWidth={1.25} />
      <div className="text-[13.5px] font-medium tracking-[-0.01em] text-fg-2">{title}</div>
      {hint ? <div className="max-w-[320px] text-[12.5px] leading-[18px] text-muted">{hint}</div> : null}
      {children ? <div className="mt-3 flex gap-2">{children}</div> : null}
    </div>
  );
}
/** Quiet inline error — no tinted box. */
export function ErrorState({ error }: { error: unknown }) {
  const isApi = error instanceof ApiError;
  const authHint = isApi && (error.status === 401 || error.code.includes('AUTHENTICATION'));
  const Icon = authHint ? KeyRound : AlertCircle;
  return (
    <div className="animate-fade-in flex items-start gap-2.5 px-6 py-4 text-[12.5px]">
      <Icon className={cn('mt-px size-3.5 shrink-0', authHint ? 'text-muted' : 'text-red')} strokeWidth={1.75} />
      <div className="min-w-0">
        <span className="font-medium text-fg-2">{authHint ? 'Service token required. ' : 'Request failed. '}</span>
        <span className="break-words text-muted">{error instanceof Error ? error.message : String(error)}</span>
        {isApi ? <span className="ml-2 font-mono text-[11px] text-faint">{error.status} {error.code}</span> : null}
        {authHint ? <Link to="/settings" className="ml-2 font-medium text-accent hover:underline">Add token</Link> : null}
      </div>
    </div>
  );
}
export function JsonView({ value, className }: { value: unknown; className?: string }) {
  return <pre className={cn('overflow-auto rounded-md border border-line bg-sunken p-3 font-mono text-[11.5px] leading-[18px] text-fg-2', className)}>{JSON.stringify(value, null, 2)}</pre>;
}
export function Mono({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={cn('font-mono text-[11.5px] tracking-normal', className)}>{children}</span>;
}
export function KeyValue({ items }: { items: [string, React.ReactNode][] }) {
  return (
    <dl className="flex flex-col text-[12.5px]">
      {items.map(([key, value]) => (
        <div key={key} className="grid min-h-8 grid-cols-[128px_1fr] items-center gap-3 py-1">
          <dt className="text-muted">{key}</dt>
          <dd className="min-w-0 break-all text-fg">{value ?? <span className="text-faint">—</span>}</dd>
        </div>
      ))}
    </dl>
  );
}
