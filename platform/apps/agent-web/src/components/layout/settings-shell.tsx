import { Search } from 'lucide-react';
import { NavLink } from 'react-router';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { PageHeader, PanelBar } from './app-shell';
import { contentCard, SubPane } from './page';

export type SettingsNavItem = { to: string; label: string; icon: React.ComponentType<{ className?: string; strokeWidth?: number }>; external?: boolean };

/** Settings pattern: sub-nav column (248px, same panel bg as content, hairline divider) | centered 760px content. No top header. */
export function SettingsShell({ groups, header, children }: { groups: { label: string; items: SettingsNavItem[] }[]; header: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex min-h-0 flex-1">
      <SubPane>
        <PageHeader title="Settings" />
        <div className="flex-1 overflow-y-auto px-2.5 pb-4 pt-2">
          {groups.map((g) => (
            <div key={g.label} className="mt-3 first:mt-1">
              <div className="px-2 pb-1 text-[11.5px] font-medium text-faint">{g.label}</div>
              <nav className="flex flex-col gap-px">
                {g.items.map(({ to, label, icon: Icon, external }) => (
                  <NavLink key={to} to={to} end={!external} className={({ isActive }) => cn('flex h-[30px] items-center gap-2 rounded-md px-2 text-[13px] font-medium text-muted transition-colors hover:bg-hover hover:text-fg', isActive && !external && 'bg-accent-tint font-semibold text-accent-ink hover:bg-accent-tint hover:text-accent-ink')}>
                    {({ isActive }) => <><Icon className={cn('size-[15px] shrink-0', isActive && !external ? 'text-accent' : 'text-faint')} strokeWidth={isActive && !external ? 2 : 1.6} /><span className="flex-1 truncate">{label}</span>{external ? <span className="text-[11px] text-faint">↗</span> : null}</>}
                  </NavLink>
                ))}
              </nav>
            </div>
          ))}
        </div>
      </SubPane>
      <div className="flex min-w-0 flex-1 flex-col">
        <PanelBar left={<span className="truncate text-[13px] font-medium tracking-[-0.01em] text-fg">{header}</span>} />
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-[calc(var(--w-settings)+2*var(--gutter))] px-[var(--gutter)] pb-12 pt-6">{children}</div>
        </div>
      </div>
    </div>
  );
}

/** Title row aligned with the sub-nav "Settings" title (h-9), grey one-line description, optional toolbar. */
export function SettingsTitle({ title, description, toolbar }: { title: React.ReactNode; description?: React.ReactNode; toolbar?: React.ReactNode }) {
  return (
    <div className="mb-6">
      <h1 className="flex h-9 items-center text-[22px] font-semibold tracking-[-0.02em] text-ink">{title}</h1>
      {description ? <p className="t-desc">{description}</p> : null}
      {toolbar ? <div className="mt-5 flex items-center gap-2">{toolbar}</div> : null}
    </div>
  );
}

export function SettingsCard({ title, children }: { title?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="mt-6 first:mt-0">
      {title ? <h2 className="mb-2 px-0.5 text-[12px] font-semibold text-muted">{title}</h2> : null}
      <div className={cn(contentCard, 'divide-y divide-line')}>{children}</div>
    </section>
  );
}

/** Row: title + description left, control right-aligned. */
export function SettingsItem({ title, description, children, stacked }: { title: React.ReactNode; description?: React.ReactNode; children?: React.ReactNode; stacked?: boolean }) {
  return (
    <div className={cn('flex gap-6 px-4 py-3', stacked ? 'flex-col gap-2' : 'items-center justify-between')}>
      <div className="min-w-0">
        <div className="text-[13px] font-medium text-ink">{title}</div>
        {description ? <div className="t-meta mt-0.5">{description}</div> : null}
      </div>
      {children ? <div className={cn('flex min-w-0 shrink-0 items-center gap-2', !stacked && 'justify-end')}>{children}</div> : null}
    </div>
  );
}

export function SettingsSearch({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <div className="relative w-[260px]">
      <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-faint" strokeWidth={1.75} />
      <Input aria-label="Search settings" placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} className="pl-8" />
    </div>
  );
}

export function SettingsEmpty({ q }: { q: string }) {
  return <p className="t-desc rounded-card bg-surface px-4 py-6 text-center shadow-card">No settings match “{q}”.</p>;
}

export function SettingsFooter({ children }: { children: React.ReactNode }) {
  return <div className="flex items-center justify-end gap-2 px-4 py-2.5">{children}</div>;
}
