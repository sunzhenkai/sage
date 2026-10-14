import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, Pause, Play, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { Crumb, PageHeader } from '@/components/layout/app-shell';
import { StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/input';
import { Empty, ErrorState, JsonView, Loading, Mono } from '@/components/ui/misc';
import { DetailLayout, ListGroup, ListRow, Pill, Property, PropertyGroup, RowId, RowMeta, RowTitle } from '@/components/ui/list';
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
  useEffect(() => { if (search.get('new') === '1') { setOpen(true); setSearch({}, { replace: true }); } }, [search, setSearch]);
  return (
    <>
      <PageHeader title="Schedules" meta={schedules.data ? `${schedules.data.schedules.length}` : null}
        actions={<Dialog open={open} onOpenChange={setOpen}>
          <Button variant="secondary" size="sm" onClick={() => setOpen(true)}><Plus />New schedule</Button>
          <DialogContent title="New schedule" description="POST /v1/schedules — requires a service token."><CreateScheduleForm onDone={(id) => { setOpen(false); navigate(`/schedules/${id}`); }} /></DialogContent>
        </Dialog>} />
      <div className="flex min-h-0 flex-1 flex-col overflow-auto">
        {schedules.isLoading ? <Loading /> : schedules.error ? <ErrorState error={schedules.error} /> : !schedules.data?.schedules.length ? <Empty icon={CalendarClock} title="No schedules" hint="Run an agent app task on a cron or interval. Requires a service token." /> : (
          (['ACTIVE', 'PAUSED'] as const).map((state) => {
            const items = schedules.data.schedules.filter((x) => x.state === state);
            if (!items.length) return null;
            return (
              <ListGroup key={state} icon={<StatusIcon status={state === 'ACTIVE' ? 'running' : 'paused'} />} label={state === 'ACTIVE' ? 'Active' : 'Paused'} count={items.length} onAdd={() => setOpen(true)}>
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
              </ListGroup>
            );
          })
        )}
      </div>
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
      <div className="min-h-0 flex-1 overflow-auto px-6 py-5">
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
            <div className="mx-auto max-w-[760px] px-6 pb-16 pt-10">
              <h2 className="text-[20px] font-semibold tracking-[-0.02em]">{s.definition.displayName ?? s.definition.scheduleId}</h2>
              <p className="mt-1 text-[13px] text-muted"><Mono>{s.definition.scheduleId}</Mono> · {describeTrigger(s.definition.trigger)}</p>
              <h3 className="mb-1 mt-8 border-b border-line pb-2 text-[13px] font-medium">Trigger history</h3>
              {triggers.isLoading ? <Loading rows={3} /> : triggers.error ? <ErrorState error={triggers.error} /> : !triggers.data?.events.length ? <p className="py-6 text-[12.5px] text-muted">No triggers yet.</p> : (
                <div className="-mx-5">{triggers.data.events.map((e) => (
                  <ListRow key={e.occurrenceId} onClick={e.taskId ? () => navigate(`/tasks/${e.taskId}`) : undefined}>
                    <StatusIcon status={e.kind === 'SUCCEEDED' ? 'succeeded' : e.kind.toLowerCase()} />
                    <RowTitle sub={e.errorCode ?? e.detail}>{e.kind[0] + e.kind.slice(1).toLowerCase()}</RowTitle>
                    <RowMeta>{e.taskId ? <Mono className="text-faint">{e.taskId}</Mono> : null}<span className="text-faint">{formatTime(e.occurredAtMs)}</span></RowMeta>
                  </ListRow>
                ))}</div>
              )}
              <details className="mt-6"><summary className="cursor-pointer text-[12px] text-faint hover:text-muted">Raw definition</summary><JsonView value={s.definition} className="mt-2" /></details>
            </div>
          </DetailLayout>
        ) : null}
      </div>
    </>
  );
}
