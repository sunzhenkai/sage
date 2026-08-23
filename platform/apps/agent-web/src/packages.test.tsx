import { act, create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { PackagesApp, PackageDetailView, type PackageDetailView as PackageDetailType } from './packages.js';
import { renderToStaticMarkup } from 'react-dom/server';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const detail: PackageDetailType = {
  packageId: 'ops-analyst',
  name: 'Ops Analyst',
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

const detailProps = (overrides: Record<string, unknown> = {}) => ({
  detail, loading: false, starting: false, uploading: false, deleting: false, deleteConfirm: false,
  onStartRun: () => undefined, onUploadVersion: () => undefined, onRequestDelete: () => undefined,
  onCancelDelete: () => undefined, onConfirmDelete: () => undefined, ...overrides
});

describe('PackagesApp list', () => {
  it('renders app summaries from the API and links to details', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/v1/apps')) return response({ apps: [{ appId: 'ops-analyst', name: 'Ops Analyst', latestVersion: '1.0.0', releaseCount: 1, updatedAt: '2026-08-17T00:00:00.000Z', createdAt: '2026-08-17T00:00:00.000Z' }] });
      return response({}, 404);
    }) as typeof fetch;
    let tree!: ReturnType<typeof create>;
    await act(async () => { tree = create(<PackagesApp fetcher={fetcher} />); await flush(); });
    expect(tree.root.findAllByProps({ children: 'Ops Analyst' }).length).toBeGreaterThan(0);
    const row = tree.root.findAllByProps({ href: '/?view=packages&package=ops-analyst' })[0];
    expect(row).toBeTruthy();
    await act(async () => tree.unmount());
  });

  it('shows the empty state guidance when no apps exist', async () => {
    const fetcher = vi.fn(async () => response({ apps: [] })) as typeof fetch;
    let tree!: ReturnType<typeof create>;
    await act(async () => { tree = create(<PackagesApp fetcher={fetcher} />); await flush(); });
    expect(tree.root.findByProps({ children: 'No packages yet' })).toBeTruthy();
    await act(async () => tree.unmount());
  });

  it('creates a new app via the form', async () => {
    const calls: string[] = [];
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push(`${init?.method ?? 'GET'} ${url}`);
      if (init?.method === 'POST' && url.endsWith('/v1/apps')) return response({ schemaVersion: 'App.v1', appId: 'new-app', status: 'active' }, 201);
      if (url.endsWith('/v1/apps')) return response({ apps: [] });
      return response({}, 404);
    }) as typeof fetch;
    const assignSpy = vi.fn();
    const originalWindow = (globalThis as { window?: unknown }).window;
    (globalThis as { window?: unknown }).window = { location: { assign: assignSpy } };
    let tree!: ReturnType<typeof create>;
    await act(async () => { tree = create(<PackagesApp fetcher={fetcher} />); await flush(); });
    // 打开新建表单
    const toggle = tree.root.findAllByType('button').find((b) => b.props.children === '+ New App')!;
    await act(async () => { toggle.props.onClick(); await flush(); });
    const idInput = tree.root.findByProps({ 'aria-label': 'App ID' });
    const nameInput = tree.root.findByProps({ 'aria-label': 'App name' });
    await act(async () => { idInput.props.onChange({ target: { value: 'new-app' } }); nameInput.props.onChange({ target: { value: 'New App' } }); await flush(); });
    const form = tree.root.findAllByType('form')[0]!;
    await act(async () => { form.props.onSubmit({ preventDefault: () => undefined }); await flush(); });
    expect(calls.some((c) => c === 'POST /v1/apps')).toBe(true);
    expect(assignSpy).toHaveBeenCalledWith('/?view=packages&package=new-app');
    (globalThis as { window?: unknown }).window = originalWindow;
    await act(async () => tree.unmount());
  });

  it('blocks new app submit on invalid appId', async () => {
    const mockFetch = vi.fn<typeof fetch>(async () => response({ apps: [] }));
    const fetcher = mockFetch as typeof fetch;
    let tree!: ReturnType<typeof create>;
    await act(async () => { tree = create(<PackagesApp fetcher={fetcher} />); await flush(); });
    const toggle = tree.root.findAllByType('button').find((b) => b.props.children === '+ New App')!;
    await act(async () => { toggle.props.onClick(); await flush(); });
    const idInput = tree.root.findByProps({ 'aria-label': 'App ID' });
    const nameInput = tree.root.findByProps({ 'aria-label': 'App name' });
    await act(async () => { idInput.props.onChange({ target: { value: 'Bad_ID!' } }); nameInput.props.onChange({ target: { value: 'X' } }); await flush(); });
    const form = tree.root.findAllByType('form')[0]!;
    await act(async () => { form.props.onSubmit({ preventDefault: () => undefined }); await flush(); });
    expect(tree.root.findByProps({ children: 'Invalid App ID format' })).toBeTruthy();
    expect(mockFetch.mock.calls.filter((c) => (c[1] as RequestInit | undefined)?.method === 'POST')).toHaveLength(0);
    await act(async () => tree.unmount());
  });
});

describe('PackageDetailView management', () => {
  it('uploads a new version after filling files', async () => {
    const onUploadVersion = vi.fn(async () => undefined);
    let tree!: ReturnType<typeof create>;
    await act(async () => { tree = create(<PackageDetailView {...detailProps({ onUploadVersion })} />); await flush(); });
    const toggle = tree.root.findAllByType('button').find((b) => b.props.children === 'Upload new version')!;
    await act(async () => { toggle.props.onClick(); await flush(); });
    const textarea = tree.root.findByProps({ 'aria-label': 'Package files (one per line, path then content)' });
    await act(async () => { textarea.props.onChange({ target: { value: JSON.stringify({ 'app.yaml': 'id: ops-analyst' }) } }); await flush(); });
    const form = tree.root.findAllByType('form').find((node) => node.findAllByProps({ 'aria-label': 'Package files (one per line, path then content)' }).length > 0)!;
    await act(async () => { form.props.onSubmit({ preventDefault: () => undefined }); await flush(); });
    expect(onUploadVersion).toHaveBeenCalledWith({ 'app.yaml': 'id: ops-analyst' });
    await act(async () => tree.unmount());
  });

  it('rejects upload without app.yaml', async () => {
    const onUploadVersion = vi.fn(async () => undefined);
    let tree!: ReturnType<typeof create>;
    await act(async () => { tree = create(<PackageDetailView {...detailProps({ onUploadVersion })} />); await flush(); });
    const toggle = tree.root.findAllByType('button').find((b) => b.props.children === 'Upload new version')!;
    await act(async () => { toggle.props.onClick(); await flush(); });
    const textarea = tree.root.findByProps({ 'aria-label': 'Package files (one per line, path then content)' });
    await act(async () => { textarea.props.onChange({ target: { value: JSON.stringify({ 'prompts/a.md': 'x' }) } }); await flush(); });
    const form = tree.root.findAllByType('form').find((node) => node.findAllByProps({ 'aria-label': 'Package files (one per line, path then content)' }).length > 0)!;
    await act(async () => { form.props.onSubmit({ preventDefault: () => undefined }); await flush(); });
    expect(onUploadVersion).not.toHaveBeenCalled();
    expect(tree.root.findByProps({ children: 'At least the app.yaml file is required' })).toBeTruthy();
    await act(async () => tree.unmount());
  });

  it('confirms before deleting an app', async () => {
    const onConfirmDelete = vi.fn(async () => undefined);
    const onRequestDelete = vi.fn();
    let tree!: ReturnType<typeof create>;
    // deleteConfirm=false 时点击删除按钮触发 onRequestDelete
    await act(async () => { tree = create(<PackageDetailView {...detailProps({ onConfirmDelete, onRequestDelete })} />); await flush(); });
    const deleteBtn = tree.root.findAllByType('button').find((b) => b.props.children === 'Delete App')!;
    await act(async () => { deleteBtn.props.onClick(); await flush(); });
    expect(onRequestDelete).toHaveBeenCalled();
    expect(onConfirmDelete).not.toHaveBeenCalled();
    await act(async () => tree.unmount());
    // deleteConfirm=true 时确认横幅内的按钮触发 onConfirmDelete（与头部删除按钮同文案，需按容器区分）
    await act(async () => { tree = create(<PackageDetailView {...detailProps({ onConfirmDelete, deleteConfirm: true })} />); await flush(); });
    const banner = tree.root.findByProps({ role: 'alert' });
    const confirmBtn = banner.findAllByType('button').find((b) => b.props.children === 'Delete App')!;
    await act(async () => { confirmBtn.props.onClick(); await flush(); });
    expect(onConfirmDelete).toHaveBeenCalled();
    await act(async () => tree.unmount());
  });
});

describe('PackageDetailView', () => {
  it('renders manifest summary, asset preview, and release history', () => {
    const markup = renderToStaticMarkup(<PackageDetailView {...detailProps()} />);
    expect(markup).toContain('Ops Analyst');
    expect(markup).toContain('prompts/system.md');
    expect(markup).toContain('claude-sonnet-4-5');
    expect(markup).toContain('你是运维助手。');
    expect(markup).toContain('local-dev');
    expect(markup).toContain('sha256:' + 'd'.repeat(64));
  });

  it('requires user input before starting a run', async () => {
    const startRun = vi.fn(async () => undefined);
    let tree!: ReturnType<typeof create>;
    await act(async () => { tree = create(<PackageDetailView {...detailProps({ onStartRun: startRun })} />); await flush(); });
    const textarea = tree.root.findByProps({ 'aria-label': 'User input' });
    const form = tree.root.findAllByType('form').find((node) => node.findAllByProps({ 'aria-label': 'User input' }).length > 0)!;
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
