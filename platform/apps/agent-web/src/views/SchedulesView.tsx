import { useEffect, useRef, useState } from 'react'

import type { ApiScheduleSnapshot, ApiScheduleState, ApiScheduleTriggerEvent } from '@sage/app-contracts'

import { useFeedback } from '../components/Feedback'
import { Badge, Button, ConfirmButton, EmptyState, ErrorBanner, LoadingBlock, type BadgeTone } from '../components/ui'
import { useLocale } from '../i18n'
import { deleteSchedule, getScheduleTriggers, listSchedules, pauseSchedule, resumeSchedule } from '../lib/api/schedules'
import { ApiError, toUserMessage, type ApiCtx } from '../lib/api/client'
import { formatFullTime, formatIntervalMinutes } from '../lib/format'
import { workspaceHref } from '../lib/router'

import './SchedulesView.css'

type LoadStatus = 'loading' | 'error' | 'ready'

type ScheduleActionKind = 'pause' | 'resume' | 'delete'

const STATE_TONE: Record<ApiScheduleState, BadgeTone> = {
  ACTIVE: 'running',
  PAUSED: 'paused',
  DELETED: 'neutral',
}

const KIND_TONE: Record<ApiScheduleTriggerEvent['kind'], BadgeTone> = {
  SUCCEEDED: 'succeeded',
  FAILED: 'failed',
  SKIPPED: 'paused',
  MISSED: 'warning',
}

// 10.3：401 或服务端 SCHEDULE_AUTHENTICATION_REQUIRED 都按“需要服务端凭据”处理。
function isScheduleAuthError(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 401 || error.code === 'SCHEDULE_AUTHENTICATION_REQUIRED')
}

function AuthRequiredCard() {
  const { t } = useLocale()
  return (
    <div className="schedule-auth card" role="alert">
      <h2>{t('schedules.authRequired.title')}</h2>
      <p>{t('schedules.authRequired.body')}</p>
    </div>
  )
}

export function SchedulesView({ api }: { api: ApiCtx }) {
  const { t, locale } = useLocale()
  const feedback = useFeedback()

  const [schedules, setSchedules] = useState<ApiScheduleSnapshot[]>([])
  const [listStatus, setListStatus] = useState<LoadStatus>('loading')
  const [listAuthRequired, setListAuthRequired] = useState(false)
  const [listErrorMessage, setListErrorMessage] = useState('')
  const [refreshTick, setRefreshTick] = useState(0)

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [historyTick, setHistoryTick] = useState(0)

  const [pendingAction, setPendingAction] = useState<{ scheduleId: string; kind: ScheduleActionKind } | null>(null)
  const actionGuard = useRef(false)

  useEffect(() => {
    const controller = new AbortController()
    setListStatus('loading')
    listSchedules(api, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return
        setSchedules(result?.schedules ?? [])
        setListAuthRequired(false)
        setListStatus('ready')
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        setListAuthRequired(isScheduleAuthError(error))
        setListErrorMessage(toUserMessage(error))
        setListStatus('error')
      })
    return () => controller.abort()
  }, [api, locale, refreshTick])

  const toggleSelect = (scheduleId: string) => {
    setSelectedId((current) => (current === scheduleId ? null : scheduleId))
  }

  const runAction = async (schedule: ApiScheduleSnapshot, kind: ScheduleActionKind) => {
    if (actionGuard.current) return
    const scheduleId = schedule.definition.scheduleId
    actionGuard.current = true
    setPendingAction({ scheduleId, kind })
    try {
      if (kind === 'pause') await pauseSchedule(api, scheduleId)
      else if (kind === 'resume') await resumeSchedule(api, scheduleId)
      else await deleteSchedule(api, scheduleId)

      feedback.success(t(kind === 'pause' ? 'schedules.pause' : kind === 'resume' ? 'schedules.resume' : 'schedules.delete'))
      if (kind === 'delete' && selectedId === scheduleId) setSelectedId(null)
      setRefreshTick((tick) => tick + 1)
      if (kind !== 'delete' && selectedId === scheduleId) setHistoryTick((tick) => tick + 1)
    } catch (error: unknown) {
      feedback.error(t('schedules.actionFailed'), { body: toUserMessage(error) })
    } finally {
      actionGuard.current = false
      setPendingAction(null)
    }
  }

  const actionPending = pendingAction !== null

  return (
    <div className="view schedules-view">
      <div className="schedules-toolbar">
        <Button
          size="sm"
          loading={listStatus === 'loading'}
          disabled={listStatus === 'loading'}
          onClick={() => setRefreshTick((tick) => tick + 1)}
        >
          {listStatus === 'loading' ? t('common.refreshing') : t('schedules.refresh')}
        </Button>
      </div>

      <div className="schedules-body">
        {listStatus === 'loading' && <LoadingBlock title={t('common.loading')} />}

        {listStatus === 'error' &&
          (listAuthRequired ? (
            <AuthRequiredCard />
          ) : (
            <ErrorBanner
              title={t('schedules.loadFailed')}
              body={listErrorMessage}
              onRetry={() => setRefreshTick((tick) => tick + 1)}
              retryLabel={t('common.retry')}
            />
          ))}

        {listStatus === 'ready' && schedules.length === 0 && <EmptyState title={t('schedules.empty')} />}

        {listStatus === 'ready' && schedules.length > 0 && (
          <div className="schedules-list">
            {schedules.map((schedule) => {
              const id = schedule.definition.scheduleId
              const selected = selectedId === id
              const pendingThis = pendingAction?.scheduleId === id ? pendingAction.kind : null
              return (
                <article key={id} className={`schedule-card card${selected ? ' is-selected' : ''}`}>
                  <div className="schedule-card-head">
                    <button
                      type="button"
                      className="schedule-id mono"
                      aria-expanded={selected}
                      onClick={() => toggleSelect(id)}
                    >
                      {id}
                    </button>
                    <Badge tone={STATE_TONE[schedule.state]}>{t(`schedules.state.${schedule.state}`)}</Badge>
                    <span className="schedule-actions">
                      {schedule.state === 'ACTIVE' && (
                        <Button
                          size="sm"
                          loading={pendingThis === 'pause'}
                          disabled={actionPending}
                          onClick={() => void runAction(schedule, 'pause')}
                        >
                          {t('schedules.pause')}
                        </Button>
                      )}
                      {schedule.state === 'PAUSED' && (
                        <Button
                          size="sm"
                          loading={pendingThis === 'resume'}
                          disabled={actionPending}
                          onClick={() => void runAction(schedule, 'resume')}
                        >
                          {t('schedules.resume')}
                        </Button>
                      )}
                      {schedule.state !== 'DELETED' && (
                        <ConfirmButton
                          label={t('schedules.delete')}
                          confirmLabel={t('schedules.deleteConfirm')}
                          danger
                          busy={pendingThis === 'delete'}
                          disabled={actionPending && pendingThis !== 'delete'}
                          onConfirm={() => void runAction(schedule, 'delete')}
                        />
                      )}
                    </span>
                  </div>
                  <div className="schedule-card-meta">
                    <span className="schedule-task mono">{schedule.definition.invocation.task}</span>
                    <span>
                      {schedule.definition.trigger.kind === 'cron'
                        ? t('schedules.trigger.cron', {
                            expression: schedule.definition.trigger.expression,
                            timezone: schedule.definition.trigger.timezone,
                          })
                        : t('schedules.trigger.interval', {
                            minutes: formatIntervalMinutes(schedule.definition.trigger.everyMs),
                          })}
                    </span>
                    <span className="mono">
                      {schedule.definition.releaseBinding.strategy === 'FIXED'
                        ? t('schedules.binding.fixed', { releaseId: schedule.definition.releaseBinding.releaseId })
                        : t('schedules.binding.follow')}
                    </span>
                    <span>
                      {t('schedules.nextFire')}
                      {': '}
                      {schedule.nextFireAtMs !== undefined
                        ? formatFullTime(new Date(schedule.nextFireAtMs).toISOString(), locale)
                        : t('schedules.nextFireNone')}
                    </span>
                  </div>
                  {selected && (
                    <ScheduleHistoryPanel
                      key={id}
                      api={api}
                      scheduleId={id}
                      refreshToken={historyTick}
                    />
                  )}
                </article>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

function ScheduleHistoryPanel({
  api,
  scheduleId,
  refreshToken,
}: {
  api: ApiCtx
  scheduleId: string
  refreshToken: number
}) {
  const { t, locale } = useLocale()
  const [events, setEvents] = useState<ApiScheduleTriggerEvent[]>([])
  const [status, setStatus] = useState<LoadStatus>('loading')
  const [authRequired, setAuthRequired] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [retryTick, setRetryTick] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    setStatus('loading')
    getScheduleTriggers(api, scheduleId, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return
        setEvents(result?.events ?? [])
        setAuthRequired(false)
        setStatus('ready')
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        setAuthRequired(isScheduleAuthError(error))
        setErrorMessage(toUserMessage(error))
        setStatus('error')
      })
    return () => controller.abort()
  }, [api, scheduleId, refreshToken, retryTick])

  return (
    <div className="schedule-history">
      <h2>{t('schedules.history.title')}</h2>
      {status === 'loading' && <LoadingBlock title={t('common.loading')} />}
      {status === 'error' &&
        (authRequired ? (
          <AuthRequiredCard />
        ) : (
          <ErrorBanner
            title={t('schedules.history.loadFailed')}
            body={errorMessage}
            onRetry={() => setRetryTick((tick) => tick + 1)}
            retryLabel={t('common.retry')}
          />
        ))}
      {status === 'ready' && events.length === 0 && <EmptyState title={t('schedules.history.empty')} />}
      {status === 'ready' && events.length > 0 && (
        <table className="data-table">
          <thead>
            <tr>
              <th>{t('schedules.history.occurrence')}</th>
              <th>{t('schedules.history.time')}</th>
              <th>{t('schedules.history.result')}</th>
              <th>{''}</th>
            </tr>
          </thead>
          <tbody>
            {events.map((event) => (
              <tr key={event.occurrenceId}>
                <td className="mono">{event.occurrenceId}</td>
                <td>{formatFullTime(new Date(event.occurredAtMs).toISOString(), locale)}</td>
                <td>
                  <Badge tone={KIND_TONE[event.kind]}>{t(`schedules.history.kind.${event.kind}`)}</Badge>
                </td>
                <td className="schedule-history-links">
                  {event.taskId !== undefined && (
                    <a href={workspaceHref({ view: 'tasks', task: event.taskId })}>
                      {t('schedules.history.openTask')}
                    </a>
                  )}
                  {event.errorCode !== undefined && (
                    <span className="schedule-error-code">
                      {t('schedules.history.errorCode')}
                      {': '}
                      <span className="mono">{event.errorCode}</span>
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
