import { act, create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { PackagesApp, PackageDetailView, type PackageDetailView as PackageDetailType } from './packages.js';
import { renderToStaticMarkup } from 'react-dom/server';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const detail: PackageDetailType = {
  packageId: 'ops-analyst',
  manifest: {
    id: 'ops-analyst', version: '1.0.0', description: '通用运维分析助手', entry: 'prompts/system.md',
    modelRoute: { provider: 'anthropic', model: 'claude-sonnet-4-5' }, skillRefs: ['skill://ops-triage/v1'], capabilityRefs: [],
  },
  assets: [
    { relativePath: 'prompts/system.md', kind: 'prompt', digest: 'sha256:' + 'a'.repeat(64), bytes: 12, preview: '你是运维助手。' },
    { relativePath: 'references/obs.md', kind: 'reference', digest: 'sha256:' + 'b'.repeat(64), bytes: 40 },
  ],
  releases: [
    { packageVersion: '1.0.0', releaseRef: 'release://sha256:' + 'c'.repeat(64), releaseId: 'sha256:' + 'c'.repeat(64), contentDigest: 'sha256:' + 'd'.repeat(64), lockDigest: 'sha256:' + 'e'.repeat(64), compilerBuild: 'local-dev', createdAt: '2026-08-17T00:00:00.000Z' },
  ],
};

describe('PackagesApp list', () => {
  it('renders package summaries from the API and links to details', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/v1/packages')) return response({ packages: [{ packageId: 'ops-analyst', latestVersion: '1.0.0', releaseCount: 1, latestContentDigest: 'sha256:' + 'a'.repeat(64), updatedAt: '2026-08-17T00:00:00.000Z' }] });
      return response({}, 404);
    }) as typeof fetch;
    let tree!: ReturnType<typeof create>;
    await act(async () => { tree = create(<PackagesApp fetcher={fetcher} />); await flush(); });
    expect(tree.root.findAllByProps({ children: 'ops-analyst' }).length).toBeGreaterThan(0);
    const row = tree.root.findAllByProps({ href: '/?view=packages&package=ops-analyst' })[0];
    expect(row).toBeTruthy();
    await act(async () => tree.unmount());
  });

  it('shows the empty state guidance when no packages exist', async () => {
    const fetcher = vi.fn(async () => response({ packages: [] })) as typeof fetch;
    let tree!: ReturnType<typeof create>;
    await act(async () => { tree = create(<PackagesApp fetcher={fetcher} />); await flush(); });
    expect(tree.root.findByProps({ children: 'No packages yet' })).toBeTruthy();
    await act(async () => tree.unmount());
  });
});

describe('PackageDetailView', () => {
  it('renders manifest summary, asset preview, and release history', () => {
    const markup = renderToStaticMarkup(<PackageDetailView detail={detail} loading={false} starting={false} onStartRun={() => undefined} />);
    expect(markup).toContain('ops-analyst');
    expect(markup).toContain('prompts/system.md');
    expect(markup).toContain('claude-sonnet-4-5');
    expect(markup).toContain('你是运维助手。');
    expect(markup).toContain('local-dev');
    expect(markup).toContain('sha256:' + 'd'.repeat(64));
  });

  it('requires user input before starting a run', async () => {
    const startRun = vi.fn(async () => undefined);
    let tree!: ReturnType<typeof create>;
    await act(async () => { tree = create(<PackageDetailView detail={detail} loading={false} starting={false} onStartRun={startRun} />); await flush(); });
    const textarea = tree.root.findByProps({ 'aria-label': 'User input' });
    const form = tree.root.findByType('form');
    // 空输入提交：显示必填错误，不触发 onStartRun。
    await act(async () => { form.props.onSubmit({ preventDefault: () => undefined }); await flush(); });
    expect(startRun).not.toHaveBeenCalled();
    expect(tree.root.findByProps({ children: 'User input is required' })).toBeTruthy();
    // 输入后提交。
    await act(async () => { textarea.props.onChange({ target: { value: 'hello' } }); await flush(); });
    await act(async () => { form.props.onSubmit({ preventDefault: () => undefined }); await flush(); });
    expect(startRun).toHaveBeenCalledWith('hello');
    await act(async () => tree.unmount());
  });
});
