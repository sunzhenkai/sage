import { getSettings } from './settings';
import type {
  AppDetail, AppSummary, CatalogStatus, ChatRun, Message, PackageSummary, ProviderConnection, ProviderConnectionWrite, RunAgentSettings,
  RunLogPage, ScheduleDefinition, ScheduleSnapshot, ScheduleTriggerEvent, Session, SessionDetail, SessionList, TaskArtifact, TaskEvent,
  TaskStatus, TaskView, TimelineEvent
} from './types';

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly retryable = false) {
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

export function authHeaders(): Record<string, string> {
  const token = getSettings().serviceToken.trim();
  return token ? { authorization: `Bearer ${token}` } : {};
}

type Query = Record<string, string | number | boolean | undefined>;

async function request<T>(method: string, path: string, options: { query?: Query; body?: unknown } = {}): Promise<T> {
  const headers: Record<string, string> = { accept: 'application/json', ...authHeaders() };
  const init: RequestInit = { method, headers };
  if (options.body !== undefined) { headers['content-type'] = 'application/json'; init.body = JSON.stringify(options.body); }
  else if (method === 'POST') { headers['content-type'] = 'application/json'; init.body = '{}'; }
  const response = await fetch(apiUrl(path, options.query), init);
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  let data: unknown = undefined;
  try { data = text ? JSON.parse(text) : undefined; } catch { data = text; }
  if (!response.ok) {
    const error = (data as { error?: { code?: string; message?: string; retryable?: boolean }; code?: string; message?: string } | undefined);
    const code = error?.error?.code ?? error?.code ?? `HTTP_${response.status}`;
    const message = error?.error?.message ?? error?.message ?? response.statusText;
    throw new ApiError(response.status, code, message, error?.error?.retryable ?? false);
  }
  return data as T;
}

const enc = encodeURIComponent;

export const api = {
  health: () => request<{ status: string }>('GET', '/livez'),
  ready: () => request<Record<string, unknown>>('GET', '/readyz'),

  chat: {
    listSessions: (query: { limit?: number | undefined; q?: string | undefined; archived?: boolean | undefined; cursor?: string | undefined } = {}) => request<SessionList>('GET', '/v1/chat/sessions', { query }),
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
    remove: (id: string) => request<unknown>('DELETE', `/v1/apps/${enc(id)}`)
  },
  packages: {
    list: () => request<{ packages: PackageSummary[] }>('GET', '/v1/packages'),
    get: (id: string) => request<Record<string, unknown>>('GET', `/v1/packages/${enc(id)}`)
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
    catalogStatus: () => request<CatalogStatus>('GET', '/v1/provider-catalog/status')
  }
};
