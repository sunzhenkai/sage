import { ApiError, api } from './api';

/** The source files every example ships; all are plain UTF-8 text. */
export interface ExampleApp {
  readonly appId: string;
  readonly nameKey: string;
  readonly descriptionKey: string;
  readonly files: readonly string[];
}

/** Built-in examples under `platform/examples/ai-apps`. Keep this list in sync when adding one. */
export const EXAMPLE_APPS: readonly ExampleApp[] = [
  {
    appId: 'finance-briefing',
    nameKey: 'apps.examples.finance.name',
    descriptionKey: 'apps.examples.finance.description',
    files: ['app.yaml', 'prompts/system.md', 'references/brief-writing-guide.md', 'references/market-data-basics.md', 'output.schema.json']
  },
  {
    appId: 'github-trending',
    nameKey: 'apps.examples.github.name',
    descriptionKey: 'apps.examples.github.description',
    files: ['app.yaml', 'prompts/system.md', 'references/repo-evaluation.md', 'references/trending-signals.md', 'output.schema.json']
  },
  {
    appId: 'lifecycle-probe',
    nameKey: 'apps.examples.lifecycle.name',
    descriptionKey: 'apps.examples.lifecycle.description',
    files: ['app.yaml', 'prompts/system.md']
  }
];

export const EXAMPLE_APP_BASE = '/examples/ai-apps';

export function exampleFileUrl(appId: string, file: string): string {
  return `${EXAMPLE_APP_BASE}/${encodeURIComponent(appId)}/${file.split('/').map(encodeURIComponent).join('/')}`;
}

/** Reads the example's source files into the API's `files` shape. Throws `EXAMPLE_LOAD_FAILED` with the failing path. */
export async function loadExampleAppFiles(example: ExampleApp, fetcher: typeof fetch = fetch): Promise<Record<string, string>> {
  const entries = await Promise.all(example.files.map(async (file) => {
    const response = await fetcher(exampleFileUrl(example.appId, file), { headers: { accept: 'text/plain' } });
    if (!response.ok) throw new ApiError(response.status, 'EXAMPLE_LOAD_FAILED', `${example.appId}/${file}`);
    return [file, await response.text()] as const;
  }));
  return Object.fromEntries(entries);
}

/** Subset of `api.apps` used by the import flow, injectable for tests. */
export interface ExampleAppsApi {
  create: (body: { appId: string; name: string; description?: string }) => Promise<unknown>;
  getDraft: (appId: string) => Promise<{ revision: number }>;
  putDraft: (appId: string, files: Record<string, string>) => Promise<{ revision: number }>;
  publish: (appId: string, baseRevision: number) => Promise<unknown>;
}

export type ExampleImportResult =
  | { status: 'imported'; appId: string; files: number }
  | { status: 'exists'; appId: string }
  /** The list is stale. Show "exists" rather than silently leaving an unexpected state. */
  | { status: 'exists-hidden'; appId: string };

/**
 * Imports one built-in example: create the app, save the example files as its draft, then publish.
 * Existing apps are never overwritten, including when the list is stale; a half-created app
 * (create and draft saved, publish failed) is retried via `retryAppId` by publishing the saved draft again.
 */
export async function importExampleApp(input: {
  example: ExampleApp;
  existingAppIds: ReadonlySet<string>;
  appsApi?: ExampleAppsApi;
  fetcher?: typeof fetch;
  /** Set after a create succeeded but the draft/publish failed, so a retry reuses the saved draft. */
  retryAppId?: string;
}): Promise<ExampleImportResult> {
  const { example, existingAppIds } = input;
  const appsApi = input.appsApi ?? api.apps;
  if (existingAppIds.has(example.appId)) return { status: 'exists', appId: example.appId };
  const files = await loadExampleAppFiles(example, input.fetcher ?? fetch);
  if (input.retryAppId === example.appId) {
    const draft = await appsApi.getDraft(example.appId);
    await appsApi.publish(example.appId, draft.revision);
    return { status: 'imported', appId: example.appId, files: Object.keys(files).length };
  }
  try {
    await appsApi.create({ appId: example.appId, name: example.appId });
  } catch (error) {
    if (error instanceof ApiError && error.code === 'APP_ALREADY_EXISTS') {
      // The list can be stale; report it instead of saving a draft, but never overwrite.
      return { status: 'exists-hidden', appId: example.appId };
    }
    throw error;
  }
  const draft = await appsApi.putDraft(example.appId, files);
  await appsApi.publish(example.appId, draft.revision);
  return { status: 'imported', appId: example.appId, files: Object.keys(files).length };
}
