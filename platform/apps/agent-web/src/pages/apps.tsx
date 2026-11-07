import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowRight, Boxes, Check, FileText, Folder, GitBranch, PackagePlus,
  Play, Plus, Save, Search
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { PageHeader, ViewTab } from '@/components/layout/app-shell';
import { AppList, AppListSkeleton } from '@/components/bui/app-list';
import { RunReleaseDialog } from '@/components/bui/run-release-dialog';
import { PageContent, Quiet, Section, SubPane } from '@/components/layout/page';
import { StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ActionMenu } from '@/components/ui/action-menu';
import { ListRow, Pill, RowId, RowMeta, RowTitle } from '@/components/ui/list';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Field, Input, Textarea } from '@/components/ui/input';
import { Empty, ErrorState, JsonView, Loading, Mono } from '@/components/ui/misc';
import { StatusIcon } from '@/components/ui/status';
import { ApiError, api } from '@/lib/api';
import { saveBlob } from '@/lib/download';
import { EXAMPLE_APPS, importExampleApp } from '@/lib/example-apps';
import { errorDisplay } from '@/lib/error-message';
import { useT } from '@/lib/i18n';
import { isMock } from '@/lib/mock';
import type { AppDraft, AppRelease, AppReleaseResult } from '@/lib/types';
import { formatTime, relativeTime } from '@/lib/utils';

export function AppsPage() {
  const { appId } = useParams();
  const t = useT();
  const [q, setQ] = useState('');
  const apps = useQuery({ queryKey: ['apps'], queryFn: api.apps.list });
  const items = useMemo(() => {
    const list = apps.data?.apps ?? [];
    const needle = q.trim().toLowerCase();
    if (!needle) return list;
    return list.filter((app) => app.appId.toLowerCase().includes(needle) || (app.name?.toLowerCase().includes(needle) ?? false));
  }, [apps.data?.apps, q]);

  return (
    <div className="flex min-h-0 flex-1">
      <SubPane>
        <PageHeader title={t('nav.apps')} actions={<><CreateAppButton icon /><ImportExampleApps asMenu /></>} />
        <div className="flex items-center gap-1 border-b border-line px-2 py-1.5">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-faint" strokeWidth={1.75} />
            <Input placeholder={t('apps.filterApps')} value={q} onChange={(event) => setQ(event.target.value)} className="h-7 pl-7 text-[12.5px]" />
          </div>
        </div>
        <PageContent flush className="px-2.5 pb-2">
          {apps.isLoading ? <AppListSkeleton /> : apps.error ? <ErrorState error={apps.error} /> : items.length === 0 ? (
            <Empty icon={Boxes} title={q.trim() ? t('apps.filterEmpty.title') : t('apps.empty.title')} hint={q.trim() ? t('apps.filterEmpty.hint') : t('apps.empty.hint')}>
              {q.trim() ? null : <><CreateAppButton /><ImportExampleApps /></>}
            </Empty>
          ) : (
            <AppList items={items} activeId={appId} />
          )}
        </PageContent>
      </SubPane>
      <section className="flex min-w-0 flex-1 flex-col">
        {appId ? <AppDetailPage key={appId} /> : (
          <Empty icon={Boxes} title={t('apps.noSelection.title')} hint={t('apps.noSelection.hint')}>
            <CreateAppButton />
            <ImportExampleApps />
          </Empty>
        )}
      </section>
    </div>
  );
}

function CreateAppButton({ icon = false }: { icon?: boolean }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <>
      {icon
        ? <Button variant="ghost" size="icon" title={t('apps.new.action')} onClick={() => setOpen(true)}><Plus /></Button>
        : <Button onClick={() => setOpen(true)}><Plus />{t('apps.new.action')}</Button>}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent title={t('apps.new.title')} description={t('apps.new.description')}>
          <CreateAppForm onClose={() => setOpen(false)} />
        </DialogContent>
      </Dialog>
    </>
  );
}

function CreateAppForm({ onClose }: { onClose: () => void }) {
  const t = useT();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [appId, setAppId] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const create = useMutation({
    mutationFn: () => api.apps.create({
      appId: appId.trim(),
      ...(name.trim() ? { name: name.trim() } : {}),
      ...(description.trim() ? { description: description.trim() } : {})
    }),
    onSuccess: async (app) => {
      await queryClient.invalidateQueries({ queryKey: ['apps'] });
      onClose();
      void navigate(`/apps/${encodeURIComponent(app.appId)}`);
    }
  });
  return (
    <form className="flex flex-col gap-3" onSubmit={(event) => { event.preventDefault(); create.mutate(); }}>
      <Field label={t('apps.new.appId')} hint={t('apps.new.appIdHint')}>
        <Input required pattern={'^[a-z0-9][a-z0-9._\\-]{2,127}$'} value={appId} onChange={(event) => setAppId(event.target.value)} />
      </Field>
      <Field label={t('apps.new.name')} hint={t('apps.new.nameHint')}>
        <Input value={name} maxLength={128} onChange={(event) => setName(event.target.value)} />
      </Field>
      <Field label={t('apps.new.descriptionLabel')}>
        <Textarea rows={3} maxLength={2048} value={description} onChange={(event) => setDescription(event.target.value)} />
      </Field>
      {create.error ? <ErrorState error={create.error} /> : null}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onClose}>{t('common.cancel')}</Button>
        <Button type="submit" disabled={create.isPending}>{create.isPending ? t('apps.new.creating') : t('apps.new.submit')}</Button>
      </div>
    </form>
  );
}

function ImportExampleApps({ asMenu = false }: { asMenu?: boolean }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <>
      {asMenu
        ? <ActionMenu label={t('apps.menu.more')} items={[{ id: 'import', label: t('apps.import.action'), onSelect: () => setOpen(true) }]} />
        : <Button variant="secondary" onClick={() => setOpen(true)}><PackagePlus />{t('apps.import.action')}</Button>}
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
      await queryClient.invalidateQueries({ queryKey: ['apps'] });
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

type DetailTab = 'properties' | 'draft' | 'releases' | 'runs';

type DraftChrome = {
  statusLine: string;
  attention: 'unsaved' | 'unpublished' | 'clean';
  showSave: boolean;
  saveDisabled: boolean;
  savePending: boolean;
  publishDisabled: boolean;
  publishPending: boolean;
  publishTitle?: string;
  busy: boolean;
};

type DraftActions = {
  save: () => void;
  publish: () => void;
  reload: () => void;
  upload: () => void;
  download: () => void;
};

const idleDraftActions: DraftActions = { save() {}, publish() {}, reload() {}, upload() {}, download() {} };

export function AppDetailPage() {
  const { appId = '' } = useParams();
  const navigate = useNavigate();
  const t = useT();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [runRelease, setRunRelease] = useState<AppRelease>();
  const [tab, setTab] = useState<DetailTab>('properties');
  const [chrome, setChrome] = useState<DraftChrome>();
  const [chromeAppId, setChromeAppId] = useState(appId);
  if (chromeAppId !== appId) {
    setChromeAppId(appId);
    setChrome(undefined);
  }
  const draftActions = useRef<DraftActions>(idleDraftActions);
  const onChrome = useCallback((next: DraftChrome) => { setChrome(next); }, []);
  const app = useQuery({ queryKey: ['app', appId], queryFn: () => api.apps.get(appId) });
  const appRuns = useQuery({
    queryKey: ['app-runs', appId],
    queryFn: () => api.apps.runs(appId, { limit: 50 }),
    enabled: app.data !== undefined,
    refetchInterval: (query) => (query.state.data?.runs ?? []).some((run) => !['succeeded', 'failed', 'cancelled'].includes(run.status)) ? 10_000 : false
  });
  const remove = useMutation({ mutationFn: () => api.apps.remove(appId), onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ['apps'] }); navigate('/apps'); } });
  const requestedRun = searchParams.get('run');

  useEffect(() => {
    if (requestedRun === null || app.data === undefined) return;
    const release = app.data.releases.find((entry) => entry.releaseId === requestedRun);
    if (release !== undefined) setRunRelease(release);
    const next = new URLSearchParams(searchParams);
    next.delete('run');
    setSearchParams(next, { replace: true });
  }, [requestedRun, app.data, searchParams, setSearchParams]);

  const manifest = app.data?.manifest;
  const releases = app.data?.releases ?? [];
  const runs = appRuns.data?.runs ?? [];
  const tasks = manifest?.tasks ?? [];
  const inputs = manifest?.inputs ?? [];
  const dataSources = manifest?.dataSources ?? [];
  const skills = manifest?.skillRefs ?? [];
  const capabilities = manifest?.capabilityRefs ?? [];
  const shortDigest = (releaseId: string) => releaseId.replace(/^sha256:/, '').slice(0, 12);
  const draftBusy = chrome?.busy === true;

  return (
    <>
      <PageHeader title={appId}
        tabs={app.data ? <>
          <ViewTab active={tab === 'properties'} onClick={() => setTab('properties')}>{t('apps.detail.tabs.properties')}</ViewTab>
          <ViewTab active={tab === 'draft'} onClick={() => setTab('draft')}>{t('apps.detail.tabs.draft')}</ViewTab>
          <ViewTab active={tab === 'releases'} onClick={() => setTab('releases')}><span className="inline-flex items-center gap-1.5">{t('apps.detail.tabs.releases')}<span className="tabular-nums text-ink-3">{releases.length}</span></span></ViewTab>
          <ViewTab active={tab === 'runs'} onClick={() => setTab('runs')}><span className="inline-flex items-center gap-1.5">{t('apps.detail.tabs.runs')}<span className="tabular-nums text-ink-3">{runs.length}</span></span></ViewTab>
        </> : undefined}
        meta={app.data ? (
          <div className="flex items-center gap-2">
            <StatusBadge status={app.data.status} />
            {tab !== 'draft' && chrome && chrome.attention !== 'clean' ? <Pill color="var(--amber)">{chrome.attention === 'unsaved' ? t('apps.draft.unsaved') : t('apps.draft.unpublished')}</Pill> : null}
          </div>
        ) : undefined}
        actions={app.data ? (
          <>
            {chrome?.showSave ? <Button variant="secondary" size="sm" disabled={chrome.saveDisabled} onClick={() => draftActions.current.save()}><Save />{chrome.savePending ? t('apps.draft.saving') : t('apps.draft.save')}</Button> : null}
            <Button size="sm" disabled={chrome === undefined || chrome.publishDisabled} title={chrome?.publishTitle} onClick={() => draftActions.current.publish()}><GitBranch />{chrome?.publishPending ? t('apps.draft.publishing') : t('apps.draft.publish')}</Button>
            <ActionMenu label={t('apps.menu.more')} items={[
              { id: 'reload', label: t('apps.draft.reload'), disabled: draftBusy || chrome === undefined, onSelect: () => draftActions.current.reload() },
              { id: 'upload', label: t('apps.draft.upload'), disabled: draftBusy || chrome === undefined, onSelect: () => draftActions.current.upload() },
              { id: 'download', label: t('apps.draft.download'), disabled: draftBusy || chrome === undefined, onSelect: () => draftActions.current.download() },
              { id: 'delete', label: t('common.delete'), danger: true, disabled: remove.isPending, onSelect: () => { if (confirm(t('apps.detail.deleteConfirm', { app: appId }))) remove.mutate(); } }
            ]} />
          </>
        ) : undefined} />
      {remove.error ? <ErrorState error={remove.error} /> : null}
      {app.isLoading ? <Loading /> : app.error ? <ErrorState error={app.error} /> : app.data ? (
        <PageContent fill={tab === 'draft'}>
          {tab === 'properties' ? (
            <>
              <Section card title={t('apps.detail.properties')}>
                <ListRow><RowId>{t('apps.detail.status')}</RowId><RowTitle><StatusBadge status={app.data.status} /></RowTitle></ListRow>
                <ListRow><RowId>{t('apps.detail.version')}</RowId><RowTitle><Mono>{manifest?.version ?? app.data.latestVersion ?? '—'}</Mono></RowTitle></ListRow>
                <ListRow><RowId>{t('apps.detail.entry')}</RowId><RowTitle><Mono>{manifest?.entry ?? '—'}</Mono></RowTitle></ListRow>
                <ListRow><RowId>{t('apps.detail.model')}</RowId><RowTitle>{manifest?.modelRoute ? <Mono>{`${manifest.modelRoute.provider} / ${manifest.modelRoute.model}`}</Mono> : '—'}</RowTitle></ListRow>
                <ListRow><RowId>{t('apps.detail.created')}</RowId><RowTitle>{formatTime(app.data.createdAt)}</RowTitle></ListRow>
              </Section>
              {skills.length === 0 ? null : (
                <Section card title={t('apps.detail.skills')} count={skills.length}>
                  <div className="flex flex-wrap gap-1.5 gutter-x py-3">{skills.map((s) => <Pill key={s} color="var(--violet)">{s.replace(/^skill:\/\//, '')}</Pill>)}</div>
                </Section>
              )}
              {capabilities.length === 0 ? null : (
                <Section card title={t('apps.detail.capabilities')} count={capabilities.length}>
                  <div className="flex flex-wrap gap-1.5 gutter-x py-3">{capabilities.map((s) => <Pill key={s} color="var(--blue)">{s.replace(/^capability:\/\//, '')}</Pill>)}</div>
                </Section>
              )}
              {tasks.length === 0 ? null : (
                <Section card title={t('apps.detail.tasks')} count={tasks.length}>
                  {tasks.map((task) => (
                    <ListRow key={task.name}><StatusIcon kind="todo" /><RowTitle sub={task.entry}>{task.name}</RowTitle></ListRow>
                  ))}
                </Section>
              )}
              {inputs.length === 0 && dataSources.length === 0 ? null : (
                <Section card title={t('apps.detail.inputs')}>
                  {inputs.map((input) => (
                    <ListRow key={`i-${input.name}`}><RowId>{t('apps.detail.input')}</RowId><RowTitle sub={input.type}>{input.name}</RowTitle><RowMeta>{input.required ? <Pill>{t('apps.detail.required')}</Pill> : <span className="text-faint">{t('apps.detail.optional')}</span>}</RowMeta></ListRow>
                  ))}
                  {dataSources.map((source) => (
                    <ListRow key={`d-${source.name}`}><RowId>{t('apps.detail.source')}</RowId><RowTitle sub={source.url}>{source.name}</RowTitle></ListRow>
                  ))}
                </Section>
              )}
              {tasks.length === 0 && inputs.length === 0 && dataSources.length === 0 && skills.length === 0 && capabilities.length === 0 && manifest === undefined
                ? <Quiet>{t('apps.detail.definitionEmpty')}</Quiet>
                : null}
              {manifest === undefined ? null : (
                <Section title={t('apps.detail.rawManifest')}>
                  <JsonView value={manifest} filename="manifest.json" />
                </Section>
              )}
            </>
          ) : null}
          <div className={tab === 'draft' ? 'flex min-h-0 flex-1 flex-col' : 'hidden'}>
            <DraftPanel key={appId} appId={appId} hasUnpublishedChanges={app.data.hasUnpublishedChanges} actionsRef={draftActions} onChrome={onChrome} />
          </div>
          {tab === 'releases' ? (
            releases.length === 0 ? <Quiet>{t('apps.detail.releasesEmpty')}</Quiet> : (
              <Section card>
                {releases.map((release) => (
                  <ListRow key={release.releaseId}>
                    <RowTitle sub={<Mono>{shortDigest(release.releaseId)}</Mono>}>{`v${release.packageVersion}`}</RowTitle>
                    <RowMeta>
                      <span className="text-faint">{formatTime(release.createdAt)}</span>
                      <Link className="text-accent-ink hover:underline" to={`/apps/${encodeURIComponent(appId)}/releases/${encodeURIComponent(release.releaseId)}`}>{t('apps.detail.openRelease')}</Link>
                      <Button size="sm" variant="secondary" disabled={isMock()} title={isMock() ? t('apps.run.mockDisabled') : undefined} onClick={() => setRunRelease(release)}><Play />{t('apps.detail.run')}</Button>
                    </RowMeta>
                  </ListRow>
                ))}
              </Section>
            )
          ) : null}
          {tab === 'runs' ? (
            appRuns.isLoading ? <Loading rows={3} /> : appRuns.error ? <ErrorState error={appRuns.error} /> : runs.length === 0 ? <Quiet>{t('apps.detail.runsEmpty')}</Quiet> : (
              <Section card>
                {runs.map((run) => (
                  <ListRow key={run.taskId} onClick={() => { void navigate(`/apps/${encodeURIComponent(appId)}/runs/${encodeURIComponent(run.taskId)}`); }}>
                    <span className="w-[86px] shrink-0"><StatusBadge status={run.status} /></span>
                    <RowTitle sub={<Mono>{run.taskId}</Mono>}>{run.releaseVersion ? `v${run.releaseVersion}` : t('apps.detail.unknownVersion')}</RowTitle>
                    <RowMeta>
                      <Pill>{run.source === 'schedule' ? t('apps.detail.sourceSchedule') : t('apps.detail.sourceManual')}</Pill>
                      <span className="text-faint">{relativeTime(run.createdAt)}</span>
                    </RowMeta>
                  </ListRow>
                ))}
              </Section>
            )
          ) : null}
        </PageContent>
      ) : null}
      <RunReleaseDialog appId={appId} release={runRelease} manifest={runRelease?.manifest ?? manifest} onClose={() => setRunRelease(undefined)} />
    </>
  );
}

const versionFromFiles = (files: Record<string, string>): string | undefined =>
  /^version:\s*['"]?([^'"\s]+)['"]?\s*$/m.exec(files['app.yaml'] ?? '')?.[1];

const firstPath = (files: Record<string, string>): string | undefined => {
  const paths = Object.keys(files).sort((a, b) => a.localeCompare(b));
  return paths.find((path) => path === 'app.yaml') ?? paths.find((path) => path.startsWith('prompts/')) ?? paths[0];
};

const fingerprint = (files: Record<string, string>) =>
  JSON.stringify(Object.entries(files).sort(([a], [b]) => a.localeCompare(b)));

type DraftMessage = { tone: 'ok' | 'warn' | 'error'; text: string; release?: AppReleaseResult };

function DraftPanel({ appId, hasUnpublishedChanges, actionsRef, onChrome }: {
  appId: string;
  hasUnpublishedChanges: boolean;
  actionsRef: MutableRefObject<DraftActions>;
  onChrome: (chrome: DraftChrome) => void;
}) {
  const t = useT();
  const queryClient = useQueryClient();
  const draftQuery = useQuery({ queryKey: ['app-draft', appId], queryFn: () => api.apps.getDraft(appId) });
  const [seed, setSeed] = useState<AppDraft>();
  const [files, setFiles] = useState<Record<string, string>>();
  const [revision, setRevision] = useState<number>();
  const [selectedPath, setSelectedPath] = useState<string>();
  const [message, setMessage] = useState<DraftMessage>();
  const [uploading, setUploading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const uploadRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const draft = draftQuery.data;
    if (draft === undefined || seed !== undefined) return;
    adoptDraft(draft);
  }, [draftQuery.data, seed]);

  function adoptDraft(draft: AppDraft): void {
    setSeed(draft);
    setFiles(draft.files);
    setRevision(draft.revision);
    setSelectedPath((current) => (current !== undefined && draft.files[current] !== undefined ? current : firstPath(draft.files)));
  }

  const dirty = seed !== undefined && files !== undefined && fingerprint(files) !== fingerprint(seed.files);
  const version = files === undefined ? undefined : versionFromFiles(files);
  const paths = files === undefined ? [] : Object.keys(files).sort((a, b) => a.localeCompare(b));
  const groups = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const path of Object.keys(files ?? {}).sort((a, b) => a.localeCompare(b))) {
      const cut = path.lastIndexOf('/');
      const dir = cut === -1 ? '' : path.slice(0, cut);
      const list = map.get(dir);
      if (list === undefined) map.set(dir, [path]); else list.push(path);
    }
    return [...map.entries()];
  }, [files]);

  const fail = (error: unknown) => {
    if (error instanceof ApiError && error.code === 'APP_DRAFT_CONFLICT') {
      const current = Number(error.details?.['currentRevision']);
      setMessage({ tone: 'warn', text: t('apps.draft.conflict', { revision: Number.isFinite(current) ? current : '?' }) });
      void queryClient.invalidateQueries({ queryKey: ['app-draft', appId] });
      return;
    }
    if (error instanceof ApiError && error.code === 'RELEASE_VERSION_CONFLICT') {
      setMessage({ tone: 'error', text: t('apps.draft.versionConflict', { version: version ?? '?' }) });
      return;
    }
    if (error instanceof ApiError && error.code === 'MOCK_IMPORT_UNSUPPORTED') {
      setMessage({ tone: 'warn', text: t('apps.draft.uploadUnsupported') });
      return;
    }
    const display = errorDisplay(error);
    setMessage({ tone: 'error', text: [display.text, display.detail].filter(Boolean).join(' ') });
  };

  const save = useMutation({
    mutationFn: () => api.apps.putDraft(appId, files ?? {}, revision),
    onSuccess: async (draft) => {
      adoptDraft(draft);
      setMessage({ tone: 'ok', text: t('apps.draft.saved', { revision: draft.revision }) });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['app', appId] }),
        queryClient.invalidateQueries({ queryKey: ['app-draft', appId] })
      ]);
    },
    onError: fail
  });

  const publish = useMutation({
    mutationFn: () => api.apps.publish(appId, revision ?? -1),
    onSuccess: async (result) => {
      setMessage({
        tone: 'ok',
        text: result.status === 'existing' ? t('apps.draft.existing', { version: result.packageVersion }) : t('apps.draft.published', { version: result.packageVersion }),
        release: result
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['app', appId] }),
        queryClient.invalidateQueries({ queryKey: ['app-draft', appId] }),
        queryClient.invalidateQueries({ queryKey: ['apps'] })
      ]);
    },
    onError: fail
  });

  const upload = async (file: File) => {
    setUploading(true);
    setMessage(undefined);
    try {
      const draft = await api.apps.importDraft(appId, file, file.name, revision);
      adoptDraft(draft);
      setMessage({ tone: 'ok', text: t('apps.draft.uploadDone', { revision: draft.revision }) });
      await queryClient.invalidateQueries({ queryKey: ['app', appId] });
    } catch (error) {
      fail(error);
    } finally {
      setUploading(false);
    }
  };

  const download = async () => {
    setDownloading(true);
    setMessage(undefined);
    try {
      saveBlob(await api.apps.exportDraft(appId), `${appId}-draft.tar.gz`);
    } catch (error) {
      const display = errorDisplay(error);
      setMessage({ tone: 'error', text: `${t('apps.draft.downloadFailed')} ${[display.text, display.detail].filter(Boolean).join(' ')}` });
    } finally {
      setDownloading(false);
    }
  };

  const reload = async () => {
    setMessage(undefined);
    const result = await draftQuery.refetch();
    if (result.data !== undefined) adoptDraft(result.data);
  };

  const busy = save.isPending || publish.isPending || uploading || downloading;
  const publishBlocked = dirty || revision === undefined || paths.length === 0;
  const attention = dirty ? 'unsaved' : hasUnpublishedChanges ? 'unpublished' : 'clean';
  const stateLabel = dirty
    ? t('apps.draft.unsaved')
    : hasUnpublishedChanges
      ? t('apps.draft.unpublished')
      : version
        ? t('apps.draft.stateCleanVersion', { version })
        : t('apps.draft.clean');
  const statusLine = t('apps.draft.statusLine', {
    revision: revision === undefined ? '—' : `r${revision}`,
    files: t('apps.draft.files', { count: paths.length }),
    state: stateLabel
  });

  actionsRef.current = {
    save: () => { save.mutate(); },
    publish: () => { publish.mutate(); },
    reload: () => { void reload(); },
    upload: () => { uploadRef.current?.click(); },
    download: () => { void download(); }
  };

  useEffect(() => {
    if (files === undefined) return;
    onChrome({
      statusLine,
      attention,
      showSave: dirty,
      saveDisabled: !dirty || revision === undefined || busy,
      savePending: save.isPending,
      publishDisabled: publishBlocked || busy,
      publishPending: publish.isPending,
      ...(dirty ? { publishTitle: t('apps.draft.saveFirst') } : paths.length === 0 ? { publishTitle: t('apps.draft.empty') } : {}),
      busy
    });
  }, [files, statusLine, attention, dirty, revision, busy, publishBlocked, save.isPending, publish.isPending, paths.length, onChrome, t]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {draftQuery.isLoading ? <Loading rows={3} /> : draftQuery.error ? <ErrorState error={draftQuery.error} /> : files !== undefined ? (
        <>
          <div className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-2.5">
            <p className="min-w-0 truncate text-[13px] text-ink-2">{statusLine}</p>
            <input ref={uploadRef} type="file" accept=".tar.gz,.tgz,application/gzip" className="hidden" onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (file !== undefined) void upload(file);
            }} />
          </div>
          <div className="flex min-h-0 flex-1 flex-col md:flex-row md:items-stretch">
            <div className="flex w-full shrink-0 flex-col border-b border-line md:w-72 md:self-stretch md:border-b-0 md:border-r">
              {groups.length === 0 ? <p className="px-3 py-4 text-[12.5px] text-faint">{t('apps.draft.noFiles')}</p> : (
                <div className="flex min-h-full flex-1 flex-col">
                  {groups.map(([dir, entries]) => (
                    <div key={dir || '.'} className="flex flex-col">
                      <div className="flex h-8 items-center gap-1.5 px-3 text-[11px] font-medium uppercase tracking-wide text-faint">
                        <Folder className="size-3.5" />{dir === '' ? '/' : dir}
                      </div>
                      {entries.map((path) => {
                        const name = dir === '' ? path : path.slice(dir.length + 1);
                        const active = path === selectedPath;
                        return (
                          <button key={path} type="button" aria-pressed={active} title={path}
                            onClick={() => setSelectedPath(path)}
                            className={`flex h-[38px] w-full items-center gap-2 px-3 text-left text-[13px] transition-colors duration-75 ${active ? 'bg-active text-ink' : 'text-ink-2 hover:bg-hover'}`}>
                            <FileText className="size-3.5 shrink-0 text-faint" /><span className="min-w-0 flex-1 truncate">{name}</span>
                          </button>
                        );
                      })}
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="flex min-h-[320px] min-w-0 flex-1 flex-col">
              {selectedPath === undefined ? (
                <p className="px-3 py-6 text-[12.5px] text-faint">{t('apps.draft.selectFile')}</p>
              ) : (
                <>
                  <div className="flex h-8 shrink-0 items-center gap-2 border-b border-line px-3">
                    <Mono className="truncate text-faint">{selectedPath}</Mono>
                  </div>
                  <Textarea spellCheck={false} aria-label={selectedPath} value={files[selectedPath] ?? ''}
                    onChange={(event) => { const value = event.target.value; setFiles((current) => current === undefined ? current : { ...current, [selectedPath]: value }); }}
                    className="min-h-0 w-full flex-1 resize-none rounded-none border-0 px-3 py-3 font-mono text-[12px] leading-5 focus:shadow-none" />
                </>
              )}
            </div>
          </div>
          {message === undefined ? null : (
            <div role="status" className={`flex flex-wrap items-center gap-2 border-t border-line px-3 py-2 text-[12.5px] ${message.tone === 'ok' ? 'text-green' : message.tone === 'warn' ? 'text-amber' : 'text-red'}`}>
              <span>{message.text}</span>
              {message.release?.status === 'stored' ? (
                <Link className="flex items-center gap-1 text-accent-ink hover:underline" to={`/apps/${encodeURIComponent(appId)}/releases/${encodeURIComponent(message.release.releaseId)}`}>
                  <GitBranch className="size-3.5" />{`v${message.release.packageVersion}`}
                </Link>
              ) : null}
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}
