import { Boxes, CalendarClock, ListChecks, MessageSquare, Package, Plug, Settings } from 'lucide-react';

export const navItems = [
  { to: '/chat', label: 'Chat', icon: MessageSquare, shortcut: 'G C' },
  { to: '/tasks', label: 'Tasks', icon: ListChecks, shortcut: 'G T' },
  { to: '/apps', label: 'Apps', icon: Boxes, shortcut: 'G A' },
  { to: '/packages', label: 'Packages', icon: Package, shortcut: 'G P' },
  { to: '/schedules', label: 'Schedules', icon: CalendarClock, shortcut: 'G S' },
  { to: '/providers', label: 'Providers', icon: Plug, shortcut: 'G M' },
  { to: '/settings', label: 'Settings', icon: Settings, shortcut: 'G ,' }
] as const;
