import { isMock, MockHttpError, mockDownload, mockSend } from './mock';
import { getSettings } from './settings';
import type {
  AppCreateResult, AppDetail, AppDraft, AppRelease, AppReleaseDetail, AppReleaseResult, AppRunDetail, AppRunList, AppSummary,
  CatalogModelPage, CatalogProviderPage, CatalogStatus, ChatRun, Message,
  PackageRunResult, ProviderConnection,
  ProviderConnectionCheck, ProviderConnectionCheckResult, ProviderConnectionWrite, RunAgentSettings,
  RunLogPage, ScheduleDefinition, ScheduleSnapshot, ScheduleTriggerEvent, Session, SessionDetail, SessionList, TaskArtifact, TaskEvent,
  TaskStatus, TaskView, TimelineEvent
} from './types';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly retryable = false,
    /** Server error payload beyond code/message (e.g. `currentRevision` on draft conflicts). */
    readonly details?: Readonly<Record<string, unknown>>
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export function apiUrl(path: string, query?: Record<string, string | number | boolean | undefined>): string {
  const base = getSettings().apiBaseUrl.replace(/\/+$/, '');
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) if (value !== undefined && value !== '') params.set(key, String(value));
  const qs = params.toString();
  return `${base}${path}${qs ? `?${qs}` : ''}`;
}

type Query = Record<string, string | number | boolean | undefined>;

function errorFrom(status: number, statusText: string, data: unknown): ApiError {
  const body = data as { error?: { code?: string; message?: string; retryable?: boolean; [key: string]: unknown }; code?: string; message?: string } | undefined;
  const code = body?.error?.code ?? body?.code ?? `HTTP_${status}`;
  const message = body?.error?.message ?? body?.message ?? statusText;
  return new ApiError(status, code, message, body?.error?.retryable ?? false, body?.error);
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  try { return text ? JSON.parse(text) : undefined; } catch { return text; }
}

async function request<T>(method: string, path: string, options: { query?: Query; body?: unknown; headers?: Record<string, string> } = {}): Promise<T> {
  if (isMock()) {
    await new Promise((resolve) => setTimeout(resolve, 120));
    let data: unknown;
    try { data = mockSend(method, path, options.body, options.query); } catch (error) {
      if (error instanceof MockHttpError) throw new ApiError(error.status, error.code, error.message, false, error.details);
      throw error;
    }
    if (data === undefined) {
      if (method !== 'GET') throw new ApiError(400, 'MOCK_READ_ONLY', 'Mock mode is read-only for this endpoint — nothing is sent to agent-api.');
      throw new ApiError(404, 'MOCK_NOT_FOUND', `No mock data for ${path}`);
    }
    return data as T;
  }
  const headers: Record<string, string> = { accept: 'application/json', ...(options.headers ?? {}) };
  const init: RequestInit = { method, headers };
  if (options.body !== undefined) { headers['content-type'] = 'application/json'; init.body = JSON.stringify(options.body); }
  else if (method === 'POST') { headers['content-type'] = 'application/json'; init.body = '{}'; }
  const response = await fetch(apiUrl(path, options.query), init);
  if (response.status === 204) return undefined as T;
  const data = await readJson(response);
  if (!response.ok) throw errorFrom(response.status, response.statusText, data);
  return data as T;
}

async function download(path: string, query?: Query): Promise<Blob> {
  if (isMock()) {
    await new Promise((resolve) => setTimeout(resolve, 120));
    const blob = await mockDownload(path);
    if (blob === undefined) throw new ApiError(404, 'MOCK_NOT_FOUND', `No mock download for ${path}`);
    return blob;
  }
  const response = await fetch(apiUrl(path, query), { method: 'GET', headers: { accept: 'application/gzip' } });
  if (!response.ok) throw errorFrom(response.status, response.statusText, await readJson(response));
  return response.blob();
}

async function uploadArchive(path: string, file: Blob, fileName: string, ifMatch?: string): Promise<unknown> {
  if (isMock()) {
    await new Promise((resolve) => setTimeout(resolve, 120));
    throw new ApiError(400, 'MOCK_IMPORT_UNSUPPORTED', 'Mock mode cannot parse archives — upload against agent-api.');
  }
  const form = new FormData();
  form.append('file', file, fileName);
  const headers: Record<string, string> = { accept: 'application/json' };
  if (ifMatch !== undefined) headers['if-match'] = ifMatch;
  const response = await fetch(apiUrl(path), { method: 'POST', headers, body: form });
  const data = await readJson(response);
  if (!response.ok) throw errorFrom(response.status, response.statusText, data);
  return data;
}

const enc = encodeURIComponent;
const etag = (revision: number): string => `"r${revision}"`;

export const api = {
  health: () => request<{ status: string }>('GET', '/livez'),
  ready: () => request<Record<string, unknown>>('GET', '/readyz'),

  chat: {
    listSessions: (query: { limit?: number | undefined; q?: string | undefined; archived?: boolean | undefined; cursor?: string | undefined; locale?: string | undefined } = {}) => request<SessionList>('GET', '/v1/chat/sessions', { query }),
    createSession: (title?: string) => request<Session>('POST', '/v1/chat/sessions', { body: title ? { title } : {} }),
    getSession: (id: string) => request<SessionDetail>('GET', `/v1/chat/sessions/${enc(id)}`),
    archive: (id: string) => request<Session>('POST', `/v1/chat/sessions/${enc(id)}/archive`),
    unarchive: (id: string) => request<Session>('POST', `/v1/chat/sessions/${enc(id)}/unarchive`),
    remove: (id: string) => request<void>('DELETE', `/v1/chat/sessions/${enc(id)}`),
    submit: (id: string, text: string, connectionId?: string) => request<{ message: Message; run: ChatRun }>('POST', `/v1/chat/sessions/${enc(id)}/messages`, {
      body: { parts: [{ kind: 'text', text }], ...(connectionId ? { provider: { connectionId } } : {}) }
    }),
    retryRun: (runId: string, connectionId?: string) => request<{ run: ChatRun }>('POST', `/v1/chat/runs/${enc(runId)}/retry`, { body: connectionId ? { provider: { connectionId } } : {} }),
    events: (id: string, afterSequence = 0) => request<{ events: TimelineEvent[] }>('GET', `/v1/chat/sessions/${enc(id)}/events`, { query: { afterSequence } }),
    timelineUrl: (id: string, afterSequence = 0) => apiUrl(`/v1/chat/sessions/${enc(id)}/timeline`, { afterSequence })
  },

  tasks: {
    list: (query: { status?: TaskStatus | undefined; taskType?: string | undefined; environment?: string | undefined; limit?: number | undefined } = {}) => request<{ tasks: TaskView[] }>('GET', '/v1/tasks', { query }),
    get: (id: string) => request<TaskView>('GET', `/v1/tasks/${enc(id)}`),
    events: (id: string) => request<{ events: TaskEvent[] }>('GET', `/v1/tasks/${enc(id)}/events`),
    artifacts: (id: string) => request<{ artifacts: TaskArtifact[] }>('GET', `/v1/tasks/${enc(id)}/artifacts`),
    artifact: (id: string, artifactId: string) => request<TaskArtifact & { content?: string; encoding?: string }>('GET', `/v1/tasks/${enc(id)}/artifacts/${enc(artifactId)}`),
    runLogs: (id: string, query: { runId?: string; attemptId?: string; fromSequence?: number; limit?: number } = {}) => request<RunLogPage>('GET', `/v1/tasks/${enc(id)}/run-logs`, { query }),
    signal: (id: string, kind: 'pause' | 'resume') => request<unknown>('POST', `/v1/tasks/${enc(id)}/signals`, { body: { kind } }),
    cancel: (id: string) => request<unknown>('POST', `/v1/tasks/${enc(id)}/cancel`, { body: {} }),
    retry: (id: string) => request<unknown>('POST', `/v1/tasks/${enc(id)}/retry`, { body: {} })
  },

  apps: {
    list: () => request<{ apps: AppSummary[] }>('GET', '/v1/apps'),
    get: (id: string) => request<AppDetail>('GET', `/v1/apps/${enc(id)}`),
    create: (body: { appId: string; name?: string; description?: string }) => request<AppCreateResult>('POST', '/v1/apps', { body }),
    update: (id: string, body: { name?: string; description?: string }, revision?: number) => request<AppSummary>('PATCH', `/v1/apps/${enc(id)}`, {
      body, ...(revision === undefined ? {} : { headers: { 'if-match': etag(revision) } })
    }),
    remove: (id: string) => request<unknown>('DELETE', `/v1/apps/${enc(id)}`),
    getDraft: (id: string) => request<AppDraft>('GET', `/v1/apps/${enc(id)}/draft`),
    putDraft: (id: string, files: Record<string, string>, revision?: number) => request<AppDraft>('PUT', `/v1/apps/${enc(id)}/draft`, {
      body: { files }, ...(revision === undefined ? {} : { headers: { 'if-match': etag(revision) } })
    }),
    importDraft: async (id: string, file: Blob, fileName: string, revision?: number) =>
      await uploadArchive(`/v1/apps/${enc(id)}/draft/import`, file, fileName, revision === undefined ? undefined : etag(revision)) as AppDraft,
    exportDraft: (id: string) => download(`/v1/apps/${enc(id)}/draft/export`),
    publish: (id: string, baseRevision: number) => request<AppReleaseResult>('POST', `/v1/apps/${enc(id)}/releases`, { body: { baseRevision } }),
    listReleases: (id: string) => request<{ schemaVersion: string; appId: string; releases: AppRelease[] }>('GET', `/v1/apps/${enc(id)}/releases`),
    getRelease: (id: string, releaseId: string) => request<AppReleaseDetail>('GET', `/v1/apps/${enc(id)}/releases/${enc(releaseId)}`),
    exportRelease: (id: string, releaseId: string, format: 'source' | 'bundle') =>
      download(`/v1/apps/${enc(id)}/releases/${enc(releaseId)}/export`, { format }),
    runs: (id: string, query: { releaseId?: string | undefined; limit?: number | undefined } = {}) => request<AppRunList>('GET', `/v1/apps/${enc(id)}/runs`, { query }),
    run: (id: string, taskId: string) => request<AppRunDetail>('GET', `/v1/apps/${enc(id)}/runs/${enc(taskId)}`),
  },
  releases: {
    run: (releaseId: string, body: { task?: string; params?: Record<string, string | number> } = {}) => request<PackageRunResult>('POST', `/v1/releases/${enc(releaseId)}/runs`, { body })
  },

  schedules: {
    list: () => request<{ schedules: ScheduleSnapshot[] }>('GET', '/v1/schedules'),
    get: (id: string) => request<ScheduleSnapshot>('GET', `/v1/schedules/${enc(id)}`),
    triggers: (id: string, limit = 50) => request<{ events: ScheduleTriggerEvent[] }>('GET', `/v1/schedules/${enc(id)}/triggers`, { query: { limit } }),
    create: (definition: ScheduleDefinition, releaseId: string) => request<ScheduleSnapshot>('POST', '/v1/schedules', { body: { definition, releaseId } }),
    action: (id: string, action: 'pause' | 'resume') => request<ScheduleSnapshot>('POST', `/v1/schedules/${enc(id)}/${action}`),
    remove: (id: string) => request<unknown>('DELETE', `/v1/schedules/${enc(id)}`)
  },

  providers: {
    list: () => request<{ connections: ProviderConnection[] }>('GET', '/v1/provider-connections'),
    create: (body: ProviderConnectionWrite) => request<{ connection: ProviderConnection }>('POST', '/v1/provider-connections', { body }),
    update: (id: string, body: Partial<ProviderConnectionWrite>) => request<{ connection: ProviderConnection }>('PUT', `/v1/provider-connections/${enc(id)}`, { body }),
    remove: (id: string) => request<unknown>('DELETE', `/v1/provider-connections/${enc(id)}`),
    settings: () => request<RunAgentSettings>('GET', '/v1/run-agent/settings'),
    updateSettings: (providerConnectionId: string) => request<RunAgentSettings>('PUT', '/v1/run-agent/settings', { body: { providerConnectionId } }),
    catalogStatus: () => request<CatalogStatus>('GET', '/v1/provider-catalog/status'),
    catalogProviders: (query: { q?: string; limit?: number; cursor?: string } = {}) => request<CatalogProviderPage>('GET', '/v1/provider-catalog/providers', { query }),
    catalogModels: (query: { providerId?: string; q?: string; status?: string; limit?: number; cursor?: string } = {}) => request<CatalogModelPage>('GET', '/v1/provider-catalog/models', { query }),
    checkConnection: (body: ProviderConnectionCheck) => request<ProviderConnectionCheckResult>('POST', '/v1/provider-catalog/check-connection', { body })
  }
};
