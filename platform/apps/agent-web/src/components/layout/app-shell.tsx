import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, Command as CommandIcon, FileQuestion, FlaskConical, Moon, PanelLeftClose, PanelLeftOpen, Plus, Search, Sun } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { Kbd } from '@/components/ui/misc';
import { api } from '@/lib/api';
import { exitMock, isMock } from '@/lib/mock';
import { useT } from '@/lib/i18n';
import { updateSettings, useSettings } from '@/lib/settings';
import { cn } from '@/lib/utils';
import { SageMark } from '@/components/brand/sage-mark';
import { goKeyMap } from '@/lib/shortcuts';
import { CommandPalette } from './command-palette';
import { navGroups, navItems } from './nav';


function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
}

export function AppShell() {
  const t = useT();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => { try { return JSON.parse(localStorage.getItem('sage.agent-web.nav') ?? '{}') as Record<string, boolean>; } catch { return {}; } });
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem('sage.agent-web.sidebar') === '1');
  const toggleSidebar = () => setSidebarCollapsed((v) => { const next = !v; localStorage.setItem('sage.agent-web.sidebar', next ? '1' : '0'); return next; });
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
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'b') { event.preventDefault(); toggleSidebar(); return; }
      if (!isTyping(event.target) && !event.metaKey && !event.ctrlKey && !event.altKey && event.key === '[') { event.preventDefault(); toggleSidebar(); return; }
      if (isTyping(event.target) || event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === 'g') { pendingG.current = Date.now(); return; }
      if (Date.now() - pendingG.current < 1200) {
        const to = goKeyMap()[event.key.toLowerCase()]; pendingG.current = 0;
        if (to) { event.preventDefault(); navigate(to); }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate, sidebarCollapsed]);

  return (
    <div className="flex h-full bg-frame p-0">
      {/* Sidebar — flush with frame, no border */}
      <aside className={cn("flex shrink-0 flex-col bg-frame transition-[width] duration-200 ease-out", sidebarCollapsed ? "w-[56px]" : "w-[220px]")}>
        <div className={cn('mx-2 mt-2 flex h-8 items-center gap-1', sidebarCollapsed && 'justify-center')}>
          <button type="button" onClick={() => setPaletteOpen(true)} className={cn('flex h-8 min-w-0 items-center gap-2 rounded-md px-1.5 text-left transition-colors hover:bg-hover', sidebarCollapsed ? 'size-8 justify-center px-0' : 'flex-1')} title="Sage">
            <SageMark className="size-[18px] text-accent" />
            {!sidebarCollapsed ? <><span className="min-w-0 flex-1 truncate text-[13px] font-medium tracking-[-0.01em] text-fg">Sage</span><ChevronDown className="size-3.5 text-faint" strokeWidth={1.75} /></> : null}
          </button>
          {!sidebarCollapsed ? <button type="button" onClick={toggleSidebar} title={t('appShell.collapseSidebar')} className="grid size-7 shrink-0 place-items-center rounded-md text-faint hover:bg-hover hover:text-fg"><PanelLeftClose className="size-3.5" strokeWidth={1.6} /></button> : null}
        </div>

        <div className={cn('mx-2 mt-1 flex items-center gap-0.5', sidebarCollapsed && 'flex-col')}>
          <button type="button" onClick={() => setPaletteOpen(true)} title={t('appShell.search')} data-nav-search className={cn('flex items-center gap-2 rounded-md text-[13px] font-medium text-muted transition-colors hover:bg-hover hover:text-fg', sidebarCollapsed ? 'size-8 justify-center px-0' : 'h-[30px] flex-1 px-2')}>
            <Search className="size-[15px] shrink-0 text-faint" strokeWidth={1.6} />
            {!sidebarCollapsed ? <><span className="flex-1 text-left">{t('common.search')}</span><Kbd className="gap-0"><CommandIcon className="size-2.5" />K</Kbd></> : null}
          </button>
          <button type="button" onClick={() => navigate('/chat?new=1')} className={cn('grid place-items-center rounded-md text-faint transition-colors hover:bg-hover hover:text-fg', sidebarCollapsed ? 'size-8' : 'size-7')} title={t('chat.newSession')}>
            <Plus className="size-3.5" strokeWidth={1.75} />
          </button>
          {sidebarCollapsed ? <button type="button" onClick={toggleSidebar} title={t('appShell.expandSidebar')} className="grid size-8 place-items-center rounded-md text-faint hover:bg-hover hover:text-fg"><PanelLeftOpen className="size-3.5" strokeWidth={1.6} /></button> : null}
        </div>

        <div className={cn('mt-3 flex flex-1 flex-col gap-4 pb-2', sidebarCollapsed ? 'mx-2 items-center overflow-hidden' : 'overflow-y-auto')}>
          {navGroups.map((group) => (
            <div key={group.key} className={cn(sidebarCollapsed && 'flex flex-col items-center')}>
              {group.key !== 'workspace' && !sidebarCollapsed ? (
                <button type="button" onClick={() => toggleGroup(group.key)} className="group/h mx-2 mb-0.5 flex h-6 w-[calc(100%-16px)] items-center gap-1 rounded-md px-1.5 text-[11.5px] font-medium text-faint hover:bg-hover hover:text-muted">
                  {t(group.labelKey)}
                  <ChevronRight className={cn('size-3 opacity-0 transition-transform group-hover/h:opacity-100', !collapsed[group.key] && 'rotate-90')} />
                </button>
              ) : null}
              <nav className={cn('flex flex-col gap-px', sidebarCollapsed ? 'items-center' : 'px-2', collapsed[group.key] && !sidebarCollapsed && 'hidden')}>
                {navItems.filter((i) => i.group === group.key).map(({ to, labelKey, icon: Icon }) => (
                  <NavLink
                    key={to}
                    to={to}
                    title={t(labelKey)}
                    className={({ isActive }) => cn(
                      'group flex items-center rounded-md text-[13px] font-medium tracking-[-0.01em] text-muted transition-colors hover:bg-hover hover:text-fg',
                      sidebarCollapsed ? 'size-8 shrink-0 justify-center gap-0 p-0' : 'relative h-[30px] gap-2 px-2',
                      isActive && 'bg-accent-tint font-semibold text-accent-ink ring-1 ring-inset ring-accent/45 hover:bg-accent-tint hover:text-accent-ink',
                      isActive && !sidebarCollapsed && 'before:absolute before:inset-y-[6px] before:left-0 before:w-[3px] before:rounded-full before:bg-accent' 
                    )}
                  >
                    {({ isActive }) => (
                      <>
                        <Icon className={cn('size-[15px] shrink-0', isActive ? 'text-accent' : 'text-faint group-hover:text-muted')} strokeWidth={isActive ? 2 : 1.6} />
                        <span className={cn('truncate', sidebarCollapsed && 'hidden')}>{t(labelKey)}</span>
                      </>
                    )}
                  </NavLink>
                ))}
              </nav>
            </div>
          ))}
        </div>

        {isMock() ? (
          <button type="button" onClick={exitMock} title={t('appShell.mockTitle')} className={cn('mb-1 flex items-center gap-1.5 rounded-md border border-dashed border-line-strong text-[11.5px] text-muted hover:bg-hover hover:text-fg', sidebarCollapsed ? 'mx-auto size-8 justify-center px-0' : 'mx-2 h-7 px-2')}>
            <FlaskConical className="size-3.5 shrink-0 text-amber" strokeWidth={1.75} />{!sidebarCollapsed ? <>{t('appShell.mockLabel')}<span className="ml-auto text-faint">{t('appShell.mockExit')}</span></> : null}
          </button>
        ) : null}
        <div className={cn('flex items-center gap-1 py-2', sidebarCollapsed ? 'mx-2 flex-col items-center' : 'px-2.5')}>
          <span className={cn('flex items-center gap-1.5 text-[11.5px] text-faint', sidebarCollapsed ? 'justify-center' : 'min-w-0 flex-1 px-1')} title={settings.apiBaseUrl || t('appShell.sameOrigin')}>
            <span className={cn('size-1.5 rounded-full', online ? 'bg-green' : health.isLoading ? 'bg-faint' : 'bg-red')} />
            {!sidebarCollapsed ? <span className="truncate">{online ? t('appShell.online') : health.isLoading ? '…' : t('appShell.offline')}</span> : null}
          </span>
          <button type="button" title={t('appShell.toggleTheme')} className={cn('grid place-items-center rounded-md text-faint hover:bg-hover hover:text-fg', sidebarCollapsed ? 'size-8' : 'size-7')} onClick={() => updateSettings({ theme: dark ? 'light' : 'dark' })}>
            {dark ? <Sun className="size-3.5" strokeWidth={1.6} /> : <Moon className="size-3.5" strokeWidth={1.6} />}
          </button>
        </div>
      </aside>

      {/* Inset panel — the Linear signature */}
      <div className="flex min-w-0 flex-1 flex-col py-2 pr-2">
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[14px] bg-panel shadow-card" data-surface="panel">
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
    <div className="flex h-[var(--header-h)] shrink-0 items-center gap-2 border-b border-line bg-panel gutter-x">
      <div className="flex min-w-0 flex-1 items-center gap-1.5">{left}</div>
      {right ? <div className="flex shrink-0 items-center gap-1">{right}</div> : null}
    </div>
  );
}

/** White bordered segmented group for range/filter pickers (7d/14d, All/Active/…). */
export function ViewTabs({ children }: { children: React.ReactNode }) {
  return <div className="flex shrink-0 items-center gap-0.5 rounded-control bg-surface p-0.5 shadow-card">{children}</div>;
}

export function ViewTab({ active, children, onClick }: { active?: boolean; children: React.ReactNode; onClick?: () => void }) {
  return (
    <button type="button" onClick={onClick} className={cn('h-6 shrink-0 whitespace-nowrap rounded-[6px] px-2 text-[12.5px] font-medium tracking-[-0.01em] transition-colors', active ? 'bg-hover-2 text-fg' : 'text-muted hover:text-fg')}>
      {children}
    </button>
  );
}

/** Hairline vertical divider (`|`) separating header groups (title ↔ tabs). */
export function HeaderDivider() {
  return <span aria-hidden className="mx-2.5 h-4 w-px shrink-0 bg-line-strong" />;
}

/**
 * Page header. The leading icon is derived from the route's sidebar nav item (detail pages inherit their parent's icon), so it is always identical to the sidebar.
 * `tabs` (page-level filters or a detail page's sub-views) sit after the title, separated by a `HeaderDivider`.
 */
export function PageHeader({ title, meta, actions, breadcrumb, tabs }: { title: React.ReactNode; meta?: React.ReactNode; actions?: React.ReactNode; breadcrumb?: React.ReactNode; tabs?: React.ReactNode }) {
  const { pathname } = useLocation();
  const Icon = navItems.find((i) => pathname === i.to || pathname.startsWith(`${i.to}/`))?.icon ?? FileQuestion;
  return (
    <PanelBar
      left={<><Icon aria-hidden className="size-4 shrink-0 text-muted" strokeWidth={1.6} />{breadcrumb}<h1 className="truncate text-[13px] font-medium tracking-[-0.01em] text-fg">{title}</h1>{meta ? <div className="flex items-center gap-2 text-xs text-muted">{meta}</div> : null}{tabs ? <><HeaderDivider /><ViewTabs>{tabs}</ViewTabs></> : null}</>}
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
