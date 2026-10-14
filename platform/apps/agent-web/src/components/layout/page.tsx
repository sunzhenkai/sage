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
export type ContentWidth = 'full' | 'narrow' | 'chat';
const widthClass: Record<ContentWidth, string> = { full: '', narrow: 'mx-auto w-full max-w-[calc(var(--w-narrow)+2*var(--gutter))]', chat: 'mx-auto w-full max-w-[calc(var(--w-chat)+2*var(--gutter))]' };

/** Centered column for reading/form pages (settings, chat). Only allowed widths: narrow (720) / chat (760). */
export function PageColumn({ width = 'full', className, children }: { width?: ContentWidth | undefined; className?: string | undefined; children: React.ReactNode }) {
  return <div className={cn('gutter-x', widthClass[width], className)}>{children}</div>;
}

export function PageContent({ children, flush, width = 'full', className, scrollRef }: { children: React.ReactNode; flush?: boolean; width?: ContentWidth | undefined; className?: string; scrollRef?: React.Ref<HTMLDivElement> }) {
  return (
    <div ref={scrollRef} className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className={cn(flush ? 'flex min-h-0 flex-1 flex-col' : cn('gutter-x pb-12 pt-6', widthClass[width]), className)}>{children}</div>
    </div>
  );
}

/** Content card: 1px line ring, white (light) / raised (dark), radius 10, near-zero shadow. */
export const contentCard = 'overflow-hidden rounded-card bg-surface shadow-card';

/**
 * Section = three roles: title (t-section, ink) + description (t-desc, ink-2) on the page bg,
 * then content — inside a bordered card when `card` (preferred) or bare when the children are already cards.
 */
export function Section({ title, description, count, actions, children, className, card, padded }: { title?: React.ReactNode; description?: React.ReactNode; count?: React.ReactNode; actions?: React.ReactNode; children: React.ReactNode; className?: string | undefined; card?: boolean | undefined; padded?: boolean | undefined }) {
  return (
    <section className={cn('mt-8 first:mt-0', className)}>
      {title ? (
        <div className="mb-3 flex min-h-7 items-center gap-2">
          <div className="min-w-0 flex-1">
            <h2 className="t-section flex items-center gap-2">{title}{count !== undefined ? <span className="t-meta font-normal tabular-nums">{count}</span> : null}</h2>
            {description ? <p className="t-desc mt-0.5">{description}</p> : null}
          </div>
          {actions ? <div className="flex shrink-0 items-center gap-1">{actions}</div> : null}
        </div>
      ) : null}
      {card ? <div className={cn(contentCard, padded && 'p-4')}>{children}</div> : children}
    </section>
  );
}

/** Settings section: title + description, then a card of hairline-divided rows with a label column. */
export function SettingsGroup({ title, description, children }: { title?: string; description?: string; children: React.ReactNode }) {
  return (
    <Section title={title} description={description} card>
      <div className="divide-y divide-line">{children}</div>
    </Section>
  );
}
/** Fixed-height pane whose content scrolls INSIDE a bordered content card (chat transcript). Fills remaining height. */
export function CardPane({ width = 'full', scrollRef, children }: { width?: ContentWidth | undefined; scrollRef?: React.Ref<HTMLDivElement> | undefined; children: React.ReactNode }) {
  return (
    <div className={cn('flex min-h-0 w-full flex-1 flex-col pt-4 gutter-x', widthClass[width])}>
      <div ref={scrollRef} className={cn(contentCard, 'min-h-0 flex-1 overflow-y-auto')}>
        <div className="px-6 py-6">{children}</div>
      </div>
    </div>
  );
}

/** Free-form row inside a content card (same inset as SettingsRow). */
export function CardRow({ children, className }: { children: React.ReactNode; className?: string | undefined }) {
  return <div className={cn('flex items-center gap-3 px-4 py-3', className)}>{children}</div>;
}
export function SettingsRow({ label, description, children, stacked }: { label: React.ReactNode; description?: React.ReactNode; children?: React.ReactNode; stacked?: boolean }) {
  return (
    <div className={cn('grid gap-x-8 gap-y-2 px-4 py-3.5', stacked ? 'grid-cols-1' : 'grid-cols-[minmax(160px,220px)_minmax(0,1fr)] items-center')}>
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
        <button key={it.value} type="button" aria-pressed={value === it.value} onClick={() => onChange(it.value)} className={cn('rounded-[6px] px-2.5 py-[3px] text-[13px] text-ink transition-[background-color,opacity] duration-100', value === it.value ? 'bg-hover-2' : 'opacity-50 hover:opacity-75')}>
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
  return <p className="t-desc rounded-card bg-surface px-4 py-6 text-center shadow-card">{children}</p>;
}

/** Lets a full-bleed list (rows with their own gutter) sit inside padded content, aligned to the gutter. */
export function Bleed({ children }: { children: React.ReactNode }) {
  return <div className="-mx-[var(--gutter)]">{children}</div>;
}
