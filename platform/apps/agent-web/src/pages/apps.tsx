import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Boxes, CircleDot, Clock, Hash, Tags, Trash2 } from 'lucide-react';
import { useNavigate, useParams } from 'react-router';
import { Crumb, PageHeader, PanelBar } from '@/components/layout/app-shell';
import { Monogram, StatusPill, Tag, toneFor } from '@/components/bui/atoms';
import { RecordsTable } from '@/components/bui/records-table';
import { CodeBlock } from '@/components/bui/code-block';
import { PageContent, PageDescription, Section } from '@/components/layout/page';
import { StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DetailLayout, ListRow, Pill, Property, PropertyGroup, RowId, RowMeta, RowTitle } from '@/components/ui/list';
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
      <div className="flex min-h-0 flex-1 flex-col">
        {apps.isLoading ? <Loading /> : apps.error ? <ErrorState error={apps.error} /> : !items.length ? (
          <Empty icon={Boxes} title="No apps" hint="Register an agent package via agent-api (pnpm --filter @sage/agent-api register-package)." />
        ) : (
          <RecordsTable fill rows={items} getKey={(a) => a.appId} onRowClick={(a) => { void navigate(`/apps/${a.appId}`); }}
            columns={[
              { key: 'app', label: 'App', icon: <Boxes />, width: '32%', sort: (x, y) => x.appId.localeCompare(y.appId), render: (a) => <span className="flex min-w-0 items-center gap-2"><Monogram text={a.appId} /><span className="truncate">{a.appId}</span></span> },
              { key: 'status', label: 'Status', icon: <CircleDot />, width: 130, sort: (x, y) => x.status.localeCompare(y.status), render: (a) => <StatusPill tone={toneFor(a.status)}>{a.status[0]!.toUpperCase() + a.status.slice(1)}</StatusPill> },
              { key: 'version', label: 'Latest version', icon: <Tags />, width: 150, render: (a) => a.latestVersion ? <Tag>{`v${a.latestVersion}`}</Tag> : <span className="text-ink-3">—</span> },
              { key: 'releases', label: 'Releases', icon: <Hash />, width: 110, align: 'right', sort: (x, y) => x.releaseCount - y.releaseCount, render: (a) => <span className="tabular-nums text-ink-2">{a.releaseCount}</span> },
              { key: 'created', label: 'Created', icon: <Clock />, width: 140, sort: (x, y) => x.createdAt.localeCompare(y.createdAt), render: (a) => <span className="text-ink-2">{relativeTime(a.createdAt)}</span> },
              { key: 'updated', label: 'Last update', icon: <Clock />, width: 140, sort: (x, y) => x.updatedAt.localeCompare(y.updatedAt), render: (a) => <span className="text-ink-2">{relativeTime(a.updatedAt)}</span> }
            ]}
            footer={<span className="ml-auto">{statuses.map((st) => `${items.filter((a) => a.status === st).length} ${st}`).join(' · ')}</span>} />
        )}
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
          <PageContent>
            <PageDescription title={appId} description={description ?? 'Agent app manifest, tasks, inputs and bundled assets.'} />
            <Section card title="Tasks" count={list('tasks').length}>
            <>{list('tasks').map((t, i) => { const task = t as { name?: string; entry?: string }; return (
              <ListRow key={i}><StatusIcon kind="todo" /><RowTitle sub={task.entry}>{task.name ?? `task-${i}`}</RowTitle></ListRow>
            ); })}</>
            </Section>
            <Section card title="Inputs & data sources">
            <>
              {list('inputs').map((x, i) => { const v = x as { name?: string; type?: string; required?: boolean }; return <ListRow key={`i${i}`}><RowId>INPUT</RowId><RowTitle sub={v.type}>{v.name}</RowTitle><RowMeta>{v.required ? <Pill>required</Pill> : <span className="text-faint">optional</span>}</RowMeta></ListRow>; })}
              {list('dataSources').map((x, i) => { const v = x as { name?: string; url?: string }; return <ListRow key={`d${i}`}><RowId>SOURCE</RowId><RowTitle sub={v.url}>{v.name}</RowTitle></ListRow>; })}
            </>
            </Section>
            <Section card title="Assets" count={app.data.assets?.length ?? 0}>
            <>{(app.data.assets ?? []).map((asset) => (
              <details key={asset.relativePath} className="group/a">
                <summary className="flex h-[38px] cursor-default list-none items-center gap-3 gutter-x hover:bg-hover">
                  <RowId>{asset.kind.toUpperCase().slice(0, 10)}</RowId>
                  <RowTitle><Mono className="text-[12.5px]">{asset.relativePath}</Mono></RowTitle>
                  <RowMeta><span className="text-faint">{asset.bytes} B</span></RowMeta>
                </summary>
                {asset.preview ? <div className="gutter-x pb-2"><CodeBlock code={asset.preview} filename={asset.relativePath} maxHeight={288} /></div> : null}
              </details>
            ))}</>
            </Section>
            <Section title="Raw manifest"><JsonView value={manifest} filename="manifest.json" /></Section>
          </PageContent>
        </DetailLayout>
      ) : null}
    </>
  );
}
