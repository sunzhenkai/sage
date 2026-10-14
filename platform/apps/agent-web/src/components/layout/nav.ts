import { Boxes, CalendarClock, ListChecks, MessageSquare, Package, Plug, Settings } from 'lucide-react';

export const navItems = [
  { to: '/chat', label: 'Chat', icon: MessageSquare, shortcut: 'G C', group: 'Workspace' },
  { to: '/tasks', label: 'Tasks', icon: ListChecks, shortcut: 'G T', group: 'Workspace' },
  { to: '/schedules', label: 'Schedules', icon: CalendarClock, shortcut: 'G S', group: 'Workspace' },
  { to: '/apps', label: 'Apps', icon: Boxes, shortcut: 'G A', group: 'Agents' },
  { to: '/packages', label: 'Packages', icon: Package, shortcut: 'G P', group: 'Agents' },
  { to: '/providers', label: 'Providers', icon: Plug, shortcut: 'G M', group: 'Configure' },
  { to: '/settings', label: 'Settings', icon: Settings, shortcut: 'G ,', group: 'Configure' }
] as const;

export const navGroups = ['Workspace', 'Agents', 'Configure'] as const;
