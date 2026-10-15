import { BarChart3, Boxes, CalendarClock, ListChecks, MessageSquare, Package, Plug, Settings } from 'lucide-react';

/**
 * Sidebar navigation. Labels are dictionary keys, never rendered strings — consumers resolve them
 * with `t()` at render time so a language switch applies immediately (no module-load-time text).
 */
export const navItems = [
  { to: '/overview', labelKey: 'nav.overview', icon: BarChart3, shortcut: 'G O', group: 'workspace' },
  { to: '/chat', labelKey: 'nav.chat', icon: MessageSquare, shortcut: 'G C', group: 'workspace' },
  { to: '/tasks', labelKey: 'nav.tasks', icon: ListChecks, shortcut: 'G T', group: 'workspace' },
  { to: '/schedules', labelKey: 'nav.schedules', icon: CalendarClock, shortcut: 'G S', group: 'workspace' },
  { to: '/apps', labelKey: 'nav.apps', icon: Boxes, shortcut: 'G A', group: 'agents' },
  { to: '/packages', labelKey: 'nav.packages', icon: Package, shortcut: 'G P', group: 'agents' },
  { to: '/providers', labelKey: 'nav.providers', icon: Plug, shortcut: 'G M', group: 'configure' },
  { to: '/settings', labelKey: 'nav.settings', icon: Settings, shortcut: 'G ,', group: 'configure' }
] as const;

export const navGroups = [
  { key: 'workspace', labelKey: 'nav.groups.workspace' },
  { key: 'agents', labelKey: 'nav.groups.agents' },
  { key: 'configure', labelKey: 'nav.groups.configure' }
] as const;

export type NavGroupKey = (typeof navGroups)[number]['key'];
