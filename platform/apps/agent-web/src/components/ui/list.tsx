import { Plus } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Linear list view primitives: group header rows + dense 38px rows, no separators. */
export function ListGroup({ icon, label, count, onAdd, children }: { icon?: React.ReactNode; label: React.ReactNode; count?: number; onAdd?: () => void; children: React.ReactNode }) {
  return (
    <section>
      <div className="sticky top-0 z-10 flex h-9 items-center gap-2 border-b border-line bg-panel gutter-x">
        {icon}
        <span className="text-[13px] font-medium tracking-[-0.01em] text-fg">{label}</span>
        {count !== undefined ? <span className="tabular text-[12.5px] text-faint">{count}</span> : null}
        {onAdd ? <button type="button" onClick={onAdd} className="ml-auto grid size-6 place-items-center rounded-md text-faint hover:bg-hover hover:text-fg"><Plus className="size-3.5" /></button> : null}
      </div>
      <div>{children}</div>
    </section>
  );
}

export function ListRow({ onClick, children, className, active }: { onClick?: (() => void) | undefined; children: React.ReactNode; className?: string; active?: boolean }) {
  return (
    <div
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={(e) => { if (onClick && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onClick(); } }}
      className={cn('group flex h-[38px] items-center gap-3 gutter-x text-[13px] outline-none transition-colors duration-75 focus-visible:bg-hover', onClick && 'cursor-default hover:bg-hover', active && 'bg-active', className)}
    >
      {children}
    </div>
  );
}

export function RowId({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={cn('w-[86px] shrink-0 truncate text-[12.5px] tabular-nums text-faint', className)}>{children}</span>;
}
export function RowTitle({ children, sub }: { children: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <span className="flex min-w-0 flex-1 items-baseline gap-2">
      <span className="truncate font-medium tracking-[-0.01em] text-fg">{children}</span>
      {sub ? <span className="truncate text-[12.5px] text-faint">{sub}</span> : null}
    </span>
  );
}
export function RowMeta({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={cn('flex shrink-0 items-center gap-2 text-[12px] text-muted', className)}>{children}</span>;
}
/** Linear label pill: hairline, colored dot. */
export function Pill({ children, color, className }: { children: React.ReactNode; color?: string; className?: string }) {
  return (
    <span className={cn('inline-flex h-[22px] max-w-[220px] items-center gap-1.5 rounded-full border border-line-strong px-2 text-[12px] text-fg-2', className)}>
      {color ? <span className="size-2 shrink-0 rounded-full" style={{ background: color }} /> : null}
      <span className="truncate">{children}</span>
    </span>
  );
}

export { DetailLayout } from '@/components/layout/page';
export function PropertyGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-5">
      <div className="mb-1.5 px-2 text-[12px] font-medium text-faint">{title}</div>
      <div className="flex flex-col">{children}</div>
    </div>
  );
}
export function Property({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid min-h-8 grid-cols-[96px_1fr] items-center gap-2 rounded-md px-2 py-1 text-[12.5px] hover:bg-hover">
      <span className="text-muted">{label}</span>
      <span className="flex min-w-0 items-center gap-1.5 break-all text-fg-2">{children ?? <span className="text-faint">—</span>}</span>
    </div>
  );
}
