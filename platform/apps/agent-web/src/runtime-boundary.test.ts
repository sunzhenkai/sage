import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('Local Web runtime boundaries', () => {
  it('keeps Vite dev/preview and configurable /v1 proxy scripts', async () => {
    const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as { scripts: Record<string, string> };
    const vite = await readFile(new URL('../vite.config.ts', import.meta.url), 'utf8');
    const apiProxy = await readFile(new URL('./api-proxy.ts', import.meta.url), 'utf8');
    expect(packageJson.scripts.dev).toBe('vite');
    expect(packageJson.scripts.preview).toBe('vite preview');
    expect(packageJson.scripts.build).toBe('vite build');
    // /v1 同源代理目标可配置；service token 由代理在服务端注入（浏览器不持有凭据，未配置 fail closed）。
    expect(vite.match(/'\/v1'/g)).toHaveLength(2);
    expect(vite).toContain('./src/api-proxy.js');
    expect(apiProxy).toContain('process.env.SAGE_API_PROXY_TARGET');
    expect(apiProxy).toContain('process.env.SAGE_SERVICE_TOKEN');
  });

  it('does not contain first-visit auto creation or placeholder title in the entrypoint', async () => {
    const main = await readFile(new URL('./main.tsx', import.meta.url), 'utf8');
    expect(main).not.toContain('ensureChatSession');
    expect(main).not.toContain('Local Sage Chat');
    expect(main).toContain('<ChatWorkspaceView');
    expect(main).toContain('<ChatApp sessionId={sessionId}');
    expect(main).toContain('<ChatWorkspaceView');
  });

  it('uses scoped health wording only', async () => {
    const main = await readFile(new URL('./main.tsx', import.meta.url), 'utf8');
    expect(main).toContain('Local development mode');
    expect(main).toContain('Local Pi Harness');
    expect(main).not.toMatch(/API \+ Worker online|All systems operational/);
  });
});
