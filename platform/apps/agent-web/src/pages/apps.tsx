import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Boxes, Check, CircleDot, Clock, Hash, PackagePlus, Tags, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { Crumb, PageHeader } from '@/components/layout/app-shell';
import { Monogram, StatusPill, Tag, toneFor } from '@/components/bui/atoms';
import { RecordsTable } from '@/components/bui/records-table';
import { CodeBlock } from '@/components/bui/code-block';
import { PageContent, PageDescription, Section } from '@/components/layout/page';
import { StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DetailLayout, ListRow, Pill, Property, PropertyGroup, RowId, RowMeta, RowTitle } from '@/components/ui/list';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Empty, ErrorState, JsonView, Loading, Mono } from '@/components/ui/misc';
import { StatusIcon, statusLabelKey } from '@/components/ui/status';
import { Sparkline, useChartTheme } from '@/components/charts';
import { ApiError, api } from '@/lib/api';
import { EXAMPLE_APPS, importExampleApp } from '@/lib/example-apps';
import { errorDisplay } from '@/lib/error-message';
import { useT } from '@/lib/i18n';
import { isMock, mockSeries } from '@/lib/mock';
import { formatTime, relativeTime } from '@/lib/utils';

export function AppsPage() {
  const navigate = useNavigate();
  const t = useT();
  const apps = useQuery({ queryKey: ['apps'], queryFn: api.apps.list });
  const items = apps.data?.apps ?? [];
  const statuses = [...new Set(items.map((a) => a.status))];
  const ct = useChartTheme();
  return (
    <>
      <PageHeader title={t('nav.apps')} actions={<ImportExampleApps />} />
      <PageContent width="wide">
        {apps.isLoading ? <Loading /> : apps.error ? <ErrorState error={apps.error} /> : !items.length ? (
          <Empty icon={Boxes} title={t('apps.empty.title')} hint={t('apps.empty.hint')} />
        ) : (
          <Section title={t('apps.all.title')} description={t('apps.all.description')} count={items.length}>
          <RecordsTable rows={items} getKey={(a) => a.appId} onRowClick={(a) => { void navigate(`/apps/${a.appId}`); }}
            columns={[
              { key: 'app', label: t('apps.columns.app'), icon: <Boxes />, width: '32%', sort: (x, y) => x.appId.localeCompare(y.appId), render: (a) => <span className="flex min-w-0 items-center gap-2"><Monogram text={a.appId} /><span className="truncate">{a.appId}</span></span> },
              { key: 'status', label: t('apps.columns.status'), icon: <CircleDot />, width: 130, sort: (x, y) => x.status.localeCompare(y.status), render: (a) => { const key = statusLabelKey(a.status); return <StatusPill tone={toneFor(a.status)}>{key === undefined ? a.status[0]!.toUpperCase() + a.status.slice(1) : t(key)}</StatusPill>; } },
              { key: 'version', label: t('apps.columns.latestVersion'), icon: <Tags />, width: 150, render: (a) => a.latestVersion ? <Tag>{`v${a.latestVersion}`}</Tag> : <span className="text-ink-3">—</span> },
              { key: 'usage', label: t('apps.columns.runs'), icon: <Hash />, width: 150, render: (a) => isMock() ? <span className="block h-5 w-full"><Sparkline values={mockSeries(a.appId, 14)} color={a.status === 'active' ? ct.series[0]! : ct.series[5]!} height={20} /></span> : <span className="text-ink-3">—</span> },
              { key: 'releases', label: t('apps.columns.releases'), icon: <Hash />, width: 110, align: 'right', sort: (x, y) => x.releaseCount - y.releaseCount, render: (a) => <span className="tabular-nums text-ink-2">{a.releaseCount}</span> },
              { key: 'created', label: t('apps.columns.created'), icon: <Clock />, width: 140, sort: (x, y) => x.createdAt.localeCompare(y.createdAt), render: (a) => <span className="text-ink-2">{relativeTime(a.createdAt)}</span> },
              { key: 'updated', label: t('apps.columns.lastUpdate'), icon: <Clock />, width: 140, sort: (x, y) => x.updatedAt.localeCompare(y.updatedAt), render: (a) => <span className="text-ink-2">{relativeTime(a.updatedAt)}</span> }
            ]}
            footer={<span className="ml-auto">{statuses.map((st) => `${items.filter((a) => a.status === st).length} ${st}`).join(' · ')}</span>} />
          </Section>
        )}
      </PageContent>
    </>
  );
}

function ImportExampleApps() {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}><PackagePlus />{t('apps.import.action')}</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent title={t('apps.import.title')} description={t('apps.import.description')}>
          <ImportExampleDialog onClose={() => setOpen(false)} />
        </DialogContent>
      </Dialog>
    </>
  );
}

type ImportState =
  | { kind: 'idle' }
  | { kind: 'importing' }
  | { kind: 'success'; appId: string; files: number }
  | { kind: 'exists'; appId: string; hidden?: boolean }
  | { kind: 'failed'; message: string; retryAppId?: string };

function ImportExampleDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const apps = useQuery({ queryKey: ['apps'], queryFn: api.apps.list });
  const [selected, setSelected] = useState(EXAMPLE_APPS[0]!.appId);
  const [state, setState] = useState<ImportState>({ kind: 'idle' });
  const busy = state.kind === 'importing';

  const existing = new Set((apps.data?.apps ?? []).map((app) => app.appId));
  const example = EXAMPLE_APPS.find((item) => item.appId === selected) ?? EXAMPLE_APPS[0]!;

  useEffect(() => {
    if (state.kind === 'success' || state.kind === 'exists') return;
    setState({ kind: 'idle' });
  }, [selected]);

  const run = async () => {
    setState({ kind: 'importing' });
    try {
      const result = await importExampleApp({
        example,
        existingAppIds: existing,
        ...(state.kind === 'failed' && state.retryAppId ? { retryAppId: state.retryAppId } : {})
      });
      if (result.status === 'exists' || result.status === 'exists-hidden') {
        setState({ kind: 'exists', appId: result.appId, ...(result.status === 'exists-hidden' ? { hidden: true } : {}) });
        return;
      }
      setState({ kind: 'success', appId: result.appId, files: result.files });
      await Promise.all([queryClient.invalidateQueries({ queryKey: ['apps'] }), queryClient.invalidateQueries({ queryKey: ['packages'] })]);
    } catch (error) {
      const message = errorDisplay(error);
      const created = !existing.has(example.appId) && !(error instanceof ApiError && error.code === 'APP_ALREADY_EXISTS');
      setState({ kind: 'failed', message: [message.text, message.detail].filter(Boolean).join(' '), ...(created ? { retryAppId: example.appId } : {}) });
    }
  };

  if (state.kind === 'success') {
    return (
      <div className="flex flex-col gap-4">
        <p className="flex items-start gap-2 text-[13px] text-fg-2"><Check className="mt-0.5 size-4 shrink-0 text-green" />{t('apps.import.success', { app: state.appId, files: state.files })}</p>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>{t('apps.import.done')}</Button>
          <Button onClick={() => { onClose(); void navigate(`/apps/${encodeURIComponent(state.appId)}`); }}>{t('apps.import.view')}<ArrowRight /></Button>
        </div>
      </div>
    );
  }

  if (state.kind === 'exists') {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-[13px] text-fg-2">{t(state.hidden ? 'apps.import.existsHidden' : 'apps.import.exists', { app: state.appId })}</p>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>{t('apps.import.done')}</Button>
          {state.hidden ? null : <Button onClick={() => { onClose(); void navigate(`/apps/${encodeURIComponent(state.appId)}`); }}>{t('apps.import.view')}<ArrowRight /></Button>}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div role="group" aria-label={t('apps.import.choose')} className="flex flex-col gap-2">
        {EXAMPLE_APPS.map((item) => {
          const active = item.appId === selected;
          const registered = existing.has(item.appId);
          return (
            <button key={item.appId} type="button" aria-pressed={active} disabled={busy}
              onClick={() => setSelected(item.appId)}
              className={`flex w-full items-start gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 ${active ? 'border-accent/60 bg-accent-soft' : 'border-line hover:bg-hover'}`}>
              <span className={`mt-0.5 grid size-4 shrink-0 place-items-center rounded-full border ${active ? 'border-accent bg-accent text-white' : 'border-line-strong'}`}>{active ? <Check className="size-2.5" strokeWidth={3} /> : null}</span>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2"><span className="text-[13px] font-medium text-ink">{t(item.nameKey)}</span><Mono className="text-[11px] text-faint">{item.appId}</Mono>{registered ? <Pill>{t('apps.import.existsBadge')}</Pill> : null}</span>
                <span className="mt-0.5 block text-[12px] leading-4 text-muted">{t(item.descriptionKey)}</span>
              </span>
            </button>
          );
        })}
      </div>
      {apps.isLoading ? <p className="text-[12px] text-faint">{t('apps.import.loading')}</p> : null}
      {state.kind === 'failed' ? <p className="text-[12.5px] text-red" role="alert">{t('apps.import.failed')} {state.message}</p> : null}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose} disabled={busy}>{t('common.cancel')}</Button>
        <Button onClick={() => { void run(); }} disabled={busy || apps.isLoading}>{busy ? t('apps.import.importing') : state.kind === 'failed' ? t('apps.import.retry') : t('apps.import.action')}</Button>
      </div>
    </div>
  );
}

export function AppDetailPage() {
  const { appId = '' } = useParams();
  const navigate = useNavigate();
  const t = useT();
  const queryClient = useQueryClient();
  const app = useQuery({ queryKey: ['app', appId], queryFn: () => api.apps.get(appId) });
  const remove = useMutation({ mutationFn: () => api.apps.remove(appId), onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ['apps'] }); navigate('/apps'); } });
  const manifest = app.data?.manifest as Record<string, unknown> | undefined;
  const list = (key: string) => (Array.isArray(manifest?.[key]) ? (manifest[key] as unknown[]) : []);
  const description = typeof manifest?.['description'] === 'string' && manifest['description'] ? String(manifest['description']) : undefined;
  return (
    <>
      <PageHeader breadcrumb={<Crumb to="/apps">{t('nav.apps')}</Crumb>} title={appId}
        actions={<Button variant="ghost" size="sm" className="hover:text-red" disabled={remove.isPending} onClick={() => { if (confirm(t('apps.detail.deleteConfirm', { app: appId }))) remove.mutate(); }}><Trash2 />{t('common.delete')}</Button>} />
      {remove.error ? <ErrorState error={remove.error} /> : null}
      {app.isLoading ? <Loading /> : app.error ? <ErrorState error={app.error} /> : app.data ? (
        <DetailLayout properties={<>
          <PropertyGroup title={t('apps.detail.properties')}>
            <Property label={t('apps.detail.status')}><StatusBadge status={app.data.status} /></Property>
            <Property label={t('apps.detail.version')}><Mono>{String(manifest?.['version'] ?? '—')}</Mono></Property>
            <Property label={t('apps.detail.entry')}><Mono>{String(manifest?.['entry'] ?? '—')}</Mono></Property>
            <Property label={t('apps.detail.model')}>{manifest?.['modelRoute'] ? <Mono>{Object.values(manifest['modelRoute'] as Record<string, string>).join(' / ')}</Mono> : null}</Property>
            <Property label={t('apps.detail.created')}>{formatTime(app.data.createdAt)}</Property>
          </PropertyGroup>
          <PropertyGroup title={t('apps.detail.skills')}>
            <div className="flex flex-wrap gap-1 px-2">{list('skillRefs').map((s) => <Pill key={String(s)} color="var(--violet)">{String(s).replace(/^skill:\/\//, '')}</Pill>)}</div>
          </PropertyGroup>
          <PropertyGroup title={t('apps.detail.capabilities')}>
            <div className="flex flex-wrap gap-1 px-2">{list('capabilityRefs').map((s) => <Pill key={String(s)} color="var(--blue)">{String(s).replace(/^capability:\/\//, '')}</Pill>)}</div>
          </PropertyGroup>
        </>}>
          <PageContent>
            <PageDescription title={appId} description={description ?? t('apps.detail.descriptionFallback')} />
            <Section card title={t('apps.detail.tasks')} count={list('tasks').length}>
            <>{list('tasks').map((item, i) => { const task = item as { name?: string; entry?: string }; return (
              <ListRow key={i}><StatusIcon kind="todo" /><RowTitle sub={task.entry}>{task.name ?? `task-${i}`}</RowTitle></ListRow>
            ); })}</>
            </Section>
            <Section card title={t('apps.detail.inputs')}>
            <>
              {list('inputs').map((x, i) => { const v = x as { name?: string; type?: string; required?: boolean }; return <ListRow key={`i${i}`}><RowId>{t('apps.detail.input')}</RowId><RowTitle sub={v.type}>{v.name}</RowTitle><RowMeta>{v.required ? <Pill>{t('apps.detail.required')}</Pill> : <span className="text-faint">{t('apps.detail.optional')}</span>}</RowMeta></ListRow>; })}
              {list('dataSources').map((x, i) => { const v = x as { name?: string; url?: string }; return <ListRow key={`d${i}`}><RowId>{t('apps.detail.source')}</RowId><RowTitle sub={v.url}>{v.name}</RowTitle></ListRow>; })}
            </>
            </Section>
            <Section card title={t('apps.detail.assets')} count={app.data.assets?.length ?? 0}>
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
            <Section title={t('apps.detail.rawManifest')}><JsonView value={manifest} filename="manifest.json" /></Section>
          </PageContent>
        </DetailLayout>
      ) : null}
    </>
  );
}
