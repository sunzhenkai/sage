import { useQuery } from '@tanstack/react-query';
import { Command as CommandIcon, Moon, Search, Sun } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router';
import { Kbd } from '@/components/ui/misc';
import { api } from '@/lib/api';
import { updateSettings, useSettings } from '@/lib/settings';
import { cn } from '@/lib/utils';
import { CommandPalette } from './command-palette';
import { navGroups, navItems } from './nav';

const goKeys: Record<string, string> = { c: '/chat', t: '/tasks', a: '/apps', p: '/packages', s: '/schedules', m: '/providers', ',': '/settings' };

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
}

export function AppShell() {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const navigate = useNavigate();
  const settings = useSettings();
  const pendingG = useRef(0);
  const health = useQuery({ queryKey: ['health'], queryFn: api.health, refetchInterval: 15_000, retry: false });

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); setPaletteOpen((open) => !open); return; }
      if (isTyping(event.target) || event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === 'g') { pendingG.current = Date.now(); return; }
      if (Date.now() - pendingG.current < 1200) {
        const to = goKeys[event.key];
        pendingG.current = 0;
        if (to) { event.preventDefault(); navigate(to); }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate]);

  const dark = typeof document !== 'undefined' && document.documentElement.classList.contains('dark');
  const online = health.isSuccess;

  return (
    <div className="flex h-full bg-frame">
      <aside className="flex w-[220px] shrink-0 flex-col border-r border-line bg-frame">
        <div className="flex h-12 items-center gap-2.5 px-3.5">
          <div className="grid size-[22px] place-items-center rounded-[6px] bg-accent text-[11px] font-bold tracking-tight text-accent-fg shadow-[inset_0_1px_0_rgb(255_255_255/0.18)]">S</div>
          <div className="min-w-0 leading-tight">
            <div className="truncate text-[13px] font-semibold tracking-[-0.02em]">Sage</div>
            <div className="truncate text-[11px] text-faint">Agent Console</div>
          </div>
        </div>

        <button
          onClick={() => setPaletteOpen(true)}
          className="mx-2.5 mb-2 flex h-8 items-center gap-2 rounded-md border border-line bg-panel/60 px-2 text-[12.5px] text-muted transition-colors hover:bg-hover hover:text-fg"
        >
          <Search className="size-3.5 text-faint" strokeWidth={1.75} />
          <span className="flex-1 text-left">Search…</span>
          <span className="flex items-center gap-0.5"><Kbd className="gap-0.5"><CommandIcon className="size-2.5" />K</Kbd></span>
        </button>

        <div className="flex flex-col gap-4 overflow-y-auto pt-1">
          {navGroups.map((group) => (
            <div key={group}>
              <div className="px-3.5 pb-1 text-[11px] font-medium text-faint">{group}</div>
              <nav className="flex flex-col gap-px px-2">
                {navItems.filter((item) => item.group === group).map(({ to, label, icon: Icon }) => (
                  <NavLink
                    key={to}
                    to={to}
                    className={({ isActive }) => cn(
                      'group flex h-[30px] items-center gap-2.5 rounded-md px-2 text-[13px] font-medium tracking-[-0.01em] text-muted transition-colors duration-100 hover:bg-hover hover:text-fg',
                      isActive && 'bg-active text-fg'
                    )}
                  >
                    {({ isActive }) => (
                      <>
                        <Icon className={cn('size-[15px] shrink-0', isActive ? 'text-fg' : 'text-faint group-hover:text-muted')} strokeWidth={1.75} />
                        <span className="truncate">{label}</span>
                      </>
                    )}
                  </NavLink>
                ))}
              </nav>
            </div>
          ))}
        </div>

        <div className="mt-auto flex items-center gap-1.5 border-t border-line px-3 py-2.5">
          <span className="flex min-w-0 flex-1 items-center gap-1.5 text-[11.5px] text-muted" title={settings.apiBaseUrl || 'same-origin proxy'}>
            <span className={cn('size-1.5 shrink-0 rounded-full', online ? 'bg-green' : health.isLoading ? 'bg-faint' : 'bg-red', online && 'shadow-[0_0_0_3px_color-mix(in_srgb,var(--green)_25%,transparent)]')} />
            <span className="truncate">{online ? 'API online' : health.isLoading ? 'Connecting…' : 'API offline'}</span>
          </span>
          <button
            className="grid size-7 place-items-center rounded-md text-faint transition-colors hover:bg-hover hover:text-fg"
            title="Toggle theme"
            onClick={() => updateSettings({ theme: dark ? 'light' : 'dark' })}
          >
            {dark ? <Sun className="size-3.5" strokeWidth={1.75} /> : <Moon className="size-3.5" strokeWidth={1.75} />}
          </button>
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col overflow-hidden bg-panel">
        <Outlet />
      </main>
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </div>
  );
}

export function PageHeader({
  title, meta, actions, breadcrumb
}: {
  title: React.ReactNode; meta?: React.ReactNode; actions?: React.ReactNode; breadcrumb?: React.ReactNode;
}) {
  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-line px-5">
      <div className="flex min-w-0 flex-1 items-center gap-2.5">
        {breadcrumb}
        <h1 className="truncate text-[14px] font-semibold tracking-[-0.02em] text-fg">{title}</h1>
        {meta ? <div className="flex shrink-0 items-center gap-2 text-xs text-muted">{meta}</div> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-1.5">{actions}</div> : null}
    </header>
  );
}

export function Crumb({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <>
      <NavLink to={to} className="text-[13px] font-medium text-muted transition-colors hover:text-fg">{children}</NavLink>
      <span className="text-faint">/</span>
    </>
  );
}
