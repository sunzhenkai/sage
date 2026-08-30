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
    id: 'ops-analyst', version: '2.0.0', description: '通用运维分析助手', entry: 'prompts/system.md',
    modelRoute: { provider: 'anthropic', model: 'claude-sonnet-4-5' }, skillRefs: ['skill://ops-triage/v1'], capabilityRefs: [],
    inputs: [
      { name: 'severity', type: 'enum', required: false, enum: ['low', 'medium', 'high'], default: 'medium' },
      { name: 'window', type: 'number', required: false },
    ],
    dataSources: [{ name: 'metrics-snapshot', url: 'https://api.example/metrics' }],
    tasks: [{ name: 'triage', entry: 'prompts/system.md' }],
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
    // 版本号单处呈现：徽章保留，副标题不再重复「最新版本 · vX」
    expect(JSON.stringify(tree.toJSON())).not.toContain('Latest version');
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
  it('clears the stale detail when the package param leaves the URL, so the next detail never flashes the previous app', async () => {
    let resolveSlow!: (value: Response) => void;
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/v1/apps')) return response({ apps: [{ appId: 'ops-analyst', name: 'Ops Analyst', latestVersion: '1.0.0', releaseCount: 1, updatedAt: '2026-08-17T00:00:00.000Z', createdAt: '2026-08-17T00:00:00.000Z' }] });
      if (url.endsWith('/v1/apps/ops-analyst')) return response({ ...detail, appId: 'ops-analyst' });
      if (url.endsWith('/v1/apps/slow-app')) return new Promise<Response>((resolve) => { resolveSlow = resolve; });
      return response({}, 404);
    }) as typeof fetch;
    let tree!: ReturnType<typeof create>;
    await act(async () => { tree = create(<PackagesApp fetcher={fetcher} packageId="ops-analyst" />); await flush(); await flush(); });
    expect(tree.root.findAllByType(PackageDetailView)).toHaveLength(1);
    // ← 全部应用：摘掉 package 参数回到列表。
    await act(async () => { tree.update(<PackagesApp fetcher={fetcher} />); await flush(); await flush(); });
    expect(tree.root.findAllByType(PackageDetailView)).toHaveLength(0);
    expect(tree.root.findAllByProps({ href: '/?view=packages&package=ops-analyst' }).length).toBeGreaterThan(0);
    // 再打开其他应用：旧详情已清空，加载期间不得渲染上一个应用的内容。
    await act(async () => { tree.update(<PackagesApp fetcher={fetcher} packageId="slow-app" />); await flush(); });
    expect(tree.root.findAllByProps({ children: 'Ops Analyst' })).toHaveLength(0);
    await act(async () => { resolveSlow(response({ ...detail, appId: 'slow-app', packageId: 'slow-app', name: 'Slow App' })); await flush(); });
    expect(tree.root.findByProps({ children: 'Slow App' })).toBeTruthy();
    await act(async () => tree.unmount());
  });
});

describe('PackagesApp example import', () => {
  const postBodies = (calls: readonly unknown[][]) => calls
    .filter(([, init]) => (init as RequestInit | undefined)?.method === 'POST')
    .map(([url, init]) => ({ url: String(url), body: JSON.parse(String((init as RequestInit).body)) as Record<string, unknown> }));
  const withWindow = (assignSpy: ReturnType<typeof vi.fn>) => {
    const originalWindow = (globalThis as { window?: unknown }).window;
    (globalThis as { window?: unknown }).window = { location: { assign: assignSpy } };
    return () => { (globalThis as { window?: unknown }).window = originalWindow; };
  };

  it('creates the app and registers its release in one click', async () => {
    const mockFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === 'POST' && url.endsWith('/v1/apps')) return response({ schemaVersion: 'App.v1', appId: 'github-trending', status: 'active' }, 201);
      if (init?.method === 'POST' && url.endsWith('/releases')) return response({ schemaVersion: 'PackageReleaseResult.v1', status: 'stored', packageVersion: '1.0.0' }, 201);
      return response({ apps: [] });
    });
    const fetcher = mockFetch as typeof fetch;
    const assignSpy = vi.fn();
    const restoreWindow = withWindow(assignSpy);
    let tree!: ReturnType<typeof create>;
    await act(async () => { tree = create(<PackagesApp fetcher={fetcher} />); await flush(); });
    const toggle = tree.root.findAllByType('button').find((b) => b.props.children === '+ Import example')!;
    await act(async () => { toggle.props.onClick(); await flush(); });
    const importButtons = tree.root.findAllByType('button').filter((b) => b.props.children === 'Import');
    expect(importButtons).toHaveLength(3);
    await act(async () => { importButtons[0]!.props.onClick(); await flush(); await flush(); });
    const posts = postBodies(mockFetch.mock.calls);
    expect(posts[0]).toMatchObject({ url: '/v1/apps', body: { appId: 'github-trending', name: 'GitHub Trending' } });
    const releasePost = posts.find((post) => post.url.endsWith('/releases'))!;
    expect(releasePost.url).toBe('/v1/apps/github-trending/releases');
    const files = releasePost.body.files as Record<string, string>;
    expect(files['app.yaml']).toContain('id: github-trending');
    expect(Object.keys(files)).toContain('prompts/system.md');
    expect(assignSpy).toHaveBeenCalledWith('/?view=packages&package=github-trending');
    restoreWindow();
    await act(async () => tree.unmount());
  });

  it('treats an already-registered app as importable and still registers the release', async () => {
    const mockFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === 'POST' && url.endsWith('/v1/apps')) return response({ error: { code: 'APP_ALREADY_EXISTS', message: 'App already exists' } }, 409);
      if (init?.method === 'POST' && url.endsWith('/releases')) return response({ schemaVersion: 'PackageReleaseResult.v1', status: 'existing', packageVersion: '1.0.0' }, 200);
      return response({ apps: [] });
    });
    const fetcher = mockFetch as typeof fetch;
    const assignSpy = vi.fn();
    const restoreWindow = withWindow(assignSpy);
    let tree!: ReturnType<typeof create>;
    await act(async () => { tree = create(<PackagesApp fetcher={fetcher} />); await flush(); });
    await act(async () => { tree.root.findAllByType('button').find((b) => b.props.children === '+ Import example')!.props.onClick(); await flush(); });
    const importButtons = tree.root.findAllByType('button').filter((b) => b.props.children === 'Import');
    await act(async () => { importButtons[1]!.props.onClick(); await flush(); await flush(); });
    const posts = postBodies(mockFetch.mock.calls);
    expect(posts[0]!.url).toBe('/v1/apps');
    expect(posts.find((post) => post.url.endsWith('/releases'))!.url).toBe('/v1/apps/finance-briefing/releases');
    expect(assignSpy).toHaveBeenCalledWith('/?view=packages&package=finance-briefing');
    restoreWindow();
    await act(async () => tree.unmount());
  });

  it('shows an inline error and stays on the list when the release registration fails', async () => {
    const mockFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === 'POST' && url.endsWith('/v1/apps')) return response({ schemaVersion: 'App.v1', appId: 'lifecycle-probe', status: 'active' }, 201);
      if (init?.method === 'POST' && url.endsWith('/releases')) return response({ error: { code: 'APP_PACKAGE_INVALID', message: 'package rejected by compiler' } }, 400);
      return response({ apps: [] });
    });
    const fetcher = mockFetch as typeof fetch;
    const assignSpy = vi.fn();
    const restoreWindow = withWindow(assignSpy);
    let tree!: ReturnType<typeof create>;
    await act(async () => { tree = create(<PackagesApp fetcher={fetcher} />); await flush(); });
    await act(async () => { tree.root.findAllByType('button').find((b) => b.props.children === '+ Import example')!.props.onClick(); await flush(); });
    const importButtons = tree.root.findAllByType('button').filter((b) => b.props.children === 'Import');
    await act(async () => { importButtons[2]!.props.onClick(); await flush(); await flush(); });
    expect(tree.root.findByProps({ children: 'package rejected by compiler' })).toBeTruthy();
    expect(assignSpy).not.toHaveBeenCalled();
    restoreWindow();
    await act(async () => tree.unmount());
  });
});

describe('PackageDetailView management', () => {
  it('uploads a new version after choosing an archive', async () => {
    const onUploadVersion = vi.fn(async () => undefined);
    let tree!: ReturnType<typeof create>;
    await act(async () => { tree = create(<PackageDetailView {...detailProps({ onUploadVersion })} />); await flush(); });
    const toggle = tree.root.findAllByType('button').find((b) => b.props.children === 'Upload new version')!;
    await act(async () => { toggle.props.onClick(); await flush(); });
    const file = new File([new Uint8Array([0x1f, 0x8b])], 'ops-analyst.tar.gz', { type: 'application/gzip' });
    const input = tree.root.findByProps({ 'aria-label': 'Source package archive' });
    await act(async () => { input.props.onChange({ target: { files: [file] } }); await flush(); });
    const form = tree.root.findAllByType('form').find((node) => node.findAllByProps({ 'aria-label': 'Source package archive' }).length > 0)!;
    await act(async () => { form.props.onSubmit({ preventDefault: () => undefined }); await flush(); });
    expect(onUploadVersion).toHaveBeenCalledWith(file);
    await act(async () => tree.unmount());
  });

  it('rejects an archive that is too large before calling the API', async () => {
    const onUploadVersion = vi.fn(async () => undefined);
    let tree!: ReturnType<typeof create>;
    await act(async () => { tree = create(<PackageDetailView {...detailProps({ onUploadVersion })} />); await flush(); });
    const toggle = tree.root.findAllByType('button').find((b) => b.props.children === 'Upload new version')!;
    await act(async () => { toggle.props.onClick(); await flush(); });
    const file = new File([new Uint8Array(8 * 1024 * 1024 + 1)], 'ops-analyst.tar.gz', { type: 'application/gzip' });
    const input = tree.root.findByProps({ 'aria-label': 'Source package archive' });
    await act(async () => { input.props.onChange({ target: { files: [file] } }); await flush(); });
    const form = tree.root.findAllByType('form').find((node) => node.findAllByProps({ 'aria-label': 'Source package archive' }).length > 0)!;
    await act(async () => { form.props.onSubmit({ preventDefault: () => undefined }); await flush(); });
    expect(onUploadVersion).not.toHaveBeenCalled();
    expect(tree.root.findByProps({ children: 'Archive exceeds the 8 MiB upload limit.' })).toBeTruthy();
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

describe('PackagesApp archive upload', () => {
  it('posts multipart FormData and refreshes version history after success', async () => {
    const file = new File([new Uint8Array([0x1f, 0x8b])], 'ops-analyst.tar.gz', { type: 'application/gzip' });
    let uploaded = false;
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === 'POST' && url.endsWith('/releases')) {
        expect(init.body).toBeInstanceOf(FormData);
        uploaded = true;
        return response({ schemaVersion: 'PackageReleaseResult.v1', status: 'stored', packageVersion: '2.0.0' }, 201);
      }
      if (url.endsWith('/v1/apps/ops-analyst')) {
        return response({
          ...detail,
          appId: 'ops-analyst',
          releases: uploaded
            ? [{ packageVersion: '2.0.0', releaseRef: 'release://v2', releaseId: 'rel-2', contentDigest: 'sha256:' + 'f'.repeat(64), lockDigest: 'sha256:' + 'e'.repeat(64), compilerBuild: 'local-dev', createdAt: '2026-08-30T00:00:00.000Z' }, ...detail.releases]
            : detail.releases
        });
      }
      return response({}, 404);
    }) as typeof fetch;
    let tree!: ReturnType<typeof create>;
    await act(async () => { tree = create(<PackagesApp fetcher={fetcher} packageId="ops-analyst" />); await flush(); await flush(); });
    const toggle = tree.root.findAllByType('button').find((b) => b.props.children === 'Upload new version')!;
    await act(async () => { toggle.props.onClick(); await flush(); });
    const input = tree.root.findByProps({ 'aria-label': 'Source package archive' });
    await act(async () => { input.props.onChange({ target: { files: [file] } }); await flush(); });
    const form = tree.root.findAllByType('form').find((node) => node.findAllByProps({ 'aria-label': 'Source package archive' }).length > 0)!;
    await act(async () => { form.props.onSubmit({ preventDefault: () => undefined }); await flush(); await flush(); await flush(); });
    expect(uploaded).toBe(true);
    expect(JSON.stringify(tree.toJSON())).toContain('2.0.0');
    expect(JSON.stringify(tree.toJSON())).toContain('New version registered');
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
    // 空值字段不占位：capabilityRefs 为空 → 不渲染该行、不出现「—」
    expect(markup).not.toContain('Capabilities');
    expect(markup).not.toContain('>—<');
  });

  it('hides all empty manifest rows and renders the run card without a dangling divider when no params are declared', () => {
    const bare: PackageDetailType = {
      ...detail,
      manifest: { ...detail.manifest!, skillRefs: [], capabilityRefs: [], inputs: [], dataSources: [], tasks: [{ name: 'triage', entry: 'prompts/system.md' }] }
    };
    const markup = renderToStaticMarkup(<PackageDetailView {...detailProps({ detail: bare })} />);
    expect(markup).not.toContain('>—<');
    expect(markup).not.toContain('Skills');
    expect(markup).not.toContain('Declared parameters');
    expect(markup).not.toContain('Data sources');
    expect(markup).toContain('Start run');
    // 无参数无多任务选择：提交按钮直接呈现，无悬空 form-actions 分隔线
    expect(markup).not.toContain('form-actions');
  });

  it('starts a run with declared params: blanks use defaults, enum selects pass through, numbers validate', async () => {
    const startRun = vi.fn(async () => undefined);
    let tree!: ReturnType<typeof create>;
    await act(async () => { tree = create(<PackageDetailView {...detailProps({ onStartRun: startRun })} />); await flush(); });
    const form = tree.root.findAllByType('form').find((node) => node.findAllByProps({ 'aria-label': 'severity' }).length > 0)!;
    // 全部留空：以空 params 发起（缺省值由服务端按声明补齐），无空输入警告。
    await act(async () => { form.props.onSubmit({ preventDefault: () => undefined }); await flush(); });
    expect(startRun).toHaveBeenCalledWith({ task: 'triage', params: {} });
    // 枚举选择 + 非法数字：数字内联报错且不发起。
    const severity = tree.root.findByProps({ 'aria-label': 'severity' });
    const window = tree.root.findByProps({ 'aria-label': 'window' });
    await act(async () => { severity.props.onChange({ target: { value: 'high' } }); window.props.onChange({ target: { value: 'not-a-number' } }); await flush(); });
    await act(async () => { form.props.onSubmit({ preventDefault: () => undefined }); await flush(); });
    expect(tree.root.findByProps({ children: 'Param window must be a number' })).toBeTruthy();
    expect(startRun).toHaveBeenCalledTimes(1);
    // 修正数字后：枚举与数字一并提交。
    await act(async () => { window.props.onChange({ target: { value: '7' } }); await flush(); });
    await act(async () => { form.props.onSubmit({ preventDefault: () => undefined }); await flush(); });
    expect(startRun).toHaveBeenLastCalledWith({ task: 'triage', params: { severity: 'high', window: 7 } });
    await act(async () => tree.unmount());
  });
});
