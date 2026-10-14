import { AlertTriangle, Inbox, Loader2 } from 'lucide-react';
import { ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';

export function Card({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn('rounded-lg border bg-panel', className)}>{children}</div>;
}
export function CardHeader({ title, actions }: { title: React.ReactNode; actions?: React.ReactNode }) {
  return <div className="flex h-9 items-center justify-between border-b px-3"><div className="text-xs font-medium text-muted">{title}</div>{actions}</div>;
}
export function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="inline-flex h-4.5 min-w-4.5 items-center justify-center rounded border bg-subtle px-1 font-mono text-[10px] text-muted">{children}</kbd>;
}
export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn('size-3.5 animate-spin text-muted', className)} />;
}
export function Loading({ label = 'Loading…' }: { label?: string }) {
  return <div className="flex items-center gap-2 p-6 text-xs text-muted"><Spinner />{label}</div>;
}
export function Empty({ title, hint, children }: { title: string; hint?: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 p-10 text-center">
      <Inbox className="size-6 text-muted/60" />
      <div className="text-[13px] font-medium">{title}</div>
      {hint ? <div className="max-w-sm text-xs text-muted">{hint}</div> : null}
      {children}
    </div>
  );
}
export function ErrorState({ error }: { error: unknown }) {
  const isApi = error instanceof ApiError;
  const authHint = isApi && (error.status === 401 || error.code.includes('AUTHENTICATION'));
  return (
    <div className="m-3 flex items-start gap-2 rounded-md border border-danger/30 bg-danger/5 p-3 text-xs">
      <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-danger" />
      <div>
        <div className="font-medium text-danger">{isApi ? `${error.status} · ${error.code}` : 'Request failed'}</div>
        <div className="mt-0.5 text-muted">{error instanceof Error ? error.message : String(error)}</div>
        {authHint ? <div className="mt-1 text-muted">This endpoint requires a service token — set one in <a className="text-accent underline" href="/settings">Settings</a>.</div> : null}
      </div>
    </div>
  );
}
export function JsonView({ value, className }: { value: unknown; className?: string }) {
  return <pre className={cn('overflow-auto rounded-md border bg-subtle p-3 font-mono text-[11px] leading-relaxed text-fg/90', className)}>{JSON.stringify(value, null, 2)}</pre>;
}
export function Mono({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={cn('font-mono text-[12px]', className)}>{children}</span>;
}
export function KeyValue({ items }: { items: [string, React.ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[140px_1fr] gap-x-3 gap-y-1.5 text-xs">
      {items.map(([key, value]) => (
        <div key={key} className="contents"><dt className="text-muted">{key}</dt><dd className="min-w-0 break-all">{value ?? '—'}</dd></div>
      ))}
    </dl>
  );
}
