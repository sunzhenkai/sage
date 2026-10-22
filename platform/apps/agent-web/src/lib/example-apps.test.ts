import { describe, expect, it, vi } from 'vitest';
import { ApiError } from './api';
import { EXAMPLE_APPS, exampleFileUrl, importExampleApp, loadExampleAppFiles } from './example-apps';

const example = EXAMPLE_APPS[0]!;

function fetcherOf(contents: Record<string, string>): typeof fetch {
  return vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    const file = Object.keys(contents).find((key) => url.endsWith(key.replaceAll('/', '/')));
    if (file === undefined) return new Response('missing', { status: 404 });
    return new Response(contents[file]!, { status: 200 });
  }) as unknown as typeof fetch;
}

const appsApi = () => ({
  create: vi.fn(async () => ({ appId: example.appId })),
  getDraft: vi.fn(async () => ({ revision: 3 })),
  putDraft: vi.fn(async () => ({ revision: 1 })),
  publish: vi.fn(async () => ({ releaseId: 'release-1' }))
});

describe('built-in example apps', () => {
  it('lists the three repository examples and encodes nested asset paths', () => {
    expect(EXAMPLE_APPS.map((item) => item.appId)).toEqual(['finance-briefing', 'github-trending', 'lifecycle-probe']);
    expect(exampleFileUrl('finance-briefing', 'references/market-data-basics.md')).toBe('/examples/ai-apps/finance-briefing/references/market-data-basics.md');
  });

  it('loads every declared source file into a relative-path record', async () => {
    const contents = Object.fromEntries(example.files.map((file) => [file, `content:${file}`]));
    await expect(loadExampleAppFiles(example, fetcherOf(contents))).resolves.toEqual(contents);
  });

  it('reports the failing source path when an example asset is unavailable', async () => {
    expect.assertions(2);
    try {
      await loadExampleAppFiles(example, fetcherOf({ 'app.yaml': 'id: finance-briefing' }));
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).code).toBe('EXAMPLE_LOAD_FAILED');
    }
  });

  it('creates the app, saves every source file as the draft, then publishes it', async () => {
    const api = appsApi();
    const contents = Object.fromEntries(example.files.map((file) => [file, `content:${file}`]));
    await expect(importExampleApp({ example, existingAppIds: new Set(), appsApi: api, fetcher: fetcherOf(contents) })).resolves.toEqual({ status: 'imported', appId: example.appId, files: 5 });
    expect(api.create).toHaveBeenCalledWith({ appId: example.appId, name: example.appId });
    expect(api.putDraft).toHaveBeenCalledWith(example.appId, contents);
    expect(api.publish).toHaveBeenCalledWith(example.appId, 1);
  });

  it('does not call the API for an app that is already listed', async () => {
    const api = appsApi();
    await expect(importExampleApp({ example, existingAppIds: new Set([example.appId]), appsApi: api, fetcher: fetcherOf({}) })).resolves.toEqual({ status: 'exists', appId: example.appId });
    expect(api.create).not.toHaveBeenCalled();
    expect(api.putDraft).not.toHaveBeenCalled();
    expect(api.publish).not.toHaveBeenCalled();
  });

  it('treats APP_ALREADY_EXISTS from a stale list as exists without overwriting its draft', async () => {
    const api = appsApi();
    api.create.mockRejectedValueOnce(new ApiError(409, 'APP_ALREADY_EXISTS', 'exists'));
    const contents = Object.fromEntries(example.files.map((file) => [file, `content:${file}`]));
    await expect(importExampleApp({ example, existingAppIds: new Set(), appsApi: api, fetcher: fetcherOf(contents) })).resolves.toEqual({ status: 'exists-hidden', appId: example.appId });
    expect(api.putDraft).not.toHaveBeenCalled();
    expect(api.publish).not.toHaveBeenCalled();
  });

  it('retries a failed publish against the saved draft without creating or re-uploading', async () => {
    const api = appsApi();
    const contents = Object.fromEntries(example.files.map((file) => [file, `content:${file}`]));
    await expect(importExampleApp({ example, existingAppIds: new Set(), appsApi: api, fetcher: fetcherOf(contents), retryAppId: example.appId })).resolves.toMatchObject({ status: 'imported' });
    expect(api.create).not.toHaveBeenCalled();
    expect(api.putDraft).not.toHaveBeenCalled();
    expect(api.getDraft).toHaveBeenCalledWith(example.appId);
    expect(api.publish).toHaveBeenCalledWith(example.appId, 3);
  });
});
