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
import { useSettings } from '@/lib/settings';
import type { ScheduleDefinition, ScheduleTrigger } from '@/lib/types';
import { formatTime, relativeTime } from '@/lib/utils';

function describeTrigger(trigger: ScheduleTrigger): string {
  return trigger.kind === 'cron' ? `cron ${trigger.expression} (${trigger.timezone})` : `every ${Math.round(trigger.everyMs / 60_000)} min`;
}

export function SchedulesPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useSearchParams();
  const [open, setOpen] = useState(false);
  const schedules = useQuery({ queryKey: ['schedules'], queryFn: api.schedules.list, retry: false });
  const ct = useChartTheme();
  const trigQs = useQueries({ queries: (schedules.data?.schedules ?? []).map((s) => ({ queryKey: ['schedule', s.definition.scheduleId, 'triggers'], queryFn: () => api.schedules.triggers(s.definition.scheduleId, 200), retry: false, staleTime: 60_000 })) });
  const events = trigQs.flatMap((q) => q.data?.events ?? []);
  const trigSeries: Series[] = [{ key: 'SUCCEEDED', label: 'Succeeded', color: ct.status.succeeded! }, { key: 'FAILED', label: 'Failed', color: ct.status.failed! }, { key: 'MISSED', label: 'Missed', color: ct.status.paused! }, { key: 'SKIPPED', label: 'Skipped', color: ct.status.cancelled! }];
  const trigByDay = Array.from({ length: 14 }, (_, i) => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - 13 + i); const lo = d.getTime();
    const inDay = events.filter((e) => e.occurredAtMs >= lo && e.occurredAtMs < lo + 86_400_000);
    return { label: d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }), ...Object.fromEntries(trigSeries.map((s) => [s.key, inDay.filter((e) => e.kind === s.key).length])) }; });
  const upcoming = (schedules.data?.schedules ?? []).filter((x) => x.state === 'ACTIVE' && x.nextFireAtMs).sort((a, b) => (a.nextFireAtMs ?? 0) - (b.nextFireAtMs ?? 0)).slice(0, 6);
  useEffect(() => { if (search.get('new') === '1') { setOpen(true); setSearch({}, { replace: true }); } }, [search, setSearch]);
  return (
    <>
      <PageHeader title="Schedules" meta={schedules.data ? `${schedules.data.schedules.length}` : null}
        actions={<Dialog open={open} onOpenChange={setOpen}>
          <Button variant="secondary" size="sm" onClick={() => setOpen(true)}><Plus />New schedule</Button>
          <DialogContent title="New schedule" description="POST /v1/schedules — requires a service token."><CreateScheduleForm onDone={(id) => { setOpen(false); navigate(`/schedules/${id}`); }} /></DialogContent>
        </Dialog>} />
      <PageContent width="wide">
        {schedules.isLoading ? <Loading /> : schedules.error ? <ErrorState error={schedules.error} /> : !schedules.data?.schedules.length ? <Empty icon={CalendarClock} title="No schedules" hint="Run an agent app task on a cron or interval. Requires a service token." /> : (
          <>
          <Section title="Activity" description="Trigger outcomes over the last 14 days and what fires next.">
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
              <ChartCard className="lg:col-span-8" title="Trigger history" description={`${events.length} occurrences`} actions={<Legend series={trigSeries} />}>
                <StackedBars data={trigByDay} series={trigSeries} height={176} />
              </ChartCard>
              <ChartCard className="lg:col-span-4" title="Next runs" description="Minutes until next fire">
                <BarList items={upcoming.map((x) => ({ name: x.definition.displayName ?? x.definition.scheduleId, value: Math.max(0, Math.round(((x.nextFireAtMs ?? 0) - Date.now()) / 60_000)) }))} color={ct.series[0]!} format={(n) => (n >= 60 ? `${Math.floor(n / 60)}h ${n % 60}m` : `${n}m`)} />
              </ChartCard>
            </div>
          </Section>
          {(['ACTIVE', 'PAUSED'] as const).map((state) => {
            const items = schedules.data.schedules.filter((x) => x.state === state);
            if (!items.length) return null;
            return (
              <Section card key={state} title={state === 'ACTIVE' ? 'Active' : 'Paused'} description={state === 'ACTIVE' ? 'Firing on their trigger.' : 'Will not fire until resumed.'} count={items.length}>
                <div className="divide-y divide-line">
                {items.map((x) => (
                  <ListRow key={x.definition.scheduleId} onClick={() => navigate(`/schedules/${x.definition.scheduleId}`)}>
                    <RowId>REV {x.revision}</RowId>
                    <StatusIcon status={state === 'ACTIVE' ? 'running' : 'paused'} />
                    <RowTitle sub={describeTrigger(x.definition.trigger)}>{x.definition.displayName ?? x.definition.scheduleId}</RowTitle>
                    <RowMeta>
                      <Pill color="var(--violet)">{x.definition.invocation.task}</Pill>
                      <span className="w-28 text-right text-faint">{x.nextFireAtMs ? `next ${relativeTime(x.nextFireAtMs)}` : '—'}</span>
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
  const settings = useSettings();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    scheduleId: '', displayName: '', releaseId: '', triggerKind: 'cron', expression: '0 9 * * *', timezone: 'Asia/Shanghai', everyMin: '60',
    overlap: 'SKIP', misfire: 'SKIP', binding: 'FOLLOW', contentDigest: '', env: 'local', task: '', params: '{}', runsLimit: '24'
  });
  const [localError, setLocalError] = useState<string>();
  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const create = useMutation({
    mutationFn: (definition: ScheduleDefinition) => api.schedules.create(definition, form.releaseId),
    onSuccess: (snapshot) => { void queryClient.invalidateQueries({ queryKey: ['schedules'] }); onDone(snapshot.definition.scheduleId); }
  });
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setLocalError(undefined);
    let params: Record<string, string | number>;
    try { params = JSON.parse(form.params || '{}') as Record<string, string | number>; } catch { setLocalError('params must be valid JSON'); return; }
    const definition: ScheduleDefinition = {
      schemaVersion: '1', scheduleId: form.scheduleId, tenantId: settings.tenantId,
      ...(form.displayName ? { displayName: form.displayName } : {}),
      trigger: form.triggerKind === 'cron' ? { kind: 'cron', expression: form.expression, timezone: form.timezone } : { kind: 'interval', everyMs: Number(form.everyMin) * 60_000 },
      overlapPolicy: form.overlap as ScheduleDefinition['overlapPolicy'], misfirePolicy: form.misfire as ScheduleDefinition['misfirePolicy'],
      releaseBinding: form.binding === 'FIXED' ? { strategy: 'FIXED', releaseId: form.releaseId, contentDigest: form.contentDigest } : { strategy: 'FOLLOW' },
      targetConstraints: { allowedEnvironments: [form.env as ScheduleDefinition['targetConstraints']['allowedEnvironments'][number]] },
      budget: { limits: [{ dimension: 'runs', limit: Number(form.runsLimit) }] },
      invocation: { task: form.task, ...(Object.keys(params).length ? { params } : {}) }
    };
    create.mutate(definition);
  };
  return (
    <form onSubmit={submit} className="grid grid-cols-2 gap-3">
      <Field label="Schedule ID" hint="lowercase, [a-z0-9._-], ≥3 chars"><Input required pattern="^[a-z0-9][a-z0-9._-]{2,127}$" value={form.scheduleId} onChange={set('scheduleId')} /></Field>
      <Field label="Display name"><Input value={form.displayName} onChange={set('displayName')} /></Field>
      <Field label="Release ID (binding anchor)"><Input required value={form.releaseId} onChange={set('releaseId')} /></Field>
      <Field label="Release binding"><Select value={form.binding} onChange={set('binding')}><option>FOLLOW</option><option>FIXED</option></Select></Field>
      {form.binding === 'FIXED' ? <div className="col-span-2"><Field label="Content digest"><Input required pattern="^sha256:[a-f0-9]{64}$" placeholder="sha256:…" value={form.contentDigest} onChange={set('contentDigest')} /></Field></div> : null}
      <Field label="Trigger"><Select value={form.triggerKind} onChange={set('triggerKind')}><option value="cron">cron</option><option value="interval">interval</option></Select></Field>
      {form.triggerKind === 'cron' ? <>
        <Field label="Cron expression"><Input required value={form.expression} onChange={set('expression')} /></Field>
        <Field label="Timezone"><Input required value={form.timezone} onChange={set('timezone')} /></Field>
      </> : <Field label="Every (minutes, ≥1)"><Input type="number" min={1} required value={form.everyMin} onChange={set('everyMin')} /></Field>}
      <Field label="Overlap policy"><Select value={form.overlap} onChange={set('overlap')}><option>SKIP</option><option>ALLOW</option><option>BUFFER_ONE</option></Select></Field>
      <Field label="Misfire policy"><Select value={form.misfire} onChange={set('misfire')}><option>SKIP</option><option>CATCH_UP_ONE</option></Select></Field>
      <Field label="Environment"><Select value={form.env} onChange={set('env')}><option>local</option><option>development</option><option>staging</option><option>production</option></Select></Field>
      <Field label="Budget: runs limit"><Input type="number" min={1} required value={form.runsLimit} onChange={set('runsLimit')} /></Field>
      <Field label="Invocation task" hint="^[a-z][a-z0-9-]*$, e.g. finance-brief"><Input required pattern="^[a-z][a-z0-9-]{0,63}$" value={form.task} onChange={set('task')} /></Field>
      <div className="col-span-2"><Field label="Invocation params (JSON)"><Textarea rows={3} className="font-mono text-xs" value={form.params} onChange={set('params')} /></Field></div>
      <div className="col-span-2 text-[11px] text-muted">tenantId: <Mono>{settings.tenantId}</Mono> (change in Settings)</div>
      {localError || create.error ? <div className="col-span-2"><ErrorState error={localError ?? create.error} /></div> : null}
      <div className="col-span-2 flex justify-end"><Button type="submit" disabled={create.isPending}>Create schedule</Button></div>
    </form>
  );
}

export function ScheduleDetailPage() {
  const { scheduleId = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const schedule = useQuery({ queryKey: ['schedule', scheduleId], queryFn: () => api.schedules.get(scheduleId), retry: false });
  const triggers = useQuery({ queryKey: ['schedule', scheduleId, 'triggers'], queryFn: () => api.schedules.triggers(scheduleId, 100), retry: false });
  const action = useMutation({ mutationFn: (a: 'pause' | 'resume') => api.schedules.action(scheduleId, a), onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ['schedule', scheduleId] }); } });
  const remove = useMutation({ mutationFn: () => api.schedules.remove(scheduleId), onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ['schedules'] }); navigate('/schedules'); } });
  const s = schedule.data;
  return (
    <>
      <PageHeader breadcrumb={<Crumb to="/schedules">Schedules</Crumb>} title={<Mono>{scheduleId}</Mono>}
        meta={s ? <><StatusBadge status={s.state} /><span>rev {s.revision}</span></> : null}
        actions={<>
          {s?.state === 'PAUSED'
            ? <Button variant="ghost" size="sm" onClick={() => action.mutate('resume')} disabled={action.isPending}><Play />Resume</Button>
            : <Button variant="ghost" size="sm" onClick={() => action.mutate('pause')} disabled={!s || action.isPending}><Pause />Pause</Button>}
          <Button variant="ghost" size="sm" className="hover:text-red" disabled={!s || remove.isPending} onClick={() => { if (confirm(`Delete schedule ${scheduleId}?`)) remove.mutate(); }}><Trash2 />Delete</Button>
        </>} />
      {action.error ? <ErrorState error={action.error} /> : remove.error ? <ErrorState error={remove.error} /> : null}
      <div className="flex min-h-0 flex-1 flex-col">
        {schedule.isLoading ? <Loading /> : schedule.error ? <ErrorState error={schedule.error} /> : s ? (
          <DetailLayout properties={<>
            <PropertyGroup title="Properties">
              <Property label="State"><StatusBadge status={s.state === 'ACTIVE' ? 'active' : s.state.toLowerCase()} /></Property>
              <Property label="Trigger">{describeTrigger(s.definition.trigger)}</Property>
              <Property label="Task"><Pill color="var(--violet)">{s.definition.invocation.task}</Pill></Property>
              <Property label="Binding">{s.definition.releaseBinding.strategy === 'FIXED' ? <Mono>FIXED {s.definition.releaseBinding.releaseId}</Mono> : 'Follow latest'}</Property>
              <Property label="Overlap">{s.definition.overlapPolicy}</Property>
              <Property label="Misfire">{s.definition.misfirePolicy}</Property>
            </PropertyGroup>
            <PropertyGroup title="Constraints">
              <Property label="Envs">{s.definition.targetConstraints.allowedEnvironments.join(', ')}</Property>
              <Property label="Budget">{s.definition.budget.limits.map((l) => `${l.dimension} ≤ ${l.limit}`).join(', ')}</Property>
            </PropertyGroup>
            <PropertyGroup title="Timestamps">
              <Property label="Next fire">{formatTime(s.nextFireAtMs)}</Property>
              <Property label="Created">{formatTime(s.createdAtMs)}</Property>
              <Property label="Updated">{formatTime(s.updatedAtMs)}</Property>
              <Property label="Revision">{s.revision}</Property>
            </PropertyGroup>
          </>}>
            <PageContent>
              <PageDescription title={s.definition.displayName ?? s.definition.scheduleId} description={<><Mono>{s.definition.scheduleId}</Mono> · {describeTrigger(s.definition.trigger)}</>} />
              <Section title="Workflow" description="Trigger → guard rails → task.">
              <Flowchart nodes={[
                { key: 'trigger', kind: 'Trigger', tone: 'purple', icon: <Clock />, title: describeTrigger(s.definition.trigger), sub: s.state === 'PAUSED' ? 'Paused — will not fire' : `Next fire ${relativeTime(s.nextFireAtMs)}` },
                { key: 'policy', kind: 'Policy', tone: 'amber', icon: <ShieldCheck />, title: 'Guard rails', sub: s.definition.targetConstraints.allowedEnvironments.join(', '),
                  body: <><span>overlap</span><FlowChip>{s.definition.overlapPolicy}</FlowChip><span>misfire</span><FlowChip>{s.definition.misfirePolicy}</FlowChip>{s.definition.budget.limits.map((l) => <FlowChip key={l.dimension} dot="var(--orange)">{l.dimension} ≤ {l.limit}</FlowChip>)}</> },
                { key: 'task', kind: 'Run task', tone: 'green', icon: <Play />, title: s.definition.invocation.task, sub: s.definition.releaseBinding.strategy === 'FIXED' ? `Pinned ${s.definition.releaseBinding.releaseId}` : 'Follows latest release',
                  ...(s.definition.invocation.params ? { body: Object.entries(s.definition.invocation.params).map(([k, v]) => <FlowChip key={k}>{k}: {String(v)}</FlowChip>) } : {}) }
              ]} />
              </Section>
              <Section card padded title="Trigger history" description="Most recent 30 occurrences." count={triggers.data?.events.length}>
              {triggers.isLoading ? <Loading rows={3} /> : triggers.error ? <ErrorState error={triggers.error} /> : !triggers.data?.events.length ? <Quiet>No triggers yet.</Quiet> : (
                <TaskRows variant="list" rows={triggers.data.events.slice(0, 30).map((e) => ({
                  key: e.occurrenceId, status: e.kind, label: formatTime(e.occurredAtMs), amount: e.taskId ? <span className="font-mono text-[12px]">{e.taskId}</span> : undefined,
                  pill: <StatusPill tone={toneFor(e.kind)}>{e.kind[0] + e.kind.slice(1).toLowerCase()}</StatusPill>,
                  ...(e.taskId ? { onOpen: () => { void navigate(`/tasks/${e.taskId}`); } } : {}),
                  details: [{ label: 'Occurrence', meta: e.occurrenceId }, ...(e.errorCode ? [{ label: 'Error', meta: e.errorCode }] : []), ...(e.detail ? [{ label: 'Detail', meta: e.detail }] : [])]
                }))} />
              )}
              </Section>
              <Section title="Raw definition"><JsonView value={s.definition} filename={`${s.definition.scheduleId}.json`} /></Section>
            </PageContent>
          </DetailLayout>
        ) : null}
      </div>
    </>
  );
}
