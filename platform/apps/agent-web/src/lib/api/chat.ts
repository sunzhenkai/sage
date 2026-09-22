import type {
  ListSessionsResponse,
  Session,
  TimelineEvent,
} from '@sage/app-contracts'

import type { ApiCtx } from './client'
import { apiFetch, fetchJson } from './client'
import type { LocaleTag } from '../format'
import type { SessionHistoryStatus } from '@sage/app-contracts'

export interface ChatSessionDetail {
  session: Session
}

export interface ChatEventsResponse {
  events?: TimelineEvent[]
}

export interface SubmitMessageResult {
  message?: unknown
  run?: unknown
}

export interface RetryRunResult {
  run?: unknown
}

export interface PromotionResult {
  association?: { taskId?: string } | null
  task?: unknown
}

export function listSessions(
  ctx: ApiCtx,
  args: { status: SessionHistoryStatus; archived: boolean; query: string; cursor?: string; locale: LocaleTag; signal?: AbortSignal },
): Promise<ListSessionsResponse | null> {
  const params = new URLSearchParams()
  params.set('limit', '30')
  params.set('status', args.status)
  params.set('locale', args.locale)
  if (args.archived) params.set('archived', 'true')
  const q = args.query.trim()
  if (q) params.set('q', q)
  if (args.cursor) params.set('cursor', args.cursor)
  return fetchJson(ctx, `/chat/sessions?${params.toString()}`, { signal: args.signal })
}

export function createSession(ctx: ApiCtx, signal?: AbortSignal): Promise<Session | null> {
  return fetchJson(ctx, '/chat/sessions', { method: 'POST', body: {}, signal })
}

export function getSession(ctx: ApiCtx, sessionId: string, signal?: AbortSignal): Promise<ChatSessionDetail | null> {
  return fetchJson(ctx, `/chat/sessions/${encodeURIComponent(sessionId)}`, { signal })
}

export function archiveSession(ctx: ApiCtx, sessionId: string): Promise<unknown | null> {
  return fetchJson(ctx, `/chat/sessions/${encodeURIComponent(sessionId)}/archive`, { method: 'POST', body: {} })
}

export function unarchiveSession(ctx: ApiCtx, sessionId: string): Promise<unknown | null> {
  return fetchJson(ctx, `/chat/sessions/${encodeURIComponent(sessionId)}/unarchive`, { method: 'POST', body: {} })
}

export async function deleteSession(ctx: ApiCtx, sessionId: string): Promise<void> {
  await apiFetch(ctx, `/chat/sessions/${encodeURIComponent(sessionId)}`, { method: 'DELETE' })
}

export function getSessionEvents(ctx: ApiCtx, sessionId: string, afterSequence: number, signal?: AbortSignal): Promise<ChatEventsResponse | null> {
  return fetchJson(ctx, `/chat/sessions/${encodeURIComponent(sessionId)}/events?afterSequence=${afterSequence}`, { signal })
}

/** SSE 不做 JSON helper：返回原始 Response，调用方自管 EventSource / 解析。 */
export function timelineStreamUrl(ctx: ApiCtx, sessionId: string, afterSequence: number): string {
  return `${ctx.apiBase}/chat/sessions/${encodeURIComponent(sessionId)}/timeline?afterSequence=${afterSequence}`
}

export function submitMessage(
  ctx: ApiCtx,
  sessionId: string,
  args: { text: string; connectionId: string },
): Promise<SubmitMessageResult | null> {
  return fetchJson(ctx, `/chat/sessions/${encodeURIComponent(sessionId)}/messages`, {
    method: 'POST',
    body: {
      parts: [{ kind: 'text', text: args.text }],
      provider: { connectionId: args.connectionId },
    },
  })
}

export function retryRun(ctx: ApiCtx, runId: string, connectionId: string): Promise<RetryRunResult | null> {
  return fetchJson(ctx, `/chat/runs/${encodeURIComponent(runId)}/retry`, {
    method: 'POST',
    body: { provider: { connectionId } },
  })
}

export function promoteMessage(ctx: ApiCtx, messageId: string): Promise<PromotionResult | null> {
  return fetchJson(ctx, `/chat/messages/${encodeURIComponent(messageId)}/promotions`, {
    method: 'POST',
    body: { mode: 'explicit', taskType: 'sage.agent-task.v1' },
  })
}
