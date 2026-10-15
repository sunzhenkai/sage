import { useSyncExternalStore } from 'react';

/** Labels/descriptions are dictionary keys (`shortcuts.*`) — the only source of truth for this copy. */
export type Shortcut = { id: string; labelKey: string; descriptionKey: string; keys: string; to?: string; fixed?: boolean };

export const defaultShortcuts: Shortcut[] = [
  { id: 'palette', labelKey: 'shortcuts.palette.label', descriptionKey: 'shortcuts.palette.description', keys: '⌘ K', fixed: true },
  { id: 'sidebar', labelKey: 'shortcuts.sidebar.label', descriptionKey: 'shortcuts.sidebar.description', keys: '⌘ B', fixed: true },
  { id: 'go-overview', labelKey: 'shortcuts.go-overview.label', descriptionKey: 'shortcuts.go-overview.description', keys: 'G O', to: '/overview' },
  { id: 'go-chat', labelKey: 'shortcuts.go-chat.label', descriptionKey: 'shortcuts.go-chat.description', keys: 'G C', to: '/chat' },
  { id: 'go-tasks', labelKey: 'shortcuts.go-tasks.label', descriptionKey: 'shortcuts.go-tasks.description', keys: 'G T', to: '/tasks' },
  { id: 'go-schedules', labelKey: 'shortcuts.go-schedules.label', descriptionKey: 'shortcuts.go-schedules.description', keys: 'G S', to: '/schedules' },
  { id: 'go-apps', labelKey: 'shortcuts.go-apps.label', descriptionKey: 'shortcuts.go-apps.description', keys: 'G A', to: '/apps' },
  { id: 'go-packages', labelKey: 'shortcuts.go-packages.label', descriptionKey: 'shortcuts.go-packages.description', keys: 'G P', to: '/packages' },
  { id: 'go-providers', labelKey: 'shortcuts.go-providers.label', descriptionKey: 'shortcuts.go-providers.description', keys: 'G M', to: '/providers' },
  { id: 'go-settings', labelKey: 'shortcuts.go-settings.label', descriptionKey: 'shortcuts.go-settings.description', keys: 'G ,', to: '/settings' },
  { id: 'send', labelKey: 'shortcuts.send.label', descriptionKey: 'shortcuts.send.description', keys: '↵', fixed: true }
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
