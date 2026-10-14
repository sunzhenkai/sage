import { useSyncExternalStore } from 'react';

export type Shortcut = { id: string; label: string; description: string; keys: string; to?: string; fixed?: boolean };

export const defaultShortcuts: Shortcut[] = [
  { id: 'palette', label: 'Command menu', description: 'Search pages, sessions and actions', keys: '⌘ K', fixed: true },
  { id: 'sidebar', label: 'Toggle sidebar', description: 'Collapse or expand the main sidebar', keys: '⌘ B', fixed: true },
  { id: 'go-overview', label: 'Go to Overview', description: 'Charts and recent activity', keys: 'G O', to: '/overview' },
  { id: 'go-chat', label: 'Go to Chat', description: 'Conversations with the run agent', keys: 'G C', to: '/chat' },
  { id: 'go-tasks', label: 'Go to Tasks', description: 'All tasks and their status', keys: 'G T', to: '/tasks' },
  { id: 'go-schedules', label: 'Go to Schedules', description: 'Recurring triggers', keys: 'G S', to: '/schedules' },
  { id: 'go-apps', label: 'Go to Apps', description: 'Registered agent apps', keys: 'G A', to: '/apps' },
  { id: 'go-packages', label: 'Go to Packages', description: 'Published agent packages', keys: 'G P', to: '/packages' },
  { id: 'go-providers', label: 'Go to Providers', description: 'Model provider connections', keys: 'G M', to: '/providers' },
  { id: 'go-settings', label: 'Go to Settings', description: 'This page', keys: 'G ,', to: '/settings' },
  { id: 'send', label: 'Send message', description: 'In the chat composer', keys: '↵', fixed: true }
];

const KEY = 'sage.agent-web.shortcuts';
type Overrides = Record<string, string>; // id -> keys ('' = cleared)
const listeners = new Set<() => void>();
let cache: Overrides | null = null;
function read(): Overrides { if (cache) return cache; try { cache = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Overrides; } catch { cache = {}; } return cache; }
function write(next: Overrides) { cache = next; localStorage.setItem(KEY, JSON.stringify(next)); listeners.forEach((l) => l()); }

export function shortcutKeys(s: Shortcut, o: Overrides = read()): string { return o[s.id] ?? s.keys; }
export function setShortcut(id: string, keys: string) { const d = defaultShortcuts.find((s) => s.id === id); const next = { ...read() }; if (d && d.keys === keys) delete next[id]; else next[id] = keys; write(next); }
export function resetShortcut(id: string) { const next = { ...read() }; delete next[id]; write(next); }
export function resetAllShortcuts() { write({}); }
export function useShortcutOverrides(): Overrides { return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, read, read); }
/** Second key of "G x" navigation shortcuts → route, honoring overrides. */
export function goKeyMap(): Record<string, string> {
  const o = read(); const map: Record<string, string> = {};
  for (const s of defaultShortcuts) { const k = shortcutKeys(s, o); if (s.to && k.startsWith('G ')) map[k.slice(2).toLowerCase()] = s.to; }
  return map;
}
