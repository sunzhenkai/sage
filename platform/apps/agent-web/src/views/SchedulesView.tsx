import { useEffect, useRef, useState } from 'react'

import type { ApiScheduleSnapshot, ApiScheduleState, ApiScheduleTriggerEvent } from '@sage/app-contracts'

import { useFeedback } from '../components/Feedback'
import { Badge, Button, ConfirmButton, EmptyState, ErrorBanner, LoadingBlock, TopbarActions, type BadgeTone } from '../components/ui'
import { useLocale } from '../i18n'
import { deleteSchedule, getScheduleTriggers, listSchedules, pauseSchedule, resumeSchedule } from '../lib/api/schedules'
import { ApiError, toUserMessage, type ApiCtx } from '../lib/api/client'
import { formatFullTime, formatIntervalMinutes } from '../lib/format'
import { navigate, workspaceHref } from '../lib/router'

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

// 三段式：选中态由查询参数 schedule= 驱动（不再用组件内 useState 展开）。
export function SchedulesView({ api, schedule }: { api: ApiCtx; schedule?: string }) {
  const { t, locale } = useLocale()
  const feedback = useFeedback()

  const [schedules, setSchedules] = useState<ApiScheduleSnapshot[]>([])
  const [listStatus, setListStatus] = useState<LoadStatus>('loading')
  const [listAuthRequired, setListAuthRequired] = useState(false)
  const [listErrorMessage, setListErrorMessage] = useState('')
  const [refreshTick, setRefreshTick] = useState(0)

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

  const selectedId = schedule
  const selectedSnapshot = selectedId !== undefined ? schedules.find((s) => s.definition.scheduleId === selectedId) ?? null : null

  const select = (id: string | null) => {
    navigate(workspaceHref(id !== null ? { view: 'schedules', schedule: id } : { view: 'schedules' }))
  }

  const runAction = async (item: ApiScheduleSnapshot, kind: ScheduleActionKind) => {
    if (actionGuard.current) return
    const scheduleId = item.definition.scheduleId
    actionGuard.current = true
    setPendingAction({ scheduleId, kind })
    try {
      if (kind === 'pause') await pauseSchedule(api, scheduleId)
      else if (kind === 'resume') await resumeSchedule(api, scheduleId)
      else await deleteSchedule(api, scheduleId)

      feedback.success(t(kind === 'pause' ? 'schedules.pause' : kind === 'resume' ? 'schedules.resume' : 'schedules.delete'))
      if (kind === 'delete' && selectedId === scheduleId) select(null)
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
  const pendingThis = selectedId !== undefined && pendingAction?.scheduleId === selectedId ? pendingAction.kind : null

  return (
    <div className="view schedules-view">
      <TopbarActions>
        <Button
          size="sm"
          loading={listStatus === 'loading'}
          disabled={listStatus === 'loading'}
          onClick={() => setRefreshTick((tick) => tick + 1)}
        >
          {listStatus === 'loading' ? t('common.refreshing') : t('schedules.refresh')}
        </Button>
      </TopbarActions>

      {/* 层 2：列表栏 —— id + 状态 + task 简表 */}
      <aside className="schedules-list-pane">
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
          <div className="schedules-list" role="list">
            {schedules.map((item) => {
              const id = item.definition.scheduleId
              const isCurrent = id === selectedId
              return (
                <a
                  key={id}
                  role="listitem"
                  className={`schedule-row pane-item${isCurrent ? ' is-current' : ''}`}
                  aria-current={isCurrent ? 'true' : undefined}
                  href={workspaceHref({ view: 'schedules', schedule: id })}
                >
                  <span className="schedule-row-top">
                    <span className="schedule-row-id mono">{id}</span>
                    <Badge tone={STATE_TONE[item.state]}>{t(`schedules.state.${item.state}`)}</Badge>
                  </span>
                  <span className="schedule-row-task mono">{item.definition.invocation.task}</span>
                </a>
              )
            })}
          </div>
        )}
      </aside>

      {/* 层 3：内容区 —— 选中项触发配置 + 动作 + 触发历史 */}
      <div className="schedule-detail">
        {selectedId === undefined && listStatus !== 'error' && <EmptyState title={t('schedules.selectPrompt')} />}
        {selectedId !== undefined && listStatus === 'loading' && <LoadingBlock title={t('common.loading')} />}
        {selectedId !== undefined && listStatus === 'error' && !listAuthRequired && (
          <ErrorBanner
            title={t('schedules.loadFailed')}
            body={listErrorMessage}
            onRetry={() => setRefreshTick((tick) => tick + 1)}
            retryLabel={t('common.retry')}
          />
        )}
        {selectedId !== undefined && listStatus === 'ready' && selectedSnapshot === null && (
          <EmptyState title={t('schedules.notFound')} />
        )}
        {selectedSnapshot !== null && (
          <>
            <div className="schedule-detail-head">
              <div className="schedule-detail-title">
                <h2 className="schedule-detail-id mono">{selectedSnapshot.definition.scheduleId}</h2>
                <Badge tone={STATE_TONE[selectedSnapshot.state]}>{t(`schedules.state.${selectedSnapshot.state}`)}</Badge>
              </div>
              <span className="schedule-actions">
                {selectedSnapshot.state === 'ACTIVE' && (
                  <Button
                    size="sm"
                    loading={pendingThis === 'pause'}
                    disabled={actionPending}
                    onClick={() => void runAction(selectedSnapshot, 'pause')}
                  >
                    {t('schedules.pause')}
                  </Button>
                )}
                {selectedSnapshot.state === 'PAUSED' && (
                  <Button
                    size="sm"
                    loading={pendingThis === 'resume'}
                    disabled={actionPending}
                    onClick={() => void runAction(selectedSnapshot, 'resume')}
                  >
                    {t('schedules.resume')}
                  </Button>
                )}
                {selectedSnapshot.state !== 'DELETED' && (
                  <ConfirmButton
                    label={t('schedules.delete')}
                    confirmLabel={t('schedules.deleteConfirm')}
                    danger
                    busy={pendingThis === 'delete'}
                    disabled={actionPending && pendingThis !== 'delete'}
                    onConfirm={() => void runAction(selectedSnapshot, 'delete')}
                  />
                )}
              </span>
            </div>

            <div className="schedule-meta">
              <span className="schedule-task mono">{selectedSnapshot.definition.invocation.task}</span>
              <span>
                {selectedSnapshot.definition.trigger.kind === 'cron'
                  ? t('schedules.trigger.cron', {
                      expression: selectedSnapshot.definition.trigger.expression,
                      timezone: selectedSnapshot.definition.trigger.timezone,
                    })
                  : t('schedules.trigger.interval', {
                      minutes: formatIntervalMinutes(selectedSnapshot.definition.trigger.everyMs),
                    })}
              </span>
              <span className="mono">
                {selectedSnapshot.definition.releaseBinding.strategy === 'FIXED'
                  ? t('schedules.binding.fixed', { releaseId: selectedSnapshot.definition.releaseBinding.releaseId })
                  : t('schedules.binding.follow')}
              </span>
              <span>
                {t('schedules.nextFire')}
                {': '}
                {selectedSnapshot.nextFireAtMs !== undefined
                  ? formatFullTime(new Date(selectedSnapshot.nextFireAtMs).toISOString(), locale)
                  : t('schedules.nextFireNone')}
              </span>
            </div>

            {/* key=id：切换选中即卸载重挂，effect 以 scheduleId 为依赖——旧历史请求不会写入新 id */}
            <ScheduleHistoryPanel key={selectedSnapshot.definition.scheduleId} api={api} scheduleId={selectedSnapshot.definition.scheduleId} refreshToken={historyTick} />
          </>
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
        <div className="table-scroll">
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
        </div>
      )}
    </div>
  )
}
