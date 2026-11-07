import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, Pencil, Plus, Trash2, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { PageHeader } from '@/components/layout/app-shell';
import { CardRow, PageContent, PageDescription, Quiet, Section, SegmentedTabs, SettingsGroup, SettingsRow } from '@/components/layout/page';
import { StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Combobox, type ComboboxOption } from '@/components/ui/combobox';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Field, Input, Select } from '@/components/ui/input';
import { Pill } from '@/components/ui/list';
import { ErrorState, Loading, Mono } from '@/components/ui/misc';
import { StatusIcon, statusLabelKey } from '@/components/ui/status';
import { ChartCard, Legend, StackedBars, useChartTheme } from '@/components/charts';
import { api } from '@/lib/api';
import { errorDisplay } from '@/lib/error-message';
import { useT } from '@/lib/i18n';
import { isMock, mockSeries } from '@/lib/mock';
import { addModel, connectionModelList, extraModels, MAX_CONNECTION_MODELS, mergeModelCandidates, promoteDefault } from '@/lib/connection-models';
import { adapterBaseUrl, adapterFromNpm, catalogBaseUrl, isUsableBaseUrl, KNOWN_BASE_URLS, type AdapterKind } from '@/lib/provider-autofill';
import type { CatalogProviderItem, CatalogStatus, ProviderConnection, ProviderConnectionCheckResult, ProviderConnectionWrite } from '@/lib/types';
import { cn, formatTime, relativeTime } from '@/lib/utils';

export function ProvidersPage() {
  const queryClient = useQueryClient();
  const t = useT();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<ProviderConnection>();
  /** Prefill source that is not edited in place: deployment-env rows can only be copied into a user connection. */
  const [seed, setSeed] = useState<ProviderConnection>();
  const connections = useQuery({ queryKey: ['providers', 'connections'], queryFn: api.providers.list });
  const settings = useQuery({ queryKey: ['providers', 'settings'], queryFn: api.providers.settings });
  const catalog = useQuery({ queryKey: ['providers', 'catalog'], queryFn: api.providers.catalogStatus });
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['providers'] });
  const setDefault = useMutation({ mutationFn: api.providers.updateSettings, onSuccess: invalidate });
  const remove = useMutation({ mutationFn: api.providers.remove, onSuccess: invalidate });
  const defaultId = settings.data?.providerConnectionId;
  const items = connections.data?.connections ?? [];
  const defaultConnection = items.find((c) => c.id === defaultId);
  const closeEditor = () => { setOpen(false); setEditing(undefined); setSeed(undefined); };
  return (
    <>
      <PageHeader title={t('nav.providers')} />
      <PageContent width="narrow">
        <PageDescription title={t('nav.providers')} description={t('providers.description')}
          actions={<Button size="sm" onClick={() => { setEditing(undefined); setSeed(undefined); setOpen(true); }}><Plus />{t('providers.addConnection')}</Button>} />
        <Dialog open={open || editing !== undefined || seed !== undefined} onOpenChange={(next) => { if (!next) closeEditor(); }}>
          <DialogContent
            title={editing ? t('providers.dialog.editTitle') : seed ? t('providers.dialog.copyTitle') : t('providers.dialog.title')}
            description={editing ? t('providers.dialog.editDescription') : seed ? t('providers.dialog.copyDescription') : t('providers.dialog.description')}>
            <ConnectionForm key={editing?.id ?? seed?.id ?? 'create'} catalog={catalog.data} seed={editing ?? seed} editing={editing !== undefined} onDone={() => { closeEditor(); invalidate(); }} />
          </DialogContent>
        </Dialog>
        {setDefault.error ? <ErrorState error={setDefault.error} /> : remove.error ? <ErrorState error={remove.error} /> : null}

        <SettingsGroup title={t('providers.connections.title')} description={t('providers.connections.configured', { count: items.length })}>
          {connections.isLoading ? <Loading rows={3} /> : connections.error ? <ErrorState error={connections.error} /> : !items.length ? <SettingsRow label={t('providers.connections.empty')} description={t('providers.connections.emptyHint')} /> : items.map((c) => (
            <CardRow key={c.id} className="group">
              <StatusIcon status={c.enabled && c.credentialPresent ? 'succeeded' : 'paused'} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-[13px] text-fg">{c.name}{c.id === defaultId ? <Pill color="var(--accent)">{t('providers.connections.default')}</Pill> : null}{c.source === 'deployment-env' ? <Pill>{t('providers.connections.env')}</Pill> : null}</div>
                <div className="mt-0.5 truncate text-[12px] text-muted">{c.providerName !== undefined ? `${c.providerName} · ` : ''}<Mono>{c.modelId}</Mono>{extraModels(c.modelId, c.models).length > 0 ? <span title={extraModels(c.modelId, c.models).join(', ')}> {t('providers.connections.moreModels', { count: extraModels(c.modelId, c.models).length })}</span> : null} · {c.adapterKind} · {c.baseUrl}</div>
              </div>
              <span className="text-[12px] text-faint">{relativeTime(c.updatedAt)}</span>
              <span className="flex w-[6rem] justify-end gap-0.5">
                {c.source === 'user' ? <Button size="icon-sm" variant="ghost" title={t('providers.connections.edit')} aria-label={t('providers.connections.edit')} onClick={() => { setSeed(undefined); setEditing(c); setOpen(true); }}><Pencil /></Button> : null}
                <Button size="icon-sm" variant="ghost" title={t('providers.connections.copy')} aria-label={t('providers.connections.copy')} onClick={() => { setEditing(undefined); setSeed({ ...c, name: t('providers.connections.copyName', { name: c.name }) }); setOpen(true); }}><Copy /></Button>
                {c.id !== defaultId ? <Button size="icon-sm" variant="ghost" title={t('providers.connections.makeDefault')} disabled={setDefault.isPending} onClick={() => setDefault.mutate(c.id)}><Check /></Button> : null}
                {c.source === 'user' ? <Button size="icon-sm" variant="ghost" title={t('common.delete')} onClick={() => { if (confirm(t('providers.connections.deleteConfirm', { name: c.name }))) remove.mutate(c.id); }}><Trash2 /></Button> : null}
              </span>
            </CardRow>
          ))}
        </SettingsGroup>

        <Section title={t('providers.usage.title')} description={isMock() ? t('providers.usage.descriptionMock') : t('providers.usage.descriptionLive')}>
          {isMock() && items.length ? <ProviderUsage names={items.map((c) => c.name)} /> : <Quiet>{t('providers.usage.empty')}</Quiet>}
        </Section>

        <SettingsGroup title={t('providers.runAgent.title')} description={t('providers.runAgent.description')}>
          <SettingsRow label={t('providers.runAgent.defaultConnection')} description={settings.data?.updatedBy ? t('providers.runAgent.updatedBy', { time: formatTime(settings.data.updatedAt), user: settings.data.updatedBy }) : undefined}>
            <div className="flex w-full items-center gap-2">
              <Select className="w-full" aria-label={t('providers.runAgent.defaultConnection')} value={defaultId ?? ''} onChange={(e) => setDefault.mutate(e.target.value)} disabled={!settings.data}>
                {settings.data?.unset ? <option value="">{t('providers.runAgent.unset')}</option> : null}
                {settings.data?.providers.map((p) => <option key={p.id} value={p.id} disabled={!p.available}>{p.modelId === undefined || p.modelId === '' ? p.name : `${p.name} · ${p.modelId}`}</option>)}
              </Select>
              {defaultConnection?.source === 'user' ? <Button size="icon-sm" variant="ghost" title={t('providers.runAgent.editConnection')} aria-label={t('providers.runAgent.editConnection')} onClick={() => { setSeed(undefined); setEditing(defaultConnection); setOpen(true); }}><Pencil /></Button> : null}
            </div>
          </SettingsRow>
        </SettingsGroup>

        <SettingsGroup title={t('providers.catalog.title')} description={t('providers.catalog.description')}>
          <SettingsRow label={t('providers.catalog.availability')}>{catalog.data ? <StatusBadge status={catalog.data.availability} /> : null}</SettingsRow>
          <SettingsRow label={t('providers.catalog.providersModels')}><span className="tabular text-[13px] text-fg-2">{catalog.data?.providerCount ?? '—'} / {catalog.data?.modelCount ?? '—'}</span></SettingsRow>
          <SettingsRow label={t('providers.catalog.lastSync')}><span className="text-[12.5px] text-muted">{formatTime(catalog.data?.lastSuccessAt)}</span></SettingsRow>
          <SettingsRow label={t('providers.catalog.nextSync')}><span className="text-[12.5px] text-muted">{formatTime(catalog.data?.nextSyncAt)}</span></SettingsRow>
        </SettingsGroup>
      </PageContent>
    </>
  );
}

const MANUAL_DEFAULTS: ProviderConnectionWrite = { name: '', adapterKind: 'openai-compatible', baseUrl: 'https://api.openai.com/v1', modelId: '', apiKey: '' };

const errorText = (error: unknown): string | undefined =>
  error === null || error === undefined ? undefined : errorDisplay(error).text;

/** ProviderConnectionWrite with explicitly-undefined optionals; normalized() drops them before submit. */
type ConnectionDraft = Omit<ProviderConnectionWrite, 'providerName' | 'modelName' | 'apiKey'> & {
  providerName?: string | undefined;
  modelName?: string | undefined;
  apiKey?: string | undefined;
};
const normalized = ({ providerName, modelName, apiKey, ...rest }: ConnectionDraft): ProviderConnectionWrite => ({
  ...rest,
  ...(providerName === undefined ? {} : { providerName }),
  ...(modelName === undefined ? {} : { modelName }),
  ...(apiKey === undefined ? {} : { apiKey })
});

function useDebounced<T>(value: T, delay = 250): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => { const timer = setTimeout(() => setDebounced(value), delay); return () => clearTimeout(timer); }, [value, delay]);
  return debounced;
}

function useCatalogProviderId(providerId: string | undefined, providerName: string | undefined): string | undefined {
  // Stored connections keep the models.dev provider *name*; resolve it back to a provider id for suggestions.
  const lookup = useQuery({
    queryKey: ['providers', 'catalog', 'providers', 'lookup', providerName ?? ''],
    queryFn: () => api.providers.catalogProviders({ limit: 20, q: providerName! }),
    enabled: providerId === undefined && providerName !== undefined && providerName.trim() !== '',
    retry: false
  });
  return providerId ?? lookup.data?.items.find((item) => item.name === providerName || item.providerId === providerName)?.providerId;
}

export interface ModelCandidate { modelId: string; name?: string | undefined }

/**
 * Model picker offering only real candidates: the models.dev snapshot for the provider plus the endpoint's
 * live `/models` listing. No free-text ids — if a model is missing, the endpoint listing is the way in.
 */
function ModelCandidateCombobox({ providerId, liveModels, liveLoading, value, exclude = [], extra = [], disabled = false, placeholder, onSelect }: {
  providerId: string | undefined; liveModels: readonly string[]; liveLoading: boolean; value: string;
  exclude?: readonly string[] | undefined; /** Already-saved ids, so a connection stays editable when listing fails. */
  extra?: readonly string[] | undefined; disabled?: boolean | undefined; placeholder: string;
  onSelect: (candidate: ModelCandidate) => void;
}) {
  const t = useT();
  const [query, setQuery] = useState('');
  const search = useDebounced(query.trim());
  const catalog = useQuery({
    queryKey: ['providers', 'catalog', 'models', 'suggest', providerId ?? '', search],
    queryFn: () => api.providers.catalogModels({ providerId: providerId!, status: 'all', limit: 60, ...(search === '' ? {} : { q: search }) }),
    enabled: providerId !== undefined,
    retry: false
  });
  const catalogItems = catalog.data?.items ?? [];
  const byId = new Map(catalogItems.map((item) => [item.modelId, item]));
  const live = search === '' ? liveModels : liveModels.filter((id) => id.toLowerCase().includes(search.toLowerCase()));
  const options: ComboboxOption[] = mergeModelCandidates(catalogItems.map((item) => item.modelId), mergeModelCandidates(live, extra))
    .filter((id) => !exclude.includes(id))
    .map((id) => {
      const item = byId.get(id);
      return {
        value: id,
        label: item?.name ?? id,
        ...(item === undefined || item.name === id ? {} : { hint: id }),
        ...(item === undefined || item.status === 'active' ? {} : { meta: <Pill>{item.status}</Pill> })
      };
    });
  const empty = catalog.isLoading || liveLoading
    ? t('providers.create.loadingModels')
    : providerId === undefined && liveModels.length === 0 ? t('providers.create.noCandidateSource') : t('providers.create.noModelsMatch');
  return (
    <Combobox value={value === '' ? undefined : value} display={byId.get(value)?.name ?? value} query={query} onQueryChange={setQuery}
      onSelect={(option) => { setQuery(''); onSelect({ modelId: option.value, name: byId.get(option.value)?.name }); }} disabled={disabled}
      options={options} placeholder={placeholder} loading={catalog.isLoading}
      error={errorText(catalog.error)} empty={empty} />
  );
}

function ConnectionForm({ catalog, seed, editing, onDone }: {
  catalog: CatalogStatus | undefined; seed?: ProviderConnection | undefined; editing: boolean; onDone: () => void;
}) {
  const t = useT();
  const existing = seed;
  const [mode, setMode] = useState<'catalog' | 'manual'>('catalog');
  const [form, setForm] = useState<ProviderConnectionWrite>(() => existing === undefined ? MANUAL_DEFAULTS : {
    name: existing.name,
    adapterKind: existing.adapterKind,
    baseUrl: existing.baseUrl,
    modelId: existing.modelId,
    ...(existing.providerName === undefined ? {} : { providerName: existing.providerName }),
    ...(existing.modelName === undefined ? {} : { modelName: existing.modelName })
  });
  const [provider, setProvider] = useState<CatalogProviderItem | undefined>();
  const [providerQuery, setProviderQuery] = useState('');
  // Prefilled values stay auto-followable until the user edits them in this dialog.
  const [touched, setTouched] = useState({ name: false, baseUrl: false });
  const [probe, setProbe] = useState<ProviderConnectionCheckResult | undefined>();
  /** Allowed models besides the default (form.modelId); submitted together as `models`. */
  const [extras, setExtras] = useState<string[]>(() => existing === undefined ? [] : extraModels(existing.modelId, existing.models));
  const save = useMutation({
    mutationFn: (body: ProviderConnectionWrite) => editing && seed !== undefined
      ? api.providers.update(seed.id, body)
      : api.providers.create(body),
    onSuccess: onDone
  });
  const check = useMutation({
    mutationFn: () => api.providers.checkConnection({
      adapterKind: form.adapterKind, baseUrl: form.baseUrl, modelId: form.modelId,
      ...(form.apiKey ? { apiKey: form.apiKey } : {})
    }),
    onSuccess: (result) => setProbe(result)
  });

  const providerSearch = useDebounced(providerQuery.trim());
  const providerList = useQuery({
    queryKey: ['providers', 'catalog', 'providers', providerSearch],
    queryFn: () => api.providers.catalogProviders({ limit: 60, ...(providerSearch === '' ? {} : { q: providerSearch }) }),
    enabled: mode === 'catalog'
  });

  const providerItems = providerList.data?.items ?? [];
  const availabilityKey = catalog?.availability === undefined ? undefined : statusLabelKey(catalog.availability);
  const availabilityLabel = catalog?.availability === undefined ? '' : availabilityKey === undefined ? catalog.availability : t(availabilityKey);
  const auto = catalogBaseUrl(provider, undefined, form.adapterKind);
  const baseUrlValid = isUsableBaseUrl(form.baseUrl);
  const catalogReady = catalog === undefined || catalog.availability === 'available';
  const catalogProviderId = useCatalogProviderId(provider?.providerId, form.providerName);

  // Live candidates: a saved connection keeps using its stored credential until the endpoint or key is edited.
  const storedLookup = editing && seed !== undefined && form.baseUrl === seed.baseUrl && (form.apiKey ?? '').trim() === '';
  const draftKey = useDebounced(`${form.adapterKind}\u0000${form.baseUrl}\u0000${(form.apiKey ?? '').length}`, 500);
  const live = useQuery({
    queryKey: ['providers', 'models', 'live', storedLookup ? seed.id : 'draft', storedLookup ? 'stored' : draftKey],
    queryFn: () => storedLookup
      ? api.providers.connectionModels({ connectionId: seed.id })
      : api.providers.connectionModels({ adapterKind: form.adapterKind, baseUrl: form.baseUrl, ...(form.apiKey === undefined ? {} : { apiKey: form.apiKey }) }),
    enabled: baseUrlValid && (storedLookup || (form.apiKey ?? '').trim() !== ''),
    retry: false,
    staleTime: 5 * 60_000
  });
  const liveModels = live.data?.models ?? [];

  const resetProbe = () => setProbe(undefined);
  const set = (key: keyof ProviderConnectionWrite) => (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const value = event.target.value;
    setForm((f) => ({ ...f, [key]: value }));
    if (key === 'name') setTouched((cur) => ({ ...cur, name: true }));
    if (key === 'baseUrl') setTouched((cur) => ({ ...cur, baseUrl: true }));
    if (key === 'baseUrl' || key === 'adapterKind' || key === 'apiKey' || key === 'modelId') resetProbe();
  };

  const pickProvider = (option: ComboboxOption) => {
    const next = providerItems.find((item) => item.providerId === option.value);
    if (next === undefined) return;
    const adapterKind = adapterFromNpm(next.npm);
    const base = catalogBaseUrl(next, undefined, adapterKind);
    setProvider(next);
    setExtras([]);
    resetProbe();
    setForm((f) => normalized({
      ...f, providerName: next.name, modelId: '', modelName: undefined,
      adapterKind,
      ...(base === undefined || touched.baseUrl ? {} : { baseUrl: base.url }),
      ...(touched.name ? {} : { name: next.name })
    }));
  };

  /** Switching the adapter follows that adapter's known endpoint until the URL is edited by hand. */
  const pickAdapter = (adapterKind: AdapterKind) => {
    const nextAuto = catalogBaseUrl(provider, undefined, adapterKind) ?? (() => {
      const url = adapterBaseUrl(adapterKind, provider?.providerId ?? catalogProviderId, form.baseUrl);
      return url === undefined ? undefined : { url, source: 'known' as const };
    })();
    setForm((f) => normalized({ ...f, adapterKind, ...(touched.baseUrl || nextAuto === undefined ? {} : { baseUrl: nextAuto.url }) }));
    resetProbe();
  };

  const pickModel = (candidate: ModelCandidate) => {
    resetProbe();
    setForm((f) => normalized({ ...f, modelId: candidate.modelId, modelName: candidate.name }));
  };

  const providerOptions: ComboboxOption[] = providerItems.map((item) => ({
    value: item.providerId,
    label: item.name,
    hint: item.providerId,
    ...(item.api === undefined && KNOWN_BASE_URLS[item.providerId] === undefined ? { meta: <Pill>{t('providers.create.noEndpoint')}</Pill> } : {})
  }));
  const baseUrlHint = [
    auto !== undefined ? `${t(`providers.baseUrlSource.${auto.source}`)}: ${auto.url}` : provider !== undefined ? t('providers.create.noCatalogEndpoint') : t('providers.create.publicHttpsHint'),
    form.adapterKind === 'anthropic' ? t('providers.create.anthropicHint') : undefined
  ].filter((part): part is string => part !== undefined).join(' · ');
  const modelHint = live.isSuccess
    ? t('providers.create.liveModels', { count: liveModels.length })
    : live.isError ? t('providers.create.liveModelsFailed') : t('providers.create.modelHint');

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const body = { ...normalized(form), models: connectionModelList(form.modelId, extras) };
    if (editing && (body.apiKey === undefined || body.apiKey.trim() === '')) {
      const rest: ProviderConnectionWrite = { ...body };
      delete rest.apiKey;
      save.mutate(rest);
      return;
    }
    save.mutate(body);
  };
  const apiKeyRequired = !editing;

  return (
    <form className="flex flex-col gap-3" onSubmit={submit}>
      <SegmentedTabs value={mode} onChange={setMode} items={[{ value: 'catalog', label: t('providers.create.fromCatalog') }, { value: 'manual', label: t('providers.create.manual') }]} />
      {!catalogReady ? <p className="text-[12px] leading-[18px] text-amber">{t('providers.create.catalogWarning', { availability: availabilityLabel, time: formatTime(catalog?.lastSuccessAt) })}</p> : null}
      {mode === 'catalog' ? (
        <Field label={t('providers.create.provider')} hint={catalog?.providerCount !== undefined ? t('providers.create.providerCount', { count: catalog.providerCount }) : undefined}>
          <Combobox value={provider?.providerId} display={provider?.name ?? form.providerName ?? ''} query={providerQuery} onQueryChange={setProviderQuery} onSelect={pickProvider}
            options={providerOptions} placeholder={t('providers.create.searchProviders')} loading={providerList.isLoading} error={errorText(providerList.error)} empty={t('providers.create.noProvidersMatch')}
            footer={providerList.data === undefined ? undefined : `${t('providers.create.shown', { count: providerItems.length })}${providerList.data.nextCursor !== undefined ? ` · ${t('providers.create.typeToNarrow')}` : ''}`} />
        </Field>
      ) : null}
      <Field label={t('providers.create.baseUrl')} hint={baseUrlHint}>
        <div className="flex w-full flex-col gap-1.5">
          <Input required value={form.baseUrl} onChange={set('baseUrl')} placeholder="https://api.example.com/v1" />
          <div className="flex items-center gap-3">
            {!baseUrlValid && form.baseUrl !== '' ? <span className="text-[12px] text-red">{t('providers.create.invalidUrl')}</span> : null}
            {auto !== undefined && form.baseUrl !== auto.url ? <button type="button" className="text-[12px] text-accent-ink hover:underline" onClick={() => { setForm((f) => ({ ...f, baseUrl: auto.url })); resetProbe(); }}>{t('providers.create.useCatalogDefault')}</button> : null}
          </div>
        </div>
      </Field>
      <Field label={t('providers.create.adapter')}><Select value={form.adapterKind} onChange={(event) => pickAdapter(event.target.value as AdapterKind)}><option value="openai-compatible">openai-compatible</option><option value="anthropic">anthropic</option></Select></Field>
      <Field label={t('providers.create.modelId')} hint={modelHint}>
        <ModelCandidateCombobox providerId={catalogProviderId} liveModels={liveModels} liveLoading={live.isLoading} value={form.modelId} extra={existing?.models ?? []}
          placeholder={t('providers.create.pickModel')} onSelect={pickModel} />
      </Field>
      <ModelListField modelId={form.modelId} extras={extras} providerId={catalogProviderId} liveModels={liveModels} liveLoading={live.isLoading}
        onChange={(next) => { if (next.modelId !== form.modelId) { setForm((f) => normalized({ ...f, modelId: next.modelId, modelName: undefined })); resetProbe(); } setExtras(next.extras); }} />
      <Field label={t('providers.create.name')}><Input required value={form.name} onChange={set('name')} placeholder={t('providers.create.namePlaceholder')} /></Field>
      <Field label={t('providers.create.apiKey')} hint={editing ? t('providers.create.apiKeyKeep') : undefined}>
        <Input required={apiKeyRequired} type="password" autoComplete="off" value={form.apiKey ?? ''} onChange={set('apiKey')} placeholder={editing ? t('providers.create.apiKeyPlaceholder') : undefined} />
      </Field>
      <div className="flex items-center gap-2">
        <Button type="button" variant="secondary" size="sm" disabled={check.isPending || !baseUrlValid || form.modelId.trim() === ''} onClick={() => check.mutate()}>{check.isPending ? t('providers.create.testing') : t('providers.create.test')}</Button>
        {probe !== undefined ? <span className={cn('text-[12.5px]', probe.status === 'connected' ? 'text-green' : probe.status === 'unauthorized' ? 'text-red' : 'text-amber')}>{probe.message}</span> : null}
        {check.error ? <span className="text-[12.5px] text-red">{errorText(check.error)}</span> : null}
      </div>
      {save.error ? <ErrorState error={save.error} /> : null}
      <div className="flex justify-end"><Button type="submit" disabled={save.isPending || !baseUrlValid || form.name.trim() === '' || form.modelId.trim() === '' || (apiKeyRequired && (form.apiKey ?? '').trim() === '')}>{editing ? t('common.save') : t('common.create')}</Button></div>
    </form>
  );
}

/** Edits the connection's allowed models: default first, promote/remove others, add from the same candidate sources. */
function ModelListField({ modelId, extras, providerId, liveModels, liveLoading, onChange }: {
  modelId: string; extras: string[]; providerId: string | undefined; liveModels: readonly string[]; liveLoading: boolean;
  onChange: (next: { modelId: string; extras: string[] }) => void;
}) {
  const t = useT();
  const all = connectionModelList(modelId, extras);
  const full = all.length >= MAX_CONNECTION_MODELS;
  const hint = full
    ? t('providers.create.modelsLimit', { max: MAX_CONNECTION_MODELS })
    : providerId !== undefined || liveModels.length > 0 ? t('providers.create.addModelCatalogHint') : t('providers.create.modelsHint');
  return (
    <Field label={`${t('providers.create.models')} · ${t('providers.create.modelsCount', { count: all.length })}`} hint={hint}>
      <div className="flex w-full flex-col gap-1.5">
        {all.length > 0 ? (
          <div className="divide-y divide-line rounded-control border border-line-strong">
            {all.map((id) => {
              const isDefault = id === modelId.trim();
              return (
                <div key={id} className="group flex h-8 items-center gap-2 px-2.5">
                  <Mono className="min-w-0 flex-1 truncate text-[12.5px] text-ink">{id}</Mono>
                  {isDefault ? <Pill color="var(--accent)">{t('providers.create.defaultBadge')}</Pill> : (
                    <span className="flex gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                      <Button type="button" size="icon-sm" variant="ghost" title={t('providers.create.makeDefaultModel')} aria-label={t('providers.create.makeDefaultModel')} onClick={() => onChange(promoteDefault(modelId, extras, id))}><Check /></Button>
                      <Button type="button" size="icon-sm" variant="ghost" title={t('providers.create.removeModel', { model: id })} aria-label={t('providers.create.removeModel', { model: id })} onClick={() => onChange({ modelId, extras: extras.filter((item) => item !== id) })}><X /></Button>
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        ) : null}
        <ModelCandidateCombobox providerId={providerId} liveModels={liveModels} liveLoading={liveLoading} value="" exclude={all}
          disabled={full || modelId.trim() === ''} placeholder={t('providers.create.addModel')}
          onSelect={(candidate) => onChange({ modelId, extras: addModel(modelId, extras, candidate.modelId) })} />
      </div>
    </Field>
  );
}

function ProviderUsage({ names }: { names: string[] }) {
  const t = useT();
  const ct = useChartTheme();
  const series = [{ key: 'requests', label: t('providers.usage.requests'), color: ct.series[0]! }, { key: 'errors', label: t('providers.usage.errors'), color: ct.status.failed! }];
  const data = names.map((name) => { const req = mockSeries(name, 14, 40).reduce((a, b) => a + b, 0); return { label: name, requests: req, errors: Math.round(req * (0.01 + (mockSeries(`${name}-e`, 1, 5)[0]! / 100))) }; });
  return (
    <ChartCard title={t('providers.usage.chartTitle')} description={t('providers.usage.chartDescription', { requests: data.reduce((a, b) => a + b.requests, 0), errors: data.reduce((a, b) => a + b.errors, 0) })} actions={<Legend series={series} />}>
      <StackedBars data={data} series={series} height={170} />
    </ChartCard>
  );
}
