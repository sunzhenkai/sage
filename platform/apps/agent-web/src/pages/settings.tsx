import { useQuery } from '@tanstack/react-query';
import { Monitor, Moon, Sun } from 'lucide-react';
import { useState } from 'react';
import { PageHeader } from '@/components/layout/app-shell';
import { StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { Card, CardHeader, ErrorState, JsonView, Kbd } from '@/components/ui/misc';
import { api } from '@/lib/api';
import { type Theme, updateSettings, useSettings } from '@/lib/settings';
import { cn } from '@/lib/utils';

export function SettingsPage() {
  const settings = useSettings();
  const [draft, setDraft] = useState({ apiBaseUrl: settings.apiBaseUrl, serviceToken: settings.serviceToken, tenantId: settings.tenantId });
  const [saved, setSaved] = useState(false);
  const ready = useQuery({ queryKey: ['readyz', settings.apiBaseUrl], queryFn: api.ready, retry: false });
  const live = useQuery({ queryKey: ['livez', settings.apiBaseUrl], queryFn: api.health, retry: false });
  const themes: [Theme, string, typeof Sun][] = [['light', 'Light', Sun], ['dark', 'Dark', Moon], ['system', 'System', Monitor]];
  return (
    <>
      <PageHeader title="Settings" />
      <div className="min-h-0 flex-1 overflow-auto p-4">
        <div className="mx-auto flex max-w-2xl flex-col gap-4">
          <Card><CardHeader title="Connection" />
            <form className="flex flex-col gap-3 p-4" onSubmit={(e) => { e.preventDefault(); updateSettings(draft); setSaved(true); setTimeout(() => setSaved(false), 1500); }}>
              <Field label="API base URL" hint="Leave empty to use the same origin (Vite dev/preview proxies /v1 → agent-api :9610). Otherwise e.g. http://192.168.6.3:9610 (agent-api must allow CORS).">
                <Input placeholder="(same origin)" value={draft.apiBaseUrl} onChange={(e) => setDraft({ ...draft, apiBaseUrl: e.target.value })} />
              </Field>
              <Field label="Service token" hint="Sent as Authorization: Bearer … ; required for /v1/schedules. Stored in this browser's localStorage only.">
                <Input type="password" autoComplete="off" value={draft.serviceToken} onChange={(e) => setDraft({ ...draft, serviceToken: e.target.value })} />
              </Field>
              <Field label="Tenant ID" hint="Used when building schedule definitions (must equal agent-api SAGE_TENANT_ID).">
                <Input value={draft.tenantId} onChange={(e) => setDraft({ ...draft, tenantId: e.target.value })} />
              </Field>
              <div className="flex items-center justify-end gap-2">{saved ? <span className="text-xs text-success">Saved</span> : null}<Button type="submit">Save</Button></div>
            </form>
          </Card>
          <Card><CardHeader title="Appearance" />
            <div className="flex gap-2 p-4">
              {themes.map(([value, label, Icon]) => (
                <button key={value} onClick={() => updateSettings({ theme: value })}
                  className={cn('flex h-16 flex-1 flex-col items-center justify-center gap-1 rounded-md border text-xs text-muted hover:bg-hover', settings.theme === value && 'border-accent text-fg ring-2 ring-accent/20')}>
                  <Icon className="size-4" />{label}
                </button>
              ))}
            </div>
          </Card>
          <Card><CardHeader title="Health" />
            <div className="flex flex-col gap-2 p-4 text-xs">
              <div className="flex items-center gap-2"><span className="w-16 text-muted">/livez</span>{live.error ? <ErrorState error={live.error} /> : <StatusBadge status={live.data?.status} />}</div>
              <div className="flex items-start gap-2"><span className="w-16 text-muted">/readyz</span>{ready.error ? <ErrorState error={ready.error} /> : <JsonView value={ready.data ?? null} className="flex-1" />}</div>
            </div>
          </Card>
          <Card><CardHeader title="Keyboard shortcuts" />
            <div className="grid grid-cols-2 gap-2 p-4 text-xs">
              {[['⌘/Ctrl K', 'Command palette'], ['G C', 'Chat'], ['G T', 'Tasks'], ['G A', 'Apps'], ['G P', 'Packages'], ['G S', 'Schedules'], ['G M', 'Providers'], ['G ,', 'Settings'], ['Enter', 'Send message']].map(([keys = '', label]) => (
                <div key={keys} className="flex items-center justify-between rounded border px-2 py-1.5"><span>{label}</span><span className="flex gap-0.5">{keys.split(' ').map((k) => <Kbd key={k}>{k}</Kbd>)}</span></div>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
