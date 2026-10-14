import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, Command as CommandIcon, FlaskConical, Moon, Plus, Search, Sun } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router';
import { Kbd } from '@/components/ui/misc';
import { api } from '@/lib/api';
import { exitMock, isMock } from '@/lib/mock';
import { updateSettings, useSettings } from '@/lib/settings';
import { cn } from '@/lib/utils';
import { CommandPalette } from './command-palette';
import { navGroups, navItems } from './nav';

const goKeys: Record<string, string> = { o: '/overview', c: '/chat', t: '/tasks', a: '/apps', p: '/packages', s: '/schedules', m: '/providers', ',': '/settings' };

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
}

export function AppShell() {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => { try { return JSON.parse(localStorage.getItem('sage.agent-web.nav') ?? '{}') as Record<string, boolean>; } catch { return {}; } });
  const toggleGroup = (g: string) => setCollapsed((c) => { const next = { ...c, [g]: !c[g] }; localStorage.setItem('sage.agent-web.nav', JSON.stringify(next)); return next; });
  const navigate = useNavigate();
  const settings = useSettings();
  const pendingG = useRef(0);
  const health = useQuery({ queryKey: ['health'], queryFn: api.health, refetchInterval: 15_000, retry: false });
  const dark = typeof document !== 'undefined' && document.documentElement.classList.contains('dark');
  const online = health.isSuccess;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); setPaletteOpen((o) => !o); return; }
      if (isTyping(event.target) || event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === 'g') { pendingG.current = Date.now(); return; }
      if (Date.now() - pendingG.current < 1200) {
        const to = goKeys[event.key]; pendingG.current = 0;
        if (to) { event.preventDefault(); navigate(to); }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate]);

  return (
    <div className="flex h-full bg-frame p-0">
      {/* Sidebar — flush with frame, no border */}
      <aside className="flex w-[220px] shrink-0 flex-col bg-frame">
        <button
          type="button"
          onClick={() => setPaletteOpen(true)}
          className="mx-2 mt-2 flex h-8 items-center gap-2 rounded-md px-1.5 text-left transition-colors hover:bg-hover"
        >
          <div className="grid size-[18px] place-items-center rounded-[4px] bg-accent text-[10px] font-bold text-accent-fg">S</div>
          <span className="min-w-0 flex-1 truncate text-[13px] font-medium tracking-[-0.01em] text-fg">Sage</span>
          <ChevronDown className="size-3.5 text-faint" strokeWidth={1.75} />
        </button>

        <div className="mx-2 mt-1 flex items-center gap-0.5">
          <button type="button" onClick={() => setPaletteOpen(true)} className="flex h-7 flex-1 items-center gap-1.5 rounded-md px-1.5 text-[12.5px] text-muted transition-colors hover:bg-hover hover:text-fg">
            <Search className="size-3.5 text-faint" strokeWidth={1.75} />
            <span className="flex-1 text-left">Search</span>
            <Kbd className="gap-0"><CommandIcon className="size-2.5" />K</Kbd>
          </button>
          <button type="button" onClick={() => navigate('/chat?new=1')} className="grid size-7 place-items-center rounded-md text-faint transition-colors hover:bg-hover hover:text-fg" title="New session">
            <Plus className="size-3.5" strokeWidth={1.75} />
          </button>
        </div>

        <div className="mt-3 flex flex-1 flex-col gap-4 overflow-y-auto pb-2">
          {navGroups.map((group) => (
            <div key={group}>
              {group !== 'Workspace' ? (
                <button type="button" onClick={() => toggleGroup(group)} className="group/h mx-2 mb-0.5 flex h-6 w-[calc(100%-16px)] items-center gap-1 rounded-md px-1.5 text-[11.5px] font-medium text-faint hover:bg-hover hover:text-muted">
                  {group}
                  <ChevronRight className={cn('size-3 opacity-0 transition-transform group-hover/h:opacity-100', !collapsed[group] && 'rotate-90')} />
                </button>
              ) : null}
              <nav className={cn('flex flex-col gap-px px-2', collapsed[group] && 'hidden')}>
                {navItems.filter((i) => i.group === group).map(({ to, label, icon: Icon }) => (
                  <NavLink
                    key={to}
                    to={to}
                    className={({ isActive }) => cn(
                      'group flex h-[30px] items-center gap-2 rounded-md px-2 text-[13px] font-medium tracking-[-0.01em] text-muted transition-colors hover:bg-hover hover:text-fg',
                      isActive && 'bg-active text-fg'
                    )}
                  >
                    {({ isActive }) => (
                      <>
                        <Icon className={cn('size-[15px]', isActive ? 'text-fg' : 'text-faint group-hover:text-muted')} strokeWidth={1.6} />
                        <span className="truncate">{label}</span>
                      </>
                    )}
                  </NavLink>
                ))}
              </nav>
            </div>
          ))}
        </div>

        {isMock() ? (
          <button type="button" onClick={exitMock} title="Demo data — click to exit mock mode" className="mx-2 mb-1 flex h-7 items-center gap-1.5 rounded-md border border-dashed border-line-strong px-2 text-[11.5px] text-muted hover:bg-hover hover:text-fg">
            <FlaskConical className="size-3.5 text-amber" strokeWidth={1.75} />Mock data · read-only<span className="ml-auto text-faint">Exit</span>
          </button>
        ) : null}
        <div className="flex items-center gap-1 px-2.5 py-2">
          <span className="flex min-w-0 flex-1 items-center gap-1.5 px-1 text-[11.5px] text-faint" title={settings.apiBaseUrl || 'same-origin'}>
            <span className={cn('size-1.5 rounded-full', online ? 'bg-green' : health.isLoading ? 'bg-faint' : 'bg-red')} />
            <span className="truncate">{online ? 'Online' : health.isLoading ? '…' : 'Offline'}</span>
          </span>
          <button type="button" className="grid size-7 place-items-center rounded-md text-faint hover:bg-hover hover:text-fg" onClick={() => updateSettings({ theme: dark ? 'light' : 'dark' })}>
            {dark ? <Sun className="size-3.5" strokeWidth={1.6} /> : <Moon className="size-3.5" strokeWidth={1.6} />}
          </button>
        </div>
      </aside>

      {/* Inset panel — the Linear signature */}
      <div className="flex min-w-0 flex-1 flex-col py-2 pr-2">
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[14px] bg-panel shadow-card">
          <Outlet />
        </div>
      </div>

      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </div>
  );
}

/** Toolbar inside the inset panel (Linear view bar). */
export function PanelBar({ left, right }: { left?: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="flex h-11 shrink-0 items-center gap-2 border-b border-line pl-6 pr-3">
      <div className="flex min-w-0 flex-1 items-center gap-1.5">{left}</div>
      {right ? <div className="flex shrink-0 items-center gap-1">{right}</div> : null}
    </div>
  );
}

export function ViewTab({ active, children, onClick }: { active?: boolean; children: React.ReactNode; onClick?: () => void }) {
  return (
    <button type="button" onClick={onClick} className={cn('h-6 rounded-md px-2 text-[12.5px] font-medium tracking-[-0.01em] transition-colors', active ? 'bg-active text-fg' : 'text-muted hover:bg-hover hover:text-fg')}>
      {children}
    </button>
  );
}

export function PageHeader({ title, meta, actions, breadcrumb }: { title: React.ReactNode; meta?: React.ReactNode; actions?: React.ReactNode; breadcrumb?: React.ReactNode }) {
  return (
    <PanelBar
      left={<>{breadcrumb}<h1 className="truncate text-[13px] font-medium tracking-[-0.01em] text-fg">{title}</h1>{meta ? <div className="flex items-center gap-2 text-xs text-muted">{meta}</div> : null}</>}
      right={actions}
    />
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
