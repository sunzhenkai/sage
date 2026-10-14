import { cn } from '@/lib/utils';

/**
 * Layout primitives. Gutter = 24px (px-6) everywhere so toolbar text, list rows and section headings align.
 *  - full:     list views, edge-to-edge rows with 24px gutters
 *  - reading:  detail main column, max 760px centered
 *  - settings: settings/forms, max 680px centered
 *  - wide:     dashboards, max 1200px centered
 */
const widths = { full: '', reading: 'mx-auto w-full max-w-[760px]', settings: 'mx-auto w-full max-w-[680px]', wide: 'mx-auto w-full max-w-[1200px]' } as const;
export type ContentWidth = keyof typeof widths;

export function PageBody({ width = 'full', className, children }: { width?: ContentWidth; className?: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className={cn(widths[width], width === 'full' ? '' : 'px-6 pb-16 pt-10', className)}>{children}</div>
    </div>
  );
}

export function PageTitle({ title, description, icon, actions }: { title: React.ReactNode; description?: React.ReactNode; icon?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="mb-8 flex items-start gap-3">
      <div className="min-w-0 flex-1">
        {icon ? <div className="mb-3">{icon}</div> : null}
        <h1 className="text-[20px] font-semibold leading-7 tracking-[-0.02em] text-fg">{title}</h1>
        {description ? <p className="mt-1 text-[13px] leading-5 text-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-1.5 pt-0.5">{actions}</div> : null}
    </div>
  );
}

export function SectionHeading({ title, count, actions, className }: { title: React.ReactNode; count?: number; actions?: React.ReactNode; className?: string }) {
  return (
    <div className={cn('mb-2 mt-9 flex h-7 items-center gap-2 first:mt-0', className)}>
      <h2 className="text-[13px] font-medium tracking-[-0.01em] text-fg">{title}</h2>
      {count !== undefined ? <span className="tabular text-[12.5px] text-faint">{count}</span> : null}
      {actions ? <div className="ml-auto flex items-center gap-1">{actions}</div> : null}
    </div>
  );
}

/** Linear settings group: bordered container with hairline-divided rows. */
export function SettingsGroup({ title, description, children }: { title?: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="mb-10">
      {title ? <h2 className="text-[13px] font-medium tracking-[-0.01em] text-fg">{title}</h2> : null}
      {description ? <p className="mt-0.5 text-[12.5px] text-muted">{description}</p> : null}
      <div className={cn('divide-y divide-line overflow-hidden rounded-[10px] border border-line bg-tile', title ? 'mt-3' : '')}>{children}</div>
    </section>
  );
}
export function SettingsRow({ label, description, children, stacked }: { label: React.ReactNode; description?: React.ReactNode; children?: React.ReactNode; stacked?: boolean }) {
  return (
    <div className={cn('flex gap-4 px-4 py-3.5', stacked ? 'flex-col' : 'items-center')}>
      <div className="min-w-0 flex-1">
        <div className="text-[13px] text-fg">{label}</div>
        {description ? <div className="mt-0.5 text-[12px] leading-[17px] text-muted">{description}</div> : null}
      </div>
      {children ? <div className={cn('flex items-center gap-2', stacked ? 'w-full' : 'shrink-0')}>{children}</div> : null}
    </div>
  );
}
