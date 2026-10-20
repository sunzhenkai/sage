import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { BarList, ChartCard, Legend, StackedBars, useChartTheme, type Series } from '@/components/charts';
import { CalendarClock, Clock, Pause, Play, Plus, ShieldCheck, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { Crumb, PageHeader } from '@/components/layout/app-shell';
import { StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/input';
import { Empty, ErrorState, JsonView, Loading, Mono } from '@/components/ui/misc';
import { StatusPill, toneFor } from '@/components/bui/atoms';
import { PageContent, PageDescription, Quiet, Section } from '@/components/layout/page';
import { FlowChip, Flowchart } from '@/components/bui/flowchart';
import { TaskRows } from '@/components/bui/task-rows';
import { DetailLayout, ListRow, Pill, Property, PropertyGroup, RowId, RowMeta, RowTitle } from '@/components/ui/list';
import { StatusIcon } from '@/components/ui/status';
import { api } from '@/lib/api';
import { useT, type Translator } from '@/lib/i18n';
import { useSettings } from '@/lib/settings';
import type { ScheduleDefinition, ScheduleTrigger, ScheduleTriggerEvent } from '@/lib/types';
import { formatTime, relativeTime, shortDate } from '@/lib/utils';

function describeTrigger(trigger: ScheduleTrigger, t: Translator): string {
  return trigger.kind === 'cron' ? t('schedules.trigger.cron', { expression: trigger.expression, timezone: trigger.timezone }) : t('schedules.trigger.every', { minutes: Math.round(trigger.everyMs / 60_000) });
}

/** Trigger outcome pills reuse the shared `status.*` vocabulary (en keeps the raw kind wording). */
const triggerKindKeys: Record<ScheduleTriggerEvent['kind'], string> = { SUCCEEDED: 'status.succeeded', FAILED: 'status.failed', SKIPPED: 'status.skipped', MISSED: 'status.missed' };

export function SchedulesPage() {
  const navigate = useNavigate();
  const t = useT();
  const [search, setSearch] = useSearchParams();
  const [open, setOpen] = useState(false);
  const schedules = useQuery({ queryKey: ['schedules'], queryFn: api.schedules.list, retry: false });
  const ct = useChartTheme();
  const trigQs = useQueries({ queries: (schedules.data?.schedules ?? []).map((s) => ({ queryKey: ['schedule', s.definition.scheduleId, 'triggers'], queryFn: () => api.schedules.triggers(s.definition.scheduleId, 200), retry: false, staleTime: 60_000 })) });
  const events = trigQs.flatMap((q) => q.data?.events ?? []);
  const trigSeries: Series[] = [{ key: 'SUCCEEDED', label: t('status.succeeded'), color: ct.status.succeeded! }, { key: 'FAILED', label: t('status.failed'), color: ct.status.failed! }, { key: 'MISSED', label: t('status.missed'), color: ct.status.paused! }, { key: 'SKIPPED', label: t('status.skipped'), color: ct.status.cancelled! }];
  const trigByDay = Array.from({ length: 14 }, (_, i) => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - 13 + i); const lo = d.getTime();
    const inDay = events.filter((e) => e.occurredAtMs >= lo && e.occurredAtMs < lo + 86_400_000);
    return { label: shortDate(d), ...Object.fromEntries(trigSeries.map((s) => [s.key, inDay.filter((e) => e.kind === s.key).length])) }; });
  const upcoming = (schedules.data?.schedules ?? []).filter((x) => x.state === 'ACTIVE' && x.nextFireAtMs).sort((a, b) => (a.nextFireAtMs ?? 0) - (b.nextFireAtMs ?? 0)).slice(0, 6);
  useEffect(() => { if (search.get('new') === '1') { setOpen(true); setSearch({}, { replace: true }); } }, [search, setSearch]);
  return (
    <>
      <PageHeader title={t('nav.schedules')} meta={schedules.data ? `${schedules.data.schedules.length}` : null}
        actions={<Dialog open={open} onOpenChange={setOpen}>
          <Button variant="secondary" size="sm" onClick={() => setOpen(true)}><Plus />{t('schedules.new')}</Button>
          <DialogContent title={t('schedules.new')} description={t('schedules.dialog.description')}><CreateScheduleForm onDone={(id) => { setOpen(false); navigate(`/schedules/${id}`); }} /></DialogContent>
        </Dialog>} />
      <PageContent width="wide">
        {schedules.isLoading ? <Loading /> : schedules.error ? <ErrorState error={schedules.error} /> : !schedules.data?.schedules.length ? <Empty icon={CalendarClock} title={t('schedules.empty.title')} hint={t('schedules.empty.hint')} /> : (
          <>
          <Section title={t('schedules.activity.title')} description={t('schedules.activity.description')}>
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
              <ChartCard className="lg:col-span-9" title={t('schedules.activity.triggerHistory')} description={t('schedules.activity.occurrences', { count: events.length })} actions={<Legend series={trigSeries} />}>
                <StackedBars data={trigByDay} series={trigSeries} height={176} />
              </ChartCard>
              <ChartCard className="lg:col-span-3" title={t('schedules.activity.nextRuns')} description={t('schedules.activity.minutesUntilNext')}>
                <BarList items={upcoming.map((x) => ({ name: x.definition.displayName ?? x.definition.scheduleId, value: Math.max(0, Math.round(((x.nextFireAtMs ?? 0) - Date.now()) / 60_000)) }))} color={ct.series[0]!} format={(n) => (n >= 60 ? t('schedules.activity.hoursMinutes', { hours: Math.floor(n / 60), minutes: n % 60 }) : t('schedules.activity.minutes', { minutes: n }))} />
              </ChartCard>
            </div>
          </Section>
          {(['ACTIVE', 'PAUSED'] as const).map((state) => {
            const items = schedules.data.schedules.filter((x) => x.state === state);
            if (!items.length) return null;
            return (
              <Section card key={state} title={state === 'ACTIVE' ? t('schedules.sections.active') : t('schedules.sections.paused')} description={state === 'ACTIVE' ? t('schedules.sections.activeDescription') : t('schedules.sections.pausedDescription')} count={items.length}>
                <div className="divide-y divide-line">
                {items.map((x) => (
                  <ListRow key={x.definition.scheduleId} onClick={() => navigate(`/schedules/${x.definition.scheduleId}`)}>
                    <RowId>{t('schedules.row.revision', { revision: x.revision })}</RowId>
                    <StatusIcon status={state === 'ACTIVE' ? 'running' : 'paused'} />
                    <RowTitle sub={describeTrigger(x.definition.trigger, t)}>{x.definition.displayName ?? x.definition.scheduleId}</RowTitle>
                    <RowMeta>
                      <Pill color="var(--violet)">{x.definition.invocation.task}</Pill>
                      <span className="w-28 text-right text-faint">{x.nextFireAtMs ? t('schedules.row.next', { time: relativeTime(x.nextFireAtMs) }) : '—'}</span>
                    </RowMeta>
                  </ListRow>
                ))}
                </div>
              </Section>
            );
          })}
          </>
        )}
      </PageContent>
    </>
  );
}

function CreateScheduleForm({ onDone }: { onDone: (scheduleId: string) => void }) {
  const t = useT();
  const settings = useSettings();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    scheduleId: '', displayName: '', appId: '', releaseId: '', triggerKind: 'cron', expression: '0 9 * * *', timezone: 'Asia/Shanghai', everyMin: '60',
    overlap: 'SKIP', misfire: 'SKIP', binding: 'FOLLOW', env: 'local', task: '', params: '{}', runsLimit: '24'
  });
  const [localError, setLocalError] = useState<string>();
  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const apps = useQuery({ queryKey: ['apps'], queryFn: api.apps.list, retry: false });
  const releases = useQuery({
    queryKey: ['app-releases', form.appId],
    queryFn: () => api.apps.listReleases(form.appId),
    enabled: form.appId !== '',
    retry: false
  });
  const releaseList = releases.data?.releases ?? [];
  const selectedRelease = releaseList.find((release) => release.releaseId === form.releaseId);
  const anchor = form.binding === 'FIXED' ? selectedRelease : releaseList[0];
  const create = useMutation({
    mutationFn: (input: { definition: ScheduleDefinition; anchorReleaseId: string }) => api.schedules.create(input.definition, input.anchorReleaseId),
    onSuccess: (snapshot) => { void queryClient.invalidateQueries({ queryKey: ['schedules'] }); onDone(snapshot.definition.scheduleId); }
  });
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setLocalError(undefined);
    if (form.appId === '') { setLocalError(t('schedules.form.selectApp')); return; }
    if (anchor === undefined) { setLocalError(t('schedules.form.noReleases')); return; }
    let params: Record<string, string | number>;
    try { params = JSON.parse(form.params || '{}') as Record<string, string | number>; } catch { setLocalError(t('schedules.form.paramsError')); return; }
    const definition: ScheduleDefinition = {
      schemaVersion: '1', scheduleId: form.scheduleId, tenantId: settings.tenantId,
      ...(form.displayName ? { displayName: form.displayName } : {}),
      trigger: form.triggerKind === 'cron' ? { kind: 'cron', expression: form.expression, timezone: form.timezone } : { kind: 'interval', everyMs: Number(form.everyMin) * 60_000 },
      overlapPolicy: form.overlap as ScheduleDefinition['overlapPolicy'], misfirePolicy: form.misfire as ScheduleDefinition['misfirePolicy'],
      releaseBinding: form.binding === 'FIXED' ? { strategy: 'FIXED', releaseId: anchor.releaseId, contentDigest: anchor.contentDigest } : { strategy: 'FOLLOW' },
      targetConstraints: { allowedEnvironments: [form.env as ScheduleDefinition['targetConstraints']['allowedEnvironments'][number]] },
      budget: { limits: [{ dimension: 'runs', limit: Number(form.runsLimit) }] },
      invocation: { task: form.task, ...(Object.keys(params).length ? { params } : {}) }
    };
    create.mutate({ definition, anchorReleaseId: anchor.releaseId });
  };
  return (
    <form onSubmit={submit} className="grid grid-cols-2 gap-3">
      <Field label={t('schedules.form.scheduleId')} hint={t('schedules.form.scheduleIdHint')}><Input required pattern={'^[a-z0-9][a-z0-9._\\-]{2,127}$'} value={form.scheduleId} onChange={set('scheduleId')} /></Field>
      <Field label={t('schedules.form.displayName')}><Input value={form.displayName} onChange={set('displayName')} /></Field>
      <Field label={t('schedules.form.app')} hint={t('schedules.form.selectApp')}>
        <Select required value={form.appId} onChange={(event) => setForm((f) => ({ ...f, appId: event.target.value, releaseId: '' }))}>
          <option value="">{t('schedules.form.selectApp')}</option>
          {(apps.data?.apps ?? []).map((app) => <option key={app.appId} value={app.appId}>{app.appId}</option>)}
        </Select>
      </Field>
      <Field label={t('schedules.form.binding')}><Select value={form.binding} onChange={set('binding')}><option>FOLLOW</option><option>FIXED</option></Select></Field>
      {form.binding === 'FIXED' ? (
        <div className="col-span-2">
          <Field label={t('schedules.form.release')} hint={t('schedules.form.releaseHint')}>
            <Select required value={form.releaseId} onChange={set('releaseId')}>
              <option value="">{t('schedules.form.selectRelease')}</option>
              {releaseList.map((release) => <option key={release.releaseId} value={release.releaseId}>v{release.packageVersion} · {release.releaseId}</option>)}
            </Select>
          </Field>
          {form.appId !== '' && releases.isSuccess && releaseList.length === 0 ? <p className="mt-1 text-2xs text-amber">{t('schedules.form.noReleases')}</p> : null}
        </div>
      ) : (
        <div className="col-span-2">
          <p className="text-2xs leading-4 text-faint">{t('schedules.form.releaseHint')}</p>
          {anchor === undefined ? (form.appId !== '' && releases.isSuccess ? <p className="text-2xs text-amber">{t('schedules.form.noReleases')}</p> : null) : (
            <p className="text-2xs text-muted">{t('schedules.form.followLatest')}: <Mono>v{anchor.packageVersion} · {anchor.releaseId}</Mono></p>
          )}
        </div>
      )}
      <Field label={t('schedules.form.trigger')}><Select value={form.triggerKind} onChange={set('triggerKind')}><option value="cron">cron</option><option value="interval">interval</option></Select></Field>
      {form.triggerKind === 'cron' ? <>
        <Field label={t('schedules.form.cronExpression')}><Input required value={form.expression} onChange={set('expression')} /></Field>
        <Field label={t('schedules.form.timezone')}><Input required value={form.timezone} onChange={set('timezone')} /></Field>
      </> : <Field label={t('schedules.form.every')}><Input type="number" min={1} required value={form.everyMin} onChange={set('everyMin')} /></Field>}
      <Field label={t('schedules.form.overlapPolicy')}><Select value={form.overlap} onChange={set('overlap')}><option>SKIP</option><option>ALLOW</option><option>BUFFER_ONE</option></Select></Field>
      <Field label={t('schedules.form.misfirePolicy')}><Select value={form.misfire} onChange={set('misfire')}><option>SKIP</option><option>CATCH_UP_ONE</option></Select></Field>
      <Field label={t('schedules.form.environment')}><Select value={form.env} onChange={set('env')}><option>local</option><option>development</option><option>staging</option><option>production</option></Select></Field>
      <Field label={t('schedules.form.budgetRunsLimit')}><Input type="number" min={1} required value={form.runsLimit} onChange={set('runsLimit')} /></Field>
      <Field label={t('schedules.form.invocationTask')} hint={t('schedules.form.invocationTaskHint')}><Input required pattern={'^[a-z][a-z0-9\\-]{0,63}$'} value={form.task} onChange={set('task')} /></Field>
      <div className="col-span-2"><Field label={t('schedules.form.invocationParams')}><Textarea rows={3} className="font-mono text-xs" value={form.params} onChange={set('params')} /></Field></div>
      <div className="col-span-2 text-[11px] text-muted">{t('schedules.form.tenantPrefix')} <Mono>{settings.tenantId}</Mono> {t('schedules.form.tenantSuffix')}</div>
      {localError || create.error ? <div className="col-span-2"><ErrorState error={localError ?? create.error} /></div> : null}
      <div className="col-span-2 flex justify-end"><Button type="submit" disabled={create.isPending}>{t('schedules.form.submit')}</Button></div>
    </form>
  );
}

export function ScheduleDetailPage() {
  const { scheduleId = '' } = useParams();
  const navigate = useNavigate();
  const t = useT();
  const queryClient = useQueryClient();
  const schedule = useQuery({ queryKey: ['schedule', scheduleId], queryFn: () => api.schedules.get(scheduleId), retry: false });
  const triggers = useQuery({ queryKey: ['schedule', scheduleId, 'triggers'], queryFn: () => api.schedules.triggers(scheduleId, 100), retry: false });
  const action = useMutation({ mutationFn: (a: 'pause' | 'resume') => api.schedules.action(scheduleId, a), onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ['schedule', scheduleId] }); } });
  const remove = useMutation({ mutationFn: () => api.schedules.remove(scheduleId), onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ['schedules'] }); navigate('/schedules'); } });
  const s = schedule.data;
  return (
    <>
      <PageHeader breadcrumb={<Crumb to="/schedules">{t('nav.schedules')}</Crumb>} title={<Mono>{scheduleId}</Mono>}
        meta={s ? <><StatusBadge status={s.state} /><span>{t('schedules.detail.rev', { revision: s.revision })}</span></> : null}
        actions={<>
          {s?.state === 'PAUSED'
            ? <Button variant="ghost" size="sm" onClick={() => action.mutate('resume')} disabled={action.isPending}><Play />{t('common.resume')}</Button>
            : <Button variant="ghost" size="sm" onClick={() => action.mutate('pause')} disabled={!s || action.isPending}><Pause />{t('common.pause')}</Button>}
          <Button variant="ghost" size="sm" className="hover:text-red" disabled={!s || remove.isPending} onClick={() => { if (confirm(t('schedules.detail.deleteConfirm', { schedule: scheduleId }))) remove.mutate(); }}><Trash2 />{t('common.delete')}</Button>
        </>} />
      {action.error ? <ErrorState error={action.error} /> : remove.error ? <ErrorState error={remove.error} /> : null}
      <div className="flex min-h-0 flex-1 flex-col">
        {schedule.isLoading ? <Loading /> : schedule.error ? <ErrorState error={schedule.error} /> : s ? (
          <DetailLayout properties={<>
            <PropertyGroup title={t('schedules.detail.properties')}>
              <Property label={t('schedules.detail.state')}><StatusBadge status={s.state === 'ACTIVE' ? 'active' : s.state.toLowerCase()} /></Property>
              <Property label={t('schedules.detail.trigger')}>{describeTrigger(s.definition.trigger, t)}</Property>
              <Property label={t('schedules.detail.task')}><Pill color="var(--violet)">{s.definition.invocation.task}</Pill></Property>
              <Property label={t('schedules.detail.binding')}>{s.definition.releaseBinding.strategy === 'FIXED' ? <Mono>FIXED {s.definition.releaseBinding.releaseId}</Mono> : t('schedules.detail.followLatest')}</Property>
              <Property label={t('schedules.detail.overlap')}>{s.definition.overlapPolicy}</Property>
              <Property label={t('schedules.detail.misfire')}>{s.definition.misfirePolicy}</Property>
            </PropertyGroup>
            <PropertyGroup title={t('schedules.detail.constraints')}>
              <Property label={t('schedules.detail.envs')}>{s.definition.targetConstraints.allowedEnvironments.join(', ')}</Property>
              <Property label={t('schedules.detail.budget')}>{s.definition.budget.limits.map((l) => `${l.dimension} ≤ ${l.limit}`).join(', ')}</Property>
            </PropertyGroup>
            <PropertyGroup title={t('schedules.detail.timestamps')}>
              <Property label={t('schedules.detail.nextFire')}>{formatTime(s.nextFireAtMs)}</Property>
              <Property label={t('schedules.detail.created')}>{formatTime(s.createdAtMs)}</Property>
              <Property label={t('schedules.detail.updated')}>{formatTime(s.updatedAtMs)}</Property>
              <Property label={t('schedules.detail.revision')}>{s.revision}</Property>
            </PropertyGroup>
          </>}>
            <PageContent>
              <PageDescription title={s.definition.displayName ?? s.definition.scheduleId} description={<><Mono>{s.definition.scheduleId}</Mono> · {describeTrigger(s.definition.trigger, t)}</>} />
              <Section title={t('schedules.detail.workflow')} description={t('schedules.detail.workflowDescription')}>
              <Flowchart nodes={[
                { key: 'trigger', kind: t('schedules.flow.trigger'), tone: 'purple', icon: <Clock />, title: describeTrigger(s.definition.trigger, t), sub: s.state === 'PAUSED' ? t('schedules.flow.pausedNoFire') : t('schedules.flow.nextFire', { time: relativeTime(s.nextFireAtMs) }) },
                { key: 'policy', kind: t('schedules.flow.policy'), tone: 'amber', icon: <ShieldCheck />, title: t('schedules.flow.guardRails'), sub: s.definition.targetConstraints.allowedEnvironments.join(', '),
                  body: <><span>{t('schedules.flow.overlap')}</span><FlowChip>{s.definition.overlapPolicy}</FlowChip><span>{t('schedules.flow.misfire')}</span><FlowChip>{s.definition.misfirePolicy}</FlowChip>{s.definition.budget.limits.map((l) => <FlowChip key={l.dimension} dot="var(--orange)">{l.dimension} ≤ {l.limit}</FlowChip>)}</> },
                { key: 'task', kind: t('schedules.flow.task'), tone: 'green', icon: <Play />, title: s.definition.invocation.task, sub: s.definition.releaseBinding.strategy === 'FIXED' ? t('schedules.flow.pinned', { release: s.definition.releaseBinding.releaseId }) : t('schedules.flow.followsLatest'),
                  ...(s.definition.invocation.params ? { body: Object.entries(s.definition.invocation.params).map(([k, v]) => <FlowChip key={k}>{k}: {String(v)}</FlowChip>) } : {}) }
              ]} />
              </Section>
              <Section card padded title={t('schedules.detail.triggerHistory')} description={t('schedules.detail.triggerHistoryDescription')} count={triggers.data?.events.length}>
              {triggers.isLoading ? <Loading rows={3} /> : triggers.error ? <ErrorState error={triggers.error} /> : !triggers.data?.events.length ? <Quiet>{t('schedules.detail.noTriggers')}</Quiet> : (
                <TaskRows variant="list" rows={triggers.data.events.slice(0, 30).map((e) => ({
                  key: e.occurrenceId, status: e.kind, label: formatTime(e.occurredAtMs), amount: e.taskId ? <span className="font-mono text-[12px]">{e.taskId}</span> : undefined,
                  pill: <StatusPill tone={toneFor(e.kind)}>{t(triggerKindKeys[e.kind])}</StatusPill>,
                  ...(e.taskId ? { onOpen: () => { void navigate(`/tasks/${e.taskId}`); } } : {}),
                  details: [{ label: t('schedules.detail.occurrence'), meta: e.occurrenceId }, ...(e.errorCode ? [{ label: t('schedules.detail.error'), meta: e.errorCode }] : []), ...(e.detail ? [{ label: t('schedules.detail.detail'), meta: e.detail }] : [])]
                }))} />
              )}
              </Section>
              <Section title={t('schedules.detail.rawDefinition')}><JsonView value={s.definition} filename={`${s.definition.scheduleId}.json`} /></Section>
            </PageContent>
          </DetailLayout>
        ) : null}
      </div>
    </>
  );
}
