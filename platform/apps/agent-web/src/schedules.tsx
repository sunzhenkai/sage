import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocale } from './locale.js';
import { navigate } from './routing.js';
import { workspaceHref } from './workspace.js';

/**
 * P8 Schedule 管理视图（spec: ai-app-schedule-plane「Schedule API 与 UI」）：
 * 列表（状态/next fire/绑定 Release）、触发历史、暂停/恢复/删除。
 * 管理操作经同源代理携带服务端注入的 service token（浏览器不持有凭据）。
 */

export type ScheduleFetch = typeof fetch;

interface ScheduleDefinitionView {
  readonly scheduleId: string;
  readonly trigger: { readonly kind: string; readonly expression?: string; readonly timezone?: string; readonly everyMs?: number };
  readonly releaseBinding: { readonly strategy: 'FIXED' | 'FOLLOW'; readonly releaseId?: string };
  readonly invocation: { readonly task: string };
}
interface ScheduleView {
  readonly schemaVersion: '1';
  readonly definition: ScheduleDefinitionView;
  readonly revision: number;
  readonly state: 'ACTIVE' | 'PAUSED' | 'DELETED';
  readonly nextFireAtMs?: number;
}
interface ScheduleListView { readonly schemaVersion: 'ScheduleListResult.v1'; readonly schedules: readonly ScheduleView[] }
interface TriggerEventView { readonly occurrenceId: string; readonly kind: 'SUCCEEDED' | 'FAILED' | 'SKIPPED' | 'MISSED'; readonly occurredAtMs: number; readonly taskId?: string; readonly errorCode?: string }
interface TriggerHistoryView { readonly schemaVersion: 'ScheduleTriggerHistory.v1'; readonly scheduleId: string; readonly events: readonly TriggerEventView[] }

async function scheduleJson<T>(fetcher: ScheduleFetch, url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetcher(url, { ...init, credentials: 'include', headers: { ...(init.body === undefined ? {} : { 'content-type': 'application/json' }), ...init.headers } });
  if (!response.ok) {
    const body = (await response.json().catch(() => undefined)) as { error?: { code?: string; message?: string } } | undefined;
    throw new Error(body?.error?.message ?? `HTTP ${response.status}`);
  }
  return await response.json() as T;
}

export function SchedulesApp({ apiBase = '', fetcher = fetch }: { readonly apiBase?: string; readonly fetcher?: ScheduleFetch }) {
  const { t, locale, formatDateTime } = useLocale();
  const [schedules, setSchedules] = useState<readonly ScheduleView[] | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [selected, setSelected] = useState<string | undefined>(undefined);
  const [history, setHistory] = useState<readonly TriggerEventView[] | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const controller = new AbortController();
    try {
      setError(undefined);
      const body = await scheduleJson<ScheduleListView>(fetcher, `${apiBase}/v1/schedules`, { signal: controller.signal });
      setSchedules(body.schedules);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
    return () => controller.abort();
  }, [apiBase, fetcher]);

  useEffect(() => { void load(); }, [load]);

  const openDetail = useCallback(async (scheduleId: string) => {
    setSelected(scheduleId);
    setHistory(undefined);
    try {
      const body = await scheduleJson<TriggerHistoryView>(fetcher, `${apiBase}/v1/schedules/${encodeURIComponent(scheduleId)}/triggers`);
      setHistory(body.events);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [apiBase, fetcher]);

  const act = useCallback(async (scheduleId: string, action: 'pause' | 'resume' | 'delete') => {
    setBusy(true);
    try {
      await scheduleJson(fetcher, `${apiBase}/v1/schedules/${encodeURIComponent(scheduleId)}${action === 'delete' ? '' : `/${action}`}`, { method: action === 'delete' ? 'DELETE' : 'POST' });
      await load();
      if (selected === scheduleId && action !== 'delete') await openDetail(scheduleId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }, [apiBase, fetcher, load, openDetail, selected]);

  const rows = useMemo(() => schedules ?? [], [schedules]);

  return <section className="workspace-page schedules-page">
    <header className="page-heading">
      <div><p className="eyebrow">{t('schedulesEyebrow')}</p><h1>{t('schedules')}</h1><p className="page-subtitle">{t('schedulesSubtitle')}</p></div>
      <div className="page-heading-actions"><button className="button button-secondary" type="button" onClick={() => void load()}>↻ {t('refresh')}</button></div>
    </header>
    {error !== undefined && <div className="banner banner-error" role="alert">{error || t('scheduleDataUnavailable')}</div>}
    {schedules === undefined
      ? <p className="loading-note">{t('loadingSchedules')}</p>
      : rows.length === 0
        ? <p className="empty-note">{t('noSchedules')}</p>
        : <table className="task-table" data-testid="schedule-list">
            <thead><tr><th>{t('scheduleId')}</th><th>{t('status')}</th><th>{t('scheduleTrigger')}</th><th>{t('scheduleBinding')}</th><th>{t('nextFire')}</th><th>{t('actions')}</th></tr></thead>
            <tbody>
              {rows.map(schedule => <tr key={schedule.definition.scheduleId} className="task-row">
                <td><button className="button-link" type="button" data-testid={`schedule-${schedule.definition.scheduleId}`} onClick={() => void openDetail(schedule.definition.scheduleId)}>{schedule.definition.scheduleId}</button><code className="mono">{schedule.definition.invocation.task}</code></td>
                <td><span className={`status-badge status-${schedule.state === 'ACTIVE' ? 'succeeded' : 'neutral'}`}>{schedule.state}</span></td>
                <td>{schedule.definition.trigger.kind === 'cron' ? `${schedule.definition.trigger.expression} (${schedule.definition.trigger.timezone})` : `every ${Math.round((schedule.definition.trigger.everyMs ?? 0) / 60_000)}m`}</td>
                <td>{schedule.definition.releaseBinding.strategy === 'FIXED' ? `FIXED ${schedule.definition.releaseBinding.releaseId}` : 'FOLLOW'}</td>
                <td>{schedule.nextFireAtMs === undefined ? '—' : <time dateTime={new Date(schedule.nextFireAtMs).toISOString()}>{formatDateTime(new Date(schedule.nextFireAtMs).toISOString())}</time>}</td>
                <td className="schedule-actions">
                  {schedule.state === 'ACTIVE'
                    ? <button className="button button-secondary" type="button" disabled={busy} onClick={() => void act(schedule.definition.scheduleId, 'pause')}>{t('pause')}</button>
                    : <button className="button button-secondary" type="button" disabled={busy} onClick={() => void act(schedule.definition.scheduleId, 'resume')}>{t('resume')}</button>}
                  <button className="button button-danger" type="button" disabled={busy} onClick={() => { if (confirm(t('confirmScheduleDelete'))) void act(schedule.definition.scheduleId, 'delete'); }}>{t('delete')}</button>
                </td>
              </tr>)}
            </tbody>
          </table>}
    {selected !== undefined && <div className="panel schedule-detail" data-testid="schedule-detail">
      <h2>{t('scheduleTriggerHistory')} · {selected}</h2>
      {history === undefined
        ? <p className="loading-note">{t('loadingTriggerHistory')}</p>
        : history.length === 0
          ? <p className="empty-note">{t('noTriggerEvents')}</p>
          : <ul className="trigger-history">
              {history.map(event => <li key={event.occurrenceId} className="trigger-event-row">
                <span className={`badge badge-${event.kind === 'SUCCEEDED' ? 'success' : event.kind === 'FAILED' ? 'danger' : event.kind === 'MISSED' ? 'warning' : 'info'}`}>{event.kind}</span>
                <code className="mono">{event.occurrenceId}</code>
                <time dateTime={new Date(event.occurredAtMs).toISOString()}>{formatDateTime(new Date(event.occurredAtMs).toISOString())}</time>
                {event.taskId !== undefined && <a className="task-workspace-link" href={workspaceHref({ view: 'tasks' })} onClick={(event) => { event.preventDefault(); navigate(workspaceHref({ view: 'tasks' })); }}>{event.taskId}</a>}
                {event.errorCode !== undefined && <span className="badge badge-danger">{event.errorCode}</span>}
              </li>)}
            </ul>}
    </div>}
    <p className="page-subtitle">{locale === 'zh-CN' ? '管理操作需要 service token 认证；UI 凭据由同源代理注入。' : 'Management operations require service token auth; credentials are injected by the same-origin proxy.'}</p>
  </section>;
}
