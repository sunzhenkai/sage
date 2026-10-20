import { afterEach, describe, expect, it, vi } from 'vitest';

const KEY = 'sage.agent-web.settings';
const saved = new Map<string, PropertyDescriptor | undefined>();

function stubGlobal(key: string, value: unknown): void {
  if (!saved.has(key)) saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}

function installStorage(initial?: Record<string, unknown>): Map<string, string> {
  const storage = new Map<string, string>();
  if (initial !== undefined) storage.set(KEY, JSON.stringify(initial));
  stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => { storage.set(key, value); },
    removeItem: (key: string) => { storage.delete(key); }
  });
  stubGlobal('window', { matchMedia: () => ({ matches: false }) });
  stubGlobal('document', { documentElement: { classList: { toggle: () => {} } } });
  return storage;
}

async function loadSettings() {
  vi.resetModules();
  return await import('./settings');
}

afterEach(() => {
  for (const [key, descriptor] of saved) {
    if (descriptor === undefined) delete (globalThis as Record<string, unknown>)[key];
    else Object.defineProperty(globalThis, key, descriptor);
  }
  saved.clear();
  vi.resetModules();
});

describe('settings migration', () => {
  it('moves the legacy serviceToken into mcpApiKey', async () => {
    installStorage({ serviceToken: 'legacy-key', tenantId: 'tenant-a' });
    const { getSettings } = await loadSettings();
    expect(getSettings().mcpApiKey).toBe('legacy-key');
    expect(getSettings()).not.toHaveProperty('serviceToken');
  });

  it('keeps an explicit mcpApiKey over the legacy value', async () => {
    installStorage({ serviceToken: 'legacy-key', mcpApiKey: 'new-key' });
    const { getSettings } = await loadSettings();
    expect(getSettings().mcpApiKey).toBe('new-key');
  });

  it('defaults to an empty MCP key', async () => {
    installStorage();
    const { getSettings } = await loadSettings();
    expect(getSettings().mcpApiKey).toBe('');
  });
});
