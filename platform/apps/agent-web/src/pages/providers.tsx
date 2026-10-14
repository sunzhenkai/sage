import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Plus, Trash2 } from 'lucide-react';
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
import { StatusIcon } from '@/components/ui/status';
import { ChartCard, Legend, StackedBars, useChartTheme } from '@/components/charts';
import { api } from '@/lib/api';
import { isMock, mockSeries } from '@/lib/mock';
import { adapterFromNpm, baseUrlSourceLabel, catalogBaseUrl, connectionName, isUsableBaseUrl, KNOWN_BASE_URLS } from '@/lib/provider-autofill';
import type { CatalogModelItem, CatalogProviderItem, CatalogStatus, ProviderConnectionCheckResult, ProviderConnectionWrite } from '@/lib/types';
import { cn, formatTime, relativeTime } from '@/lib/utils';

export function ProvidersPage() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const connections = useQuery({ queryKey: ['providers', 'connections'], queryFn: api.providers.list });
  const settings = useQuery({ queryKey: ['providers', 'settings'], queryFn: api.providers.settings });
  const catalog = useQuery({ queryKey: ['providers', 'catalog'], queryFn: api.providers.catalogStatus });
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['providers'] });
  const setDefault = useMutation({ mutationFn: api.providers.updateSettings, onSuccess: invalidate });
  const remove = useMutation({ mutationFn: api.providers.remove, onSuccess: invalidate });
  const defaultId = settings.data?.providerConnectionId;
  const items = connections.data?.connections ?? [];
  return (
    <>
      <PageHeader title="Providers" />
      <PageContent width="narrow">
        <PageDescription title="Providers" description="Model provider connections used by the run agent. Pick from the models.dev catalog or enter a custom endpoint; API keys are sealed server-side and never returned."
          actions={<Dialog open={open} onOpenChange={setOpen}>
            <Button size="sm" onClick={() => setOpen(true)}><Plus />Add connection</Button>
            <DialogContent title="Add provider connection" description="Auto-filled from the models.dev snapshot — base URL and model stay editable. The API key is sealed server-side and never returned."><CreateConnection catalog={catalog.data} onDone={() => { setOpen(false); invalidate(); }} /></DialogContent>
          </Dialog>} />
        {setDefault.error ? <ErrorState error={setDefault.error} /> : remove.error ? <ErrorState error={remove.error} /> : null}

        <SettingsGroup title="Connections" description={`${items.length} configured`}>
          {connections.isLoading ? <Loading rows={3} /> : connections.error ? <ErrorState error={connections.error} /> : !items.length ? <SettingsRow label="No connections" description="Add one to let the agent call a model." /> : items.map((c) => (
            <CardRow key={c.id} className="group">
              <StatusIcon status={c.enabled && c.credentialPresent ? 'succeeded' : 'paused'} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-[13px] text-fg">{c.name}{c.id === defaultId ? <Pill color="var(--accent)">Default</Pill> : null}{c.source === 'deployment-env' ? <Pill>env</Pill> : null}</div>
                <div className="mt-0.5 truncate text-[12px] text-muted">{c.providerName !== undefined ? `${c.providerName} · ` : ''}<Mono>{c.modelId}</Mono> · {c.adapterKind} · {c.baseUrl}</div>
              </div>
              <span className="text-[12px] text-faint">{relativeTime(c.updatedAt)}</span>
              <span className="flex w-14 justify-end gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                {c.id !== defaultId ? <Button size="icon-sm" variant="ghost" title="Make default" disabled={setDefault.isPending} onClick={() => setDefault.mutate(c.id)}><Check /></Button> : null}
                {c.source === 'user' ? <Button size="icon-sm" variant="ghost" title="Delete" onClick={() => { if (confirm(`Delete ${c.name}?`)) remove.mutate(c.id); }}><Trash2 /></Button> : null}
              </span>
            </CardRow>
          ))}
        </SettingsGroup>

        <Section title="Usage" description={isMock() ? 'Requests and errors per provider connection · last 14 days (mock).' : 'Per-provider request metrics are not exposed by agent-api yet.'}>
          {isMock() && items.length ? <ProviderUsage names={items.map((c) => c.name)} /> : <Quiet>No usage metrics available.</Quiet>}
        </Section>

        <SettingsGroup title="Run agent" description="Default connection used when a chat message does not choose one.">
          <SettingsRow label="Default connection" description={settings.data?.updatedBy ? `Updated ${formatTime(settings.data.updatedAt)} by ${settings.data.updatedBy}` : undefined}>
            <Select className="w-full" value={defaultId ?? ''} onChange={(e) => setDefault.mutate(e.target.value)} disabled={!settings.data}>
              {settings.data?.unset ? <option value="">Unset</option> : null}
              {settings.data?.providers.map((p) => <option key={p.id} value={p.id} disabled={!p.available}>{p.name}</option>)}
            </Select>
          </SettingsRow>
        </SettingsGroup>

        <SettingsGroup title="Model catalog" description="models.dev snapshot used for provider and model metadata.">
          <SettingsRow label="Availability">{catalog.data ? <StatusBadge status={catalog.data.availability} /> : null}</SettingsRow>
          <SettingsRow label="Providers / models"><span className="tabular text-[13px] text-fg-2">{catalog.data?.providerCount ?? '—'} / {catalog.data?.modelCount ?? '—'}</span></SettingsRow>
          <SettingsRow label="Last sync"><span className="text-[12.5px] text-muted">{formatTime(catalog.data?.lastSuccessAt)}</span></SettingsRow>
          <SettingsRow label="Next sync"><span className="text-[12.5px] text-muted">{formatTime(catalog.data?.nextSyncAt)}</span></SettingsRow>
        </SettingsGroup>
      </PageContent>
    </>
  );
}

const MANUAL_DEFAULTS: ProviderConnectionWrite = { name: '', adapterKind: 'openai-compatible', baseUrl: 'https://api.openai.com/v1', modelId: '', apiKey: '' };

const errorText = (error: unknown): string | undefined =>
  error === null || error === undefined ? undefined : error instanceof Error ? error.message : String(error);

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

function CreateConnection({ catalog, onDone }: { catalog: CatalogStatus | undefined; onDone: () => void }) {
  const [mode, setMode] = useState<'catalog' | 'manual'>('catalog');
  const [form, setForm] = useState<ProviderConnectionWrite>(MANUAL_DEFAULTS);
  const [provider, setProvider] = useState<CatalogProviderItem | undefined>();
  const [model, setModel] = useState<CatalogModelItem | undefined>();
  const [providerQuery, setProviderQuery] = useState('');
  const [modelQuery, setModelQuery] = useState('');
  const [touched, setTouched] = useState({ name: false, baseUrl: false });
  const [probe, setProbe] = useState<ProviderConnectionCheckResult | undefined>();
  const create = useMutation({ mutationFn: api.providers.create, onSuccess: onDone });
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
  const auto = catalogBaseUrl(provider, model);
  const baseUrlValid = isUsableBaseUrl(form.baseUrl);
  const catalogReady = catalog === undefined || catalog.availability === 'available';

  const resetProbe = () => setProbe(undefined);
  const set = (key: keyof ProviderConnectionWrite) => (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const value = event.target.value;
    setForm((f) => ({ ...f, [key]: value }));
    if (key === 'name') setTouched((t) => ({ ...t, name: true }));
    if (key === 'baseUrl') setTouched((t) => ({ ...t, baseUrl: true }));
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
    if (provider === undefined) return;
    const next = modelItems.find((item) => item.modelId === option.value);
    resetProbe();
    const base = catalogBaseUrl(provider, next);
    setModel(next);
    setForm((f) => normalized({
      ...f, modelId: option.value, modelName: next?.name,
      ...(base === undefined || touched.baseUrl ? {} : { baseUrl: base.url }),
      ...(touched.name || next === undefined ? {} : { name: connectionName(provider, next) ?? f.name })
    }));
  };

  const providerOptions: ComboboxOption[] = providerItems.map((item) => ({
    value: item.providerId,
    label: item.name,
    hint: item.providerId,
    ...(item.api === undefined && KNOWN_BASE_URLS[item.providerId] === undefined ? { meta: <Pill>no endpoint</Pill> } : {})
  }));
  const trimmedModelQuery = modelQuery.trim();
  const modelOptions: ComboboxOption[] = [
    ...(trimmedModelQuery !== '' && !modelItems.some((item) => item.modelId === trimmedModelQuery)
      ? [{ value: trimmedModelQuery, label: `Use “${trimmedModelQuery}”`, hint: 'custom model id' }]
      : []),
    ...modelItems.map((item) => ({
      value: item.modelId,
      label: item.name,
      ...(item.modelId === item.name ? {} : { hint: item.modelId }),
      ...(item.status === 'active' ? {} : { meta: <Pill>{item.status}</Pill> })
    }))
  ];
  const baseUrlHint = [
    auto !== undefined ? `${baseUrlSourceLabel[auto.source]}: ${auto.url}` : provider !== undefined ? 'models.dev has no endpoint for this provider — enter one (proxy or gateway is fine)' : 'Public HTTPS endpoint — override it for a proxy or gateway',
    form.adapterKind === 'anthropic' ? 'Anthropic calls normalize a trailing /v1' : undefined
  ].filter((part): part is string => part !== undefined).join(' · ');

  return (
    <form className="flex flex-col gap-3" onSubmit={(event) => { event.preventDefault(); create.mutate(form); }}>
      <SegmentedTabs value={mode} onChange={setMode} items={[{ value: 'catalog', label: 'From models.dev' }, { value: 'manual', label: 'Manual' }]} />
      {!catalogReady ? <p className="text-[12px] leading-[18px] text-amber">Catalog snapshot is {catalog?.availability} (last sync {formatTime(catalog?.lastSuccessAt)}) — provider search may come up empty. Manual mode always works.</p> : null}
      {mode === 'catalog' ? (
        <>
          <Field label="Provider" hint={catalog?.providerCount !== undefined ? `${catalog.providerCount} providers in the models.dev snapshot` : undefined}>
            <Combobox value={provider?.providerId} display={provider?.name ?? ''} query={providerQuery} onQueryChange={setProviderQuery} onSelect={pickProvider}
              options={providerOptions} placeholder="Search providers…" loading={providerList.isLoading} error={errorText(providerList.error)} empty="No providers match"
              footer={providerList.data === undefined ? undefined : `${providerItems.length} shown${providerList.data.nextCursor !== undefined ? ' · type to narrow' : ''}`} />
          </Field>
          <Field label="Model" hint={model === undefined ? 'Pick a model from the snapshot, or type a model id and choose “Use …”.' : `Selected: ${model.modelId}`}>
            <Combobox value={model?.modelId ?? ''} display={model?.name ?? form.modelId} query={modelQuery} onQueryChange={setModelQuery} onSelect={pickModel}
              options={modelOptions} placeholder={provider === undefined ? 'Pick a provider first' : 'Search models…'} disabled={provider === undefined}
              loading={modelList.isLoading} error={errorText(modelList.error)} empty={modelList.data === undefined ? 'Pick a provider first' : 'No models match'}
              footer={modelList.data?.nextCursor !== undefined ? 'Showing the first 60 — type to narrow' : undefined} />
          </Field>
        </>
      ) : null}
      <Field label="Base URL" hint={baseUrlHint}>
        <div className="flex w-full flex-col gap-1.5">
          <Input required value={form.baseUrl} onChange={set('baseUrl')} placeholder="https://api.example.com/v1" />
          <div className="flex items-center gap-3">
            {!baseUrlValid && form.baseUrl !== '' ? <span className="text-[12px] text-red">Must be a public HTTPS URL.</span> : null}
            {auto !== undefined && form.baseUrl !== auto.url ? <button type="button" className="text-[12px] text-accent hover:underline" onClick={() => { setForm((f) => ({ ...f, baseUrl: auto.url })); resetProbe(); }}>Use catalog default</button> : null}
          </div>
        </div>
      </Field>
      <Field label="Adapter"><Select value={form.adapterKind} onChange={set('adapterKind')}><option value="openai-compatible">openai-compatible</option><option value="anthropic">anthropic</option></Select></Field>
      {mode === 'manual' ? <Field label="Model ID"><Input required value={form.modelId} onChange={set('modelId')} /></Field> : null}
      <Field label="Name"><Input required value={form.name} onChange={set('name')} placeholder="Shown in the connection list" /></Field>
      <Field label="API key"><Input required type="password" autoComplete="off" value={form.apiKey ?? ''} onChange={set('apiKey')} /></Field>
      <div className="flex items-center gap-2">
        <Button type="button" variant="secondary" size="sm" disabled={check.isPending || !baseUrlValid || form.modelId.trim() === ''} onClick={() => check.mutate()}>{check.isPending ? 'Testing…' : 'Test connection'}</Button>
        {probe !== undefined ? <span className={cn('text-[12.5px]', probe.status === 'connected' ? 'text-green' : probe.status === 'unauthorized' ? 'text-red' : 'text-amber')}>{probe.message}</span> : null}
        {check.error ? <span className="text-[12.5px] text-red">{errorText(check.error)}</span> : null}
      </div>
      {create.error ? <ErrorState error={create.error} /> : null}
      <div className="flex justify-end"><Button type="submit" disabled={create.isPending || !baseUrlValid || form.name.trim() === '' || form.modelId.trim() === ''}>Create</Button></div>
    </form>
  );
}

function ProviderUsage({ names }: { names: string[] }) {
  const ct = useChartTheme();
  const series = [{ key: 'requests', label: 'Requests', color: ct.series[0]! }, { key: 'errors', label: 'Errors', color: ct.status.failed! }];
  const data = names.map((name) => { const req = mockSeries(name, 14, 40).reduce((a, b) => a + b, 0); return { label: name, requests: req, errors: Math.round(req * (0.01 + (mockSeries(`${name}-e`, 1, 5)[0]! / 100))) }; });
  return (
    <ChartCard title="Requests by provider" description={`${data.reduce((a, b) => a + b.requests, 0)} requests · ${data.reduce((a, b) => a + b.errors, 0)} errors`} actions={<Legend series={series} />}>
      <StackedBars data={data} series={series} height={170} />
    </ChartCard>
  );
}
