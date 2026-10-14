/**
 * Layout primitives — the only place that decides backgrounds, gutters and widths (see DESIGN.md).
 * Everything is FULL WIDTH inside the panel; one gutter (--gutter, 24px) for header, description and content.
 * Header, description and content all sit on the same surface (bg-panel). Cards are opt-in (charts, code, flows).
 */
import { cn } from '@/lib/utils';
export { PageHeader, PanelBar as PageToolbar, Crumb, ViewTab } from './app-shell';

export function PageShell({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('flex min-h-0 min-w-0 flex-1 flex-col bg-panel', className)}>{children}</div>;
}

/** Page title + description band. Same bg as header/content; no border. */
export function PageDescription({ title, description, leading, actions }: { title: React.ReactNode; description?: React.ReactNode; leading?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 pb-6">
      {leading ? <div className="shrink-0 pt-0.5">{leading}</div> : null}
      <div className="min-w-0 flex-1">
        <h1 className="t-title truncate">{title}</h1>
        {description ? <p className="t-desc mt-1">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-1.5">{actions}</div> : null}
    </div>
  );
}

/** Scrollable content area. `flush` = edge-to-edge (lists/tables own their gutters); default pads with the gutter. */
export function PageContent({ children, flush, className, scrollRef }: { children: React.ReactNode; flush?: boolean; className?: string; scrollRef?: React.Ref<HTMLDivElement> }) {
  return (
    <div ref={scrollRef} className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className={cn(flush ? 'flex min-h-0 flex-1 flex-col' : 'gutter-x pb-12 pt-6', className)}>{children}</div>
    </div>
  );
}

/** Plain section: heading + optional description; no background, no border. */
export function Section({ title, description, count, actions, children, className }: { title?: React.ReactNode; description?: React.ReactNode; count?: React.ReactNode; actions?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn('mt-8 first:mt-0', className)}>
      {title ? (
        <div className="mb-3 flex min-h-7 items-center gap-2">
          <div className="min-w-0 flex-1">
            <h2 className="t-section flex items-center gap-2">{title}{count !== undefined ? <span className="t-meta font-normal tabular-nums">{count}</span> : null}</h2>
            {description ? <p className="t-meta mt-0.5">{description}</p> : null}
          </div>
          {actions ? <div className="flex shrink-0 items-center gap-1">{actions}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

/** Settings section: full width, hairline-divided rows with a fixed label column. No card. */
export function SettingsGroup({ title, description, children }: { title?: string; description?: string; children: React.ReactNode }) {
  return (
    <Section title={title} description={description}>
      <div className="divide-y divide-line border-y border-line">{children}</div>
    </Section>
  );
}
export function SettingsRow({ label, description, children, stacked }: { label: React.ReactNode; description?: React.ReactNode; children?: React.ReactNode; stacked?: boolean }) {
  return (
    <div className={cn('grid gap-x-8 gap-y-2 py-3.5', stacked ? 'grid-cols-1' : 'grid-cols-[minmax(200px,280px)_minmax(0,1fr)] items-center')}>
      <div className="min-w-0">
        <div className="text-[13px] font-medium text-ink">{label}</div>
        {description ? <div className="t-meta mt-0.5">{description}</div> : null}
      </div>
      {children ? <div className={cn('flex min-w-0 items-center gap-2', !stacked && 'justify-end')}>{children}</div> : null}
    </div>
  );
}

/** Segmented tabs (Beautiful UI chat-composer tabs). */
export function SegmentedTabs<T extends string>({ value, onChange, items, className }: { value: T; onChange: (v: T) => void; items: { value: T; label: React.ReactNode }[]; className?: string }) {
  return (
    <div className={cn('flex w-fit items-center rounded-control bg-surface p-1 shadow-card', className)}>
      {items.map((it) => (
        <button key={it.value} type="button" aria-pressed={value === it.value} onClick={() => onChange(it.value)} className={cn('rounded-[6px] px-2.5 py-[3px] text-[13px] text-ink transition-[background-color,opacity] duration-100', value === it.value ? 'bg-field' : 'opacity-50 hover:opacity-75')}>
          {it.label}
        </button>
      ))}
    </div>
  );
}

/** Full-width two-column detail: flexible main + fixed properties aside, same surface, hairline divider. */
export function DetailLayout({ children, properties }: { children: React.ReactNode; properties: React.ReactNode }) {
  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">{children}</div>
      <aside className="w-[var(--aside-w)] shrink-0 overflow-y-auto border-l border-line px-4 py-6">{properties}</aside>
    </div>
  );
}

/** Small "empty/quiet" text line used inside content. */
export function Quiet({ children }: { children: React.ReactNode }) {
  return <p className="t-desc py-6">{children}</p>;
}

/** Lets a full-bleed list (rows with their own gutter) sit inside padded content, aligned to the gutter. */
export function Bleed({ children }: { children: React.ReactNode }) {
  return <div className="-mx-[var(--gutter)]">{children}</div>;
}
