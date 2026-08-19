import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('Local Web runtime boundaries', () => {
  it('keeps Vite dev/preview and configurable /v1 proxy scripts', async () => {
    const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as { scripts: Record<string, string> };
    const vite = await readFile(new URL('../vite.config.ts', import.meta.url), 'utf8');
    expect(packageJson.scripts.dev).toBe('vite');
    expect(packageJson.scripts.preview).toBe('vite preview');
    expect(packageJson.scripts.build).toBe('vite build');
    expect(vite).toContain("process.env.SAGE_API_PROXY_TARGET");
    expect(vite.match(/'\/v1'/g)).toHaveLength(2);
  });

  it('does not contain first-visit auto creation or placeholder title in the entrypoint', async () => {
    const main = await readFile(new URL('./main.tsx', import.meta.url), 'utf8');
    expect(main).not.toContain('ensureChatSession');
    expect(main).not.toContain('Local Sage Chat');
    expect(main).toContain('<ChatLanding />');
    expect(main).toContain('<ChatApp sessionId={sessionId} />');
  });

  it('uses scoped health wording only', async () => {
    const main = await readFile(new URL('./main.tsx', import.meta.url), 'utf8');
    expect(main).toContain('Local development mode');
    expect(main).toContain('Local Pi Harness');
    expect(main).not.toMatch(/API \+ Worker online|All systems operational/);
  });
});
