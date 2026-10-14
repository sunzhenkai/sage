import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Boxes, Trash2 } from 'lucide-react';
import { useNavigate, useParams } from 'react-router';
import { Crumb, PageHeader, PanelBar } from '@/components/layout/app-shell';
import { StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DetailLayout, ListGroup, ListRow, Pill, Property, PropertyGroup, RowId, RowMeta, RowTitle } from '@/components/ui/list';
import { Empty, ErrorState, JsonView, Loading, Mono } from '@/components/ui/misc';
import { StatusIcon } from '@/components/ui/status';
import { api } from '@/lib/api';
import { formatTime, relativeTime } from '@/lib/utils';

export function AppsPage() {
  const navigate = useNavigate();
  const apps = useQuery({ queryKey: ['apps'], queryFn: api.apps.list });
  const items = apps.data?.apps ?? [];
  const statuses = [...new Set(items.map((a) => a.status))];
  return (
    <>
      <PanelBar left={<><Boxes className="size-4 text-muted" strokeWidth={1.6} /><span className="text-[13px] font-medium">Apps</span></>} />
      <div className="flex min-h-0 flex-1 flex-col overflow-auto">
        {apps.isLoading ? <Loading /> : apps.error ? <ErrorState error={apps.error} /> : !items.length ? (
          <Empty icon={Boxes} title="No apps" hint="Register an agent package via agent-api (pnpm --filter @sage/agent-api register-package)." />
        ) : statuses.map((status) => {
          const group = items.filter((a) => a.status === status);
          return (
            <ListGroup key={status} icon={<StatusIcon status={status} />} label={status[0]!.toUpperCase() + status.slice(1)} count={group.length}>
              {group.map((a) => (
                <ListRow key={a.appId} onClick={() => navigate(`/apps/${a.appId}`)}>
                  <RowId>APP</RowId>
                  <StatusIcon status={a.status} />
                  <RowTitle sub={`${a.releaseCount} release${a.releaseCount === 1 ? '' : 's'}`}>{a.appId}</RowTitle>
                  <RowMeta>
                    {a.latestVersion ? <Pill color="var(--green)">v{a.latestVersion}</Pill> : null}
                    <span className="w-14 text-right text-faint">{relativeTime(a.updatedAt).replace(' ago', '')}</span>
                  </RowMeta>
                </ListRow>
              ))}
            </ListGroup>
          );
        })}
      </div>
    </>
  );
}

export function AppDetailPage() {
  const { appId = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const app = useQuery({ queryKey: ['app', appId], queryFn: () => api.apps.get(appId) });
  const remove = useMutation({ mutationFn: () => api.apps.remove(appId), onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ['apps'] }); navigate('/apps'); } });
  const manifest = app.data?.manifest as Record<string, unknown> | undefined;
  const list = (key: string) => (Array.isArray(manifest?.[key]) ? (manifest[key] as unknown[]) : []);
  const description = typeof manifest?.['description'] === 'string' && manifest['description'] ? String(manifest['description']) : undefined;
  return (
    <>
      <PageHeader breadcrumb={<Crumb to="/apps">Apps</Crumb>} title={appId}
        actions={<Button variant="ghost" size="sm" className="hover:text-red" disabled={remove.isPending} onClick={() => { if (confirm(`Delete app ${appId}?`)) remove.mutate(); }}><Trash2 />Delete</Button>} />
      {remove.error ? <ErrorState error={remove.error} /> : null}
      {app.isLoading ? <Loading /> : app.error ? <ErrorState error={app.error} /> : app.data ? (
        <DetailLayout properties={<>
          <PropertyGroup title="Properties">
            <Property label="Status"><StatusBadge status={app.data.status} /></Property>
            <Property label="Version"><Mono>{String(manifest?.['version'] ?? '—')}</Mono></Property>
            <Property label="Entry"><Mono>{String(manifest?.['entry'] ?? '—')}</Mono></Property>
            <Property label="Model">{manifest?.['modelRoute'] ? <Mono>{Object.values(manifest['modelRoute'] as Record<string, string>).join(' / ')}</Mono> : null}</Property>
            <Property label="Created">{formatTime(app.data.createdAt)}</Property>
          </PropertyGroup>
          <PropertyGroup title="Skills">
            <div className="flex flex-wrap gap-1 px-2">{list('skillRefs').map((s) => <Pill key={String(s)} color="var(--violet)">{String(s).replace(/^skill:\/\//, '')}</Pill>)}</div>
          </PropertyGroup>
          <PropertyGroup title="Capabilities">
            <div className="flex flex-wrap gap-1 px-2">{list('capabilityRefs').map((s) => <Pill key={String(s)} color="var(--blue)">{String(s).replace(/^capability:\/\//, '')}</Pill>)}</div>
          </PropertyGroup>
        </>}>
          <div className="mx-auto max-w-[760px] px-10 py-8">
            <h2 className="text-[20px] font-semibold tracking-[-0.02em]">{appId}</h2>
            <p className="mt-1 text-[13px] text-muted">{description ?? 'Agent app manifest, tasks, inputs and bundled assets.'}</p>

            <h3 className="mb-1 mt-8 text-[13px] font-medium">Tasks</h3>
            <div className="-mx-5">{list('tasks').map((t, i) => { const task = t as { name?: string; entry?: string }; return (
              <ListRow key={i}><StatusIcon kind="todo" /><RowTitle sub={task.entry}>{task.name ?? `task-${i}`}</RowTitle></ListRow>
            ); })}</div>

            <h3 className="mb-1 mt-6 text-[13px] font-medium">Inputs & data sources</h3>
            <div className="-mx-5">
              {list('inputs').map((x, i) => { const v = x as { name?: string; type?: string; required?: boolean }; return <ListRow key={`i${i}`}><RowId>INPUT</RowId><RowTitle sub={v.type}>{v.name}</RowTitle><RowMeta>{v.required ? <Pill>required</Pill> : <span className="text-faint">optional</span>}</RowMeta></ListRow>; })}
              {list('dataSources').map((x, i) => { const v = x as { name?: string; url?: string }; return <ListRow key={`d${i}`}><RowId>SOURCE</RowId><RowTitle sub={v.url}>{v.name}</RowTitle></ListRow>; })}
            </div>

            <h3 className="mb-1 mt-6 text-[13px] font-medium">Assets <span className="font-normal text-faint">{app.data.assets?.length ?? 0}</span></h3>
            <div className="-mx-5">{(app.data.assets ?? []).map((asset) => (
              <details key={asset.relativePath} className="group/a">
                <summary className="flex h-[38px] cursor-default list-none items-center gap-3 px-5 hover:bg-hover">
                  <RowId>{asset.kind.toUpperCase().slice(0, 10)}</RowId>
                  <RowTitle><Mono className="text-[12.5px]">{asset.relativePath}</Mono></RowTitle>
                  <RowMeta><span className="text-faint">{asset.bytes} B</span></RowMeta>
                </summary>
                {asset.preview ? <pre className="mx-5 mb-2 max-h-72 overflow-auto rounded-md border border-line bg-sunken p-3 font-mono text-[11.5px] text-fg-2">{asset.preview}</pre> : null}
              </details>
            ))}</div>
            <details className="mt-6"><summary className="cursor-pointer text-[12px] text-faint hover:text-muted">Raw manifest</summary><JsonView value={manifest} className="mt-2" /></details>
          </div>
        </DetailLayout>
      ) : null}
    </>
  );
}
