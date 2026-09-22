import type { ApiScheduleListResponse, ApiScheduleTriggerHistoryResponse } from '@sage/app-contracts'

import type { ApiCtx } from './client'
import { apiFetch, fetchJson } from './client'

export function listSchedules(ctx: ApiCtx, signal?: AbortSignal): Promise<ApiScheduleListResponse | null> {
  return fetchJson(ctx, '/schedules', { signal })
}

export function getScheduleTriggers(ctx: ApiCtx, scheduleId: string, signal?: AbortSignal): Promise<ApiScheduleTriggerHistoryResponse | null> {
  return fetchJson(ctx, `/schedules/${encodeURIComponent(scheduleId)}/triggers`, { signal })
}

export function pauseSchedule(ctx: ApiCtx, scheduleId: string): Promise<unknown | null> {
  return fetchJson(ctx, `/schedules/${encodeURIComponent(scheduleId)}/pause`, { method: 'POST', body: {} })
}

export function resumeSchedule(ctx: ApiCtx, scheduleId: string): Promise<unknown | null> {
  return fetchJson(ctx, `/schedules/${encodeURIComponent(scheduleId)}/resume`, { method: 'POST', body: {} })
}

export async function deleteSchedule(ctx: ApiCtx, scheduleId: string): Promise<void> {
  await apiFetch(ctx, `/schedules/${encodeURIComponent(scheduleId)}`, { method: 'DELETE' })
}
