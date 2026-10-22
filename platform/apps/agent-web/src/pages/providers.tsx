import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Pencil, Plus, Trash2 } from 'lucide-react';
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
import { adapterFromNpm, catalogBaseUrl, connectionName, isUsableBaseUrl, KNOWN_BASE_URLS } from '@/lib/provider-autofill';
import type { CatalogModelItem, CatalogProviderItem, CatalogStatus, ProviderConnection, ProviderConnectionCheckResult, ProviderConnectionWrite } from '@/lib/types';
import { cn, formatTime, relativeTime } from '@/lib/utils';

export function ProvidersPage() {
  const queryClient = useQueryClient();
  const t = useT();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<ProviderConnection>();
  const connections = useQuery({ queryKey: ['providers', 'connections'], queryFn: api.providers.list });
  const settings = useQuery({ queryKey: ['providers', 'settings'], queryFn: api.providers.settings });
  const catalog = useQuery({ queryKey: ['providers', 'catalog'], queryFn: api.providers.catalogStatus });
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['providers'] });
  const setDefault = useMutation({ mutationFn: api.providers.updateSettings, onSuccess: invalidate });
  const remove = useMutation({ mutationFn: api.providers.remove, onSuccess: invalidate });
  const defaultId = settings.data?.providerConnectionId;
  const items = connections.data?.connections ?? [];
  const closeEditor = () => { setOpen(false); setEditing(undefined); };
  return (
    <>
      <PageHeader title={t('nav.providers')} />
      <PageContent width="narrow">
        <PageDescription title={t('nav.providers')} description={t('providers.description')}
          actions={<Button size="sm" onClick={() => { setEditing(undefined); setOpen(true); }}><Plus />{t('providers.addConnection')}</Button>} />
        <Dialog open={open || editing !== undefined} onOpenChange={(next) => { if (!next) closeEditor(); }}>
          <DialogContent
            title={editing ? t('providers.dialog.editTitle') : t('providers.dialog.title')}
            description={editing ? t('providers.dialog.editDescription') : t('providers.dialog.description')}>
            <ConnectionForm key={editing?.id ?? 'create'} catalog={catalog.data} existing={editing} onDone={() => { closeEditor(); invalidate(); }} />
          </DialogContent>
        </Dialog>
        {setDefault.error ? <ErrorState error={setDefault.error} /> : remove.error ? <ErrorState error={remove.error} /> : null}

        <SettingsGroup title={t('providers.connections.title')} description={t('providers.connections.configured', { count: items.length })}>
          {connections.isLoading ? <Loading rows={3} /> : connections.error ? <ErrorState error={connections.error} /> : !items.length ? <SettingsRow label={t('providers.connections.empty')} description={t('providers.connections.emptyHint')} /> : items.map((c) => (
            <CardRow key={c.id} className="group">
              <StatusIcon status={c.enabled && c.credentialPresent ? 'succeeded' : 'paused'} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-[13px] text-fg">{c.name}{c.id === defaultId ? <Pill color="var(--accent)">{t('providers.connections.default')}</Pill> : null}{c.source === 'deployment-env' ? <Pill>{t('providers.connections.env')}</Pill> : null}</div>
                <div className="mt-0.5 truncate text-[12px] text-muted">{c.providerName !== undefined ? `${c.providerName} · ` : ''}<Mono>{c.modelId}</Mono> · {c.adapterKind} · {c.baseUrl}</div>
              </div>
              <span className="text-[12px] text-faint">{relativeTime(c.updatedAt)}</span>
              <span className="flex w-[4.5rem] justify-end gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                {c.source === 'user' ? <Button size="icon-sm" variant="ghost" title={t('providers.connections.edit')} onClick={() => { setEditing(c); setOpen(true); }}><Pencil /></Button> : null}
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
            <Select className="w-full" aria-label={t('providers.runAgent.defaultConnection')} value={defaultId ?? ''} onChange={(e) => setDefault.mutate(e.target.value)} disabled={!settings.data}>
              {settings.data?.unset ? <option value="">{t('providers.runAgent.unset')}</option> : null}
              {settings.data?.providers.map((p) => <option key={p.id} value={p.id} disabled={!p.available}>{p.name}</option>)}
            </Select>
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

function ConnectionForm({ catalog, existing, onDone }: { catalog: CatalogStatus | undefined; existing?: ProviderConnection | undefined; onDone: () => void }) {
  const t = useT();
  const editing = existing !== undefined;
  const [mode, setMode] = useState<'catalog' | 'manual'>(editing ? 'manual' : 'catalog');
  const [form, setForm] = useState<ProviderConnectionWrite>(() => existing === undefined ? MANUAL_DEFAULTS : {
    name: existing.name,
    adapterKind: existing.adapterKind,
    baseUrl: existing.baseUrl,
    modelId: existing.modelId,
    ...(existing.providerName === undefined ? {} : { providerName: existing.providerName }),
    ...(existing.modelName === undefined ? {} : { modelName: existing.modelName })
  });
  const [provider, setProvider] = useState<CatalogProviderItem | undefined>();
  const [model, setModel] = useState<CatalogModelItem | undefined>();
  const [providerQuery, setProviderQuery] = useState('');
  const [modelQuery, setModelQuery] = useState('');
  const [touched, setTouched] = useState({ name: editing, baseUrl: editing });
  const [probe, setProbe] = useState<ProviderConnectionCheckResult | undefined>();
  const save = useMutation({
    mutationFn: (body: ProviderConnectionWrite) => editing
      ? api.providers.update(existing.id, body)
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
  const modelSearch = useDebounced(modelQuery.trim());
  const providerList = useQuery({
    queryKey: ['providers', 'catalog', 'providers', providerSearch],
    queryFn: () => api.providers.catalogProviders({ limit: 60, ...(providerSearch === '' ? {} : { q: providerSearch }) }),
    enabled: mode === 'catalog'
  });
  const modelList = useQuery({
    queryKey: ['providers', 'catalog', 'models', provider?.providerId ?? '', modelSearch],
    queryFn: () => api.providers.catalogModels({ providerId: provider!.providerId, status: 'all', limit: 60, ...(modelSearch === '' ? {} : { q: modelSearch }) }),
    enabled: mode === 'catalog' && provider !== undefined
  });

  const providerItems = providerList.data?.items ?? [];
  const modelItems = modelList.data?.items ?? [];
  const availabilityKey = catalog?.availability === undefined ? undefined : statusLabelKey(catalog.availability);
  const availabilityLabel = catalog?.availability === undefined ? '' : availabilityKey === undefined ? catalog.availability : t(availabilityKey);
  const auto = catalogBaseUrl(provider, model);
  const baseUrlValid = isUsableBaseUrl(form.baseUrl);
  const catalogReady = catalog === undefined || catalog.availability === 'available';

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
    const base = catalogBaseUrl(next, undefined);
    setProvider(next);
    setModel(undefined);
    setModelQuery('');
    resetProbe();
    setForm((f) => normalized({
      ...f, providerName: next.name, modelId: '', modelName: undefined,
      adapterKind: adapterFromNpm(next.npm),
      ...(base === undefined || touched.baseUrl ? {} : { baseUrl: base.url }),
      ...(touched.name ? {} : { name: next.name })
    }));
  };

  const pickModel = (option: ComboboxOption) => {
    const next = modelItems.find((item) => item.modelId === option.value);
    resetProbe();
    const base = provider === undefined ? undefined : catalogBaseUrl(provider, next);
    setModel(next);
    setForm((f) => normalized({
      ...f, modelId: option.value, modelName: next?.name,
      ...(base === undefined || touched.baseUrl ? {} : { baseUrl: base.url }),
      ...(provider === undefined || touched.name || next === undefined ? {} : { name: connectionName(provider, next) ?? f.name })
    }));
  };

  const providerOptions: ComboboxOption[] = providerItems.map((item) => ({
    value: item.providerId,
    label: item.name,
    hint: item.providerId,
    ...(item.api === undefined && KNOWN_BASE_URLS[item.providerId] === undefined ? { meta: <Pill>{t('providers.create.noEndpoint')}</Pill> } : {})
  }));
  const trimmedModelQuery = modelQuery.trim();
  const modelOptions: ComboboxOption[] = [
    ...(trimmedModelQuery !== '' && !modelItems.some((item) => item.modelId === trimmedModelQuery)
      ? [{ value: trimmedModelQuery, label: t('providers.create.useCustom', { model: trimmedModelQuery }), hint: t('providers.create.customModelId') }]
      : []),
    ...modelItems.map((item) => ({
      value: item.modelId,
      label: item.name,
      ...(item.modelId === item.name ? {} : { hint: item.modelId }),
      ...(item.status === 'active' ? {} : { meta: <Pill>{item.status}</Pill> })
    }))
  ];
  const baseUrlHint = [
    auto !== undefined ? `${t(`providers.baseUrlSource.${auto.source}`)}: ${auto.url}` : provider !== undefined ? t('providers.create.noCatalogEndpoint') : t('providers.create.publicHttpsHint'),
    form.adapterKind === 'anthropic' ? t('providers.create.anthropicHint') : undefined
  ].filter((part): part is string => part !== undefined).join(' · ');

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const body = normalized(form);
    if (editing && (body.apiKey === undefined || body.apiKey.trim() === '')) {
      const { apiKey: _omit, ...rest } = body;
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
        <>
          <Field label={t('providers.create.provider')} hint={catalog?.providerCount !== undefined ? t('providers.create.providerCount', { count: catalog.providerCount }) : undefined}>
            <Combobox value={provider?.providerId} display={provider?.name ?? form.providerName ?? ''} query={providerQuery} onQueryChange={setProviderQuery} onSelect={pickProvider}
              options={providerOptions} placeholder={t('providers.create.searchProviders')} loading={providerList.isLoading} error={errorText(providerList.error)} empty={t('providers.create.noProvidersMatch')}
              footer={providerList.data === undefined ? undefined : `${t('providers.create.shown', { count: providerItems.length })}${providerList.data.nextCursor !== undefined ? ` · ${t('providers.create.typeToNarrow')}` : ''}`} />
          </Field>
          <Field label={t('providers.create.model')} hint={form.modelId.trim() === '' ? t('providers.create.modelHint') : t('providers.create.modelSelected', { model: form.modelId })}>
            <Combobox value={model?.modelId ?? form.modelId} display={model?.name ?? form.modelName ?? form.modelId} query={modelQuery} onQueryChange={setModelQuery} onSelect={pickModel}
              options={modelOptions} placeholder={provider === undefined && form.providerName === undefined ? t('providers.create.pickProviderFirst') : t('providers.create.searchModels')} disabled={provider === undefined && !editing}
              loading={modelList.isLoading} error={errorText(modelList.error)} empty={modelList.data === undefined && provider === undefined ? t('providers.create.pickProviderFirst') : t('providers.create.noModelsMatch')}
              footer={modelList.data?.nextCursor !== undefined ? t('providers.create.showingFirst60') : undefined} />
          </Field>
        </>
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
      <Field label={t('providers.create.adapter')}><Select value={form.adapterKind} onChange={set('adapterKind')}><option value="openai-compatible">openai-compatible</option><option value="anthropic">anthropic</option></Select></Field>
      <Field label={t('providers.create.modelId')} hint={mode === 'catalog' ? t('providers.create.modelIdHint') : undefined}>
        <Input required value={form.modelId} onChange={(event) => { set('modelId')(event); setModel(undefined); }} placeholder="gpt-4o-mini" />
      </Field>
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
