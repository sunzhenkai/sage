import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { PageHeader } from '@/components/layout/app-shell';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Field, Input, Select } from '@/components/ui/input';
import { Card, CardHeader, Empty, ErrorState, KeyValue, Loading, Mono } from '@/components/ui/misc';
import { Table, Td, Th, Tr } from '@/components/ui/table';
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
  return (
    <>
      <PageHeader title="Providers" actions={<Dialog open={open} onOpenChange={setOpen}>
        <Button size="sm" onClick={() => setOpen(true)}><Plus />New connection</Button>
        <DialogContent title="New provider connection" description="The API key is sealed server-side and never returned."><CreateConnection onDone={() => { setOpen(false); invalidate(); }} /></DialogContent>
      </Dialog>} />
      <div className="min-h-0 flex-1 overflow-auto p-4">
        <div className="flex flex-col gap-4">
          {setDefault.error ? <ErrorState error={setDefault.error} /> : remove.error ? <ErrorState error={remove.error} /> : null}
          <Card><CardHeader title="Connections" />
            {connections.isLoading ? <Loading /> : connections.error ? <ErrorState error={connections.error} /> : !connections.data?.connections.length ? <Empty title="No provider connections" /> : (
              <Table><thead><tr><Th>Name</Th><Th>Adapter</Th><Th>Model</Th><Th>Base URL</Th><Th>Credential</Th><Th>Updated</Th><Th /></tr></thead>
                <tbody>{connections.data.connections.map((c) => (
                  <Tr key={c.id}>
                    <Td><div className="flex items-center gap-2 font-medium">{c.name}{c.id === defaultId ? <Badge tone="accent">default</Badge> : null}{c.source === 'deployment-env' ? <Badge>env</Badge> : null}{!c.enabled ? <Badge tone="warning">disabled</Badge> : null}</div></Td>
                    <Td className="text-muted">{c.adapterKind}</Td><Td><Mono>{c.modelId}</Mono></Td><Td className="max-w-56 truncate text-muted">{c.baseUrl}</Td>
                    <Td>{c.credentialPresent ? <Badge tone="success">present</Badge> : <Badge tone="danger">missing</Badge>}</Td>
                    <Td className="text-muted">{relativeTime(c.updatedAt)}</Td>
                    <Td className="text-right whitespace-nowrap">
                      <Button size="sm" variant="ghost" disabled={c.id === defaultId || setDefault.isPending} onClick={() => setDefault.mutate(c.id)}><Check />Default</Button>
                      {c.source === 'user' ? <Button size="sm" variant="ghost" onClick={() => { if (confirm(`Delete ${c.name}?`)) remove.mutate(c.id); }}><Trash2 /></Button> : null}
                    </Td>
                  </Tr>
                ))}</tbody></Table>
            )}
          </Card>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card><CardHeader title="Run agent settings" /><div className="p-3">
              {settings.isLoading ? <Loading /> : settings.error ? <ErrorState error={settings.error} /> : settings.data ? <KeyValue items={[
                ['Default connection', settings.data.unset ? 'unset' : <Mono key="d">{settings.data.providerConnectionId}</Mono>],
                ['Updated', formatTime(settings.data.updatedAt)], ['Updated by', settings.data.updatedBy],
                ['Providers', <span key="p" className="flex flex-wrap gap-1">{settings.data.providers.map((p) => <Badge key={p.id} tone={p.available ? 'success' : 'danger'}>{p.name}</Badge>)}</span>]
              ]} /> : null}
            </div></Card>
            <Card><CardHeader title="Provider catalog (models.dev)" /><div className="p-3">
              {catalog.isLoading ? <Loading /> : catalog.error ? <ErrorState error={catalog.error} /> : catalog.data ? <KeyValue items={[
                ['Availability', <StatusBadge key="a" status={catalog.data.availability} />], ['Projection', catalog.data.projection], ['Providers', catalog.data.providerCount], ['Models', catalog.data.modelCount],
                ['Last success', formatTime(catalog.data.lastSuccessAt)], ['Next sync', formatTime(catalog.data.nextSyncAt)]
              ]} /> : null}
            </div></Card>
          </div>
        </div>
      </div>
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
