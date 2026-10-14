import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { PageHeader } from '@/components/layout/app-shell';
import { PageContent, PageDescription, SettingsGroup, SettingsRow } from '@/components/layout/page';
import { StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Field, Input, Select } from '@/components/ui/input';
import { Pill } from '@/components/ui/list';
import { ErrorState, Loading, Mono } from '@/components/ui/misc';
import { StatusIcon } from '@/components/ui/status';
import { api } from '@/lib/api';
import type { ProviderConnectionWrite } from '@/lib/types';
import { formatTime, relativeTime } from '@/lib/utils';

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
        <PageDescription title="Providers" description="Model provider connections used by the run agent. API keys are sealed server-side and never returned."
          actions={<Dialog open={open} onOpenChange={setOpen}>
            <Button size="sm" onClick={() => setOpen(true)}><Plus />Add connection</Button>
            <DialogContent title="Add provider connection" description="The API key is sealed server-side and never returned."><CreateConnection onDone={() => { setOpen(false); invalidate(); }} /></DialogContent>
          </Dialog>} />
        {setDefault.error ? <ErrorState error={setDefault.error} /> : remove.error ? <ErrorState error={remove.error} /> : null}

        <SettingsGroup title="Connections" description={`${items.length} configured`}>
          {connections.isLoading ? <Loading rows={3} /> : connections.error ? <ErrorState error={connections.error} /> : !items.length ? <SettingsRow label="No connections" description="Add one to let the agent call a model." /> : items.map((c) => (
            <div key={c.id} className="group flex items-center gap-3 py-3">
              <StatusIcon status={c.enabled && c.credentialPresent ? 'succeeded' : 'paused'} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-[13px] text-fg">{c.name}{c.id === defaultId ? <Pill color="var(--accent)">Default</Pill> : null}{c.source === 'deployment-env' ? <Pill>env</Pill> : null}</div>
                <div className="mt-0.5 truncate text-[12px] text-muted"><Mono>{c.modelId}</Mono> · {c.adapterKind} · {c.baseUrl}</div>
              </div>
              <span className="text-[12px] text-faint">{relativeTime(c.updatedAt)}</span>
              <span className="flex w-14 justify-end gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                {c.id !== defaultId ? <Button size="icon-sm" variant="ghost" title="Make default" disabled={setDefault.isPending} onClick={() => setDefault.mutate(c.id)}><Check /></Button> : null}
                {c.source === 'user' ? <Button size="icon-sm" variant="ghost" title="Delete" onClick={() => { if (confirm(`Delete ${c.name}?`)) remove.mutate(c.id); }}><Trash2 /></Button> : null}
              </span>
            </div>
          ))}
        </SettingsGroup>

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

function CreateConnection({ onDone }: { onDone: () => void }) {
  const [form, setForm] = useState<ProviderConnectionWrite>({ name: '', adapterKind: 'openai-compatible', baseUrl: 'https://api.openai.com/v1', modelId: '', apiKey: '' });
  const create = useMutation({ mutationFn: api.providers.create, onSuccess: onDone });
  const set = (key: keyof ProviderConnectionWrite) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm((f) => ({ ...f, [key]: e.target.value }));
  return (
    <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); create.mutate(form); }}>
      <Field label="Name"><Input required value={form.name} onChange={set('name')} /></Field>
      <Field label="Adapter"><Select value={form.adapterKind} onChange={set('adapterKind')}><option value="openai-compatible">openai-compatible</option><option value="anthropic">anthropic</option></Select></Field>
      <Field label="Base URL"><Input required value={form.baseUrl} onChange={set('baseUrl')} /></Field>
      <Field label="Model ID"><Input required value={form.modelId} onChange={set('modelId')} /></Field>
      <Field label="API key"><Input required type="password" autoComplete="off" value={form.apiKey ?? ''} onChange={set('apiKey')} /></Field>
      {create.error ? <ErrorState error={create.error} /> : null}
      <div className="flex justify-end"><Button type="submit" disabled={create.isPending}>Create</Button></div>
    </form>
  );
}
