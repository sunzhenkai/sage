import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router';
import { PageHeader } from '@/components/layout/app-shell';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, Empty, ErrorState, JsonView, KeyValue, Loading, Mono } from '@/components/ui/misc';
import { Table, Td, Th, Tr } from '@/components/ui/table';
import { api } from '@/lib/api';
import { formatTime, relativeTime } from '@/lib/utils';

export function AppsPage() {
  const navigate = useNavigate();
  const apps = useQuery({ queryKey: ['apps'], queryFn: api.apps.list });
  return (
    <>
      <PageHeader title="Apps" meta={apps.data ? `${apps.data.apps.length}` : null} />
      <div className="min-h-0 flex-1 overflow-auto">
        {apps.isLoading ? <Loading /> : apps.error ? <ErrorState error={apps.error} /> : !apps.data?.apps.length ? <Empty title="No apps" hint="Register an agent package via agent-api (pnpm --filter @sage/agent-api register-package)." /> : (
          <Table>
            <thead><tr><Th>App</Th><Th>Status</Th><Th>Latest version</Th><Th>Releases</Th><Th className="text-right">Updated</Th></tr></thead>
            <tbody>{apps.data.apps.map((a) => (
              <Tr key={a.appId} onClick={() => navigate(`/apps/${a.appId}`)}>
                <Td className="font-medium">{a.appId}</Td><Td><StatusBadge status={a.status} /></Td>
                <Td><Mono>{a.latestVersion ?? '—'}</Mono></Td><Td className="text-muted">{a.releaseCount}</Td>
                <Td className="text-right text-muted">{relativeTime(a.updatedAt)}</Td>
              </Tr>
            ))}</tbody>
          </Table>
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
  return (
    <>
      <PageHeader title={<span className="flex items-center gap-2"><Link to="/apps" className="text-muted hover:text-fg">Apps</Link><span className="text-muted">/</span>{appId}</span>}
        meta={app.data ? <StatusBadge status={app.data.status} /> : null}
        actions={<Button variant="danger" size="sm" disabled={remove.isPending} onClick={() => { if (confirm(`Delete app ${appId}?`)) remove.mutate(); }}><Trash2 />Delete</Button>} />
      {remove.error ? <ErrorState error={remove.error} /> : null}
      <div className="min-h-0 flex-1 overflow-auto p-4">
        {app.isLoading ? <Loading /> : app.error ? <ErrorState error={app.error} /> : app.data ? (
          <div className="grid gap-4 lg:grid-cols-2">
            <Card><CardHeader title="Manifest" /><div className="p-3"><KeyValue items={[
              ['Version', <Mono key="v">{String(manifest?.['version'] ?? '—')}</Mono>], ['Entry', <Mono key="e">{String(manifest?.['entry'] ?? '—')}</Mono>],
              ['Model route', manifest?.['modelRoute'] ? <Mono key="m">{JSON.stringify(manifest['modelRoute'])}</Mono> : '—'],
              ['Skills', <span key="s" className="flex flex-wrap gap-1">{list('skillRefs').map((s) => <Badge key={String(s)}>{String(s)}</Badge>)}</span>],
              ['Capabilities', <span key="c" className="flex flex-wrap gap-1">{list('capabilityRefs').map((s) => <Badge key={String(s)}>{String(s)}</Badge>)}</span>],
              ['Tasks', <span key="t" className="flex flex-wrap gap-1">{list('tasks').map((t, i) => <Badge tone="accent" key={i}>{String((t as { name?: string }).name ?? i)}</Badge>)}</span>],
              ['Created', formatTime(app.data.createdAt)]
            ]} /></div></Card>
            <Card><CardHeader title="Inputs & data sources" /><div className="p-3"><JsonView value={{ inputs: list('inputs'), dataSources: list('dataSources') }} /></div></Card>
            <Card className="lg:col-span-2"><CardHeader title={`Assets (${app.data.assets?.length ?? 0})`} />
              <div className="divide-y divide-border/60">{(app.data.assets ?? []).map((asset) => (
                <details key={asset.relativePath} className="px-3 py-2">
                  <summary className="flex cursor-pointer items-center gap-3 text-xs"><Mono>{asset.relativePath}</Mono><Badge>{asset.kind}</Badge><span className="text-muted">{asset.bytes} B</span><Mono className="ml-auto truncate text-muted">{asset.digest.slice(0, 19)}…</Mono></summary>
                  {asset.preview ? <pre className="mt-2 max-h-80 overflow-auto rounded-md border bg-subtle p-3 font-mono text-[11px]">{asset.preview}</pre> : null}
                </details>
              ))}</div>
            </Card>
          </div>
        ) : null}
      </div>
    </>
  );
}
