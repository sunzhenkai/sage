import { useQuery } from '@tanstack/react-query';
import { Command as CommandIcon, Moon, Search, Sun } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router';
import { Kbd } from '@/components/ui/misc';
import { api } from '@/lib/api';
import { updateSettings, useSettings } from '@/lib/settings';
import { cn } from '@/lib/utils';
import { CommandPalette } from './command-palette';
import { navItems } from './nav';

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

  const dark = document.documentElement.classList.contains('dark');
  const online = health.isSuccess;

  return (
    <div className="flex h-full">
      <aside className="flex w-[220px] shrink-0 flex-col border-r bg-subtle/60">
        <div className="flex h-11 items-center gap-2 px-3">
          <div className="grid size-5 place-items-center rounded bg-accent text-[11px] font-bold text-accent-fg">S</div>
          <span className="text-[13px] font-semibold">Sage Console</span>
        </div>
        <button onClick={() => setPaletteOpen(true)} className="mx-2 mb-2 flex h-7 items-center gap-2 rounded-md border bg-panel px-2 text-xs text-muted hover:text-fg">
          <Search className="size-3.5" />Search…<span className="ml-auto flex gap-0.5"><Kbd><CommandIcon className="size-2.5" /></Kbd><Kbd>K</Kbd></span>
        </button>
        <nav className="flex flex-col gap-px px-2">
          {navItems.map(({ to, label, icon: Icon }) => (
            <NavLink key={to} to={to} className={({ isActive }) => cn('flex h-7 items-center gap-2 rounded-md px-2 text-[13px] text-muted transition-colors hover:bg-hover hover:text-fg', isActive && 'bg-hover font-medium text-fg')}>
              <Icon className="size-3.5" />{label}
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto flex items-center justify-between border-t px-3 py-2 text-[11px] text-muted">
          <span className="flex items-center gap-1.5" title={settings.apiBaseUrl || 'same-origin proxy'}>
            <span className={cn('size-1.5 rounded-full', online ? 'bg-success' : health.isLoading ? 'bg-muted' : 'bg-danger')} />
            agent-api {online ? 'online' : health.isLoading ? '…' : 'offline'}
          </span>
          <button className="rounded p-1 hover:bg-hover hover:text-fg" title="Toggle theme" onClick={() => updateSettings({ theme: dark ? 'light' : 'dark' })}>
            {dark ? <Sun className="size-3.5" /> : <Moon className="size-3.5" />}
          </button>
        </div>
      </aside>
      <main className="flex min-w-0 flex-1 flex-col"><Outlet /></main>
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </div>
  );
}

export function PageHeader({ title, meta, actions }: { title: React.ReactNode; meta?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <header className="flex h-11 shrink-0 items-center gap-3 border-b px-4">
      <h1 className="truncate text-[13px] font-medium">{title}</h1>
      {meta ? <div className="flex items-center gap-2 text-xs text-muted">{meta}</div> : null}
      <div className="ml-auto flex items-center gap-1.5">{actions}</div>
    </header>
  );
}
