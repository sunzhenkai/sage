import type { ApiCtx } from './client'
import { apiFetch, fetchJson } from './client'
import type {
  ArtifactContentView,
  TaskArtifactView,
  TaskEventView,
  TaskRunLogsView,
  TaskStatus,
  TaskViewModel,
} from './types'

export interface TaskListResponse {
  tasks?: TaskViewModel[]
}

export interface TaskDetailResponse extends TaskViewModel {}

export interface TaskEventsResponse {
  events?: TaskEventView[]
}

export interface TaskArtifactsResponse {
  artifacts?: TaskArtifactView[]
}

export function listTasks(ctx: ApiCtx, status: 'all' | TaskStatus, signal?: AbortSignal): Promise<TaskListResponse | null> {
  const query = status === 'all' ? '' : `?status=${encodeURIComponent(status)}`
  return fetchJson(ctx, `/tasks${query}`, { signal })
}

export function getTask(ctx: ApiCtx, taskId: string, signal?: AbortSignal): Promise<TaskDetailResponse | null> {
  return fetchJson(ctx, `/tasks/${encodeURIComponent(taskId)}`, { signal })
}

export function getTaskEvents(ctx: ApiCtx, taskId: string, signal?: AbortSignal): Promise<TaskEventsResponse | null> {
  return fetchJson(ctx, `/tasks/${encodeURIComponent(taskId)}/events`, { signal })
}

export function getTaskArtifacts(ctx: ApiCtx, taskId: string, signal?: AbortSignal): Promise<TaskArtifactsResponse | null> {
  return fetchJson(ctx, `/tasks/${encodeURIComponent(taskId)}/artifacts`, { signal })
}

export function getTaskRunLogs(
  ctx: ApiCtx,
  taskId: string,
  args: { runId?: string; attemptId?: string; fromSequence?: number; signal?: AbortSignal },
): Promise<TaskRunLogsView | null> {
  const params = new URLSearchParams()
  if (args.runId) params.set('runId', args.runId)
  if (args.attemptId) params.set('attemptId', args.attemptId)
  if (args.fromSequence !== undefined) params.set('fromSequence', String(args.fromSequence))
  const query = params.toString()
  return fetchJson(ctx, `/tasks/${encodeURIComponent(taskId)}/run-logs${query ? `?${query}` : ''}`, { signal: args.signal })
}

export function getArtifactContent(
  ctx: ApiCtx,
  taskId: string,
  artifactId: string,
  signal?: AbortSignal,
): Promise<ArtifactContentView | null> {
  return fetchJson(ctx, `/tasks/${encodeURIComponent(taskId)}/artifacts/${encodeURIComponent(artifactId)}`, { signal })
}

export type TaskSignal = 'pause' | 'resume'

export function sendTaskSignal(ctx: ApiCtx, taskId: string, kind: TaskSignal): Promise<unknown | null> {
  return fetchJson(ctx, `/tasks/${encodeURIComponent(taskId)}/signals`, { method: 'POST', body: { kind } })
}

export function cancelTask(ctx: ApiCtx, taskId: string): Promise<unknown | null> {
  return fetchJson(ctx, `/tasks/${encodeURIComponent(taskId)}/cancel`, { method: 'POST', body: {} })
}

export async function retryTask(ctx: ApiCtx, taskId: string): Promise<void> {
  await apiFetch(ctx, `/tasks/${encodeURIComponent(taskId)}/retry`, { method: 'POST', body: {} })
}
