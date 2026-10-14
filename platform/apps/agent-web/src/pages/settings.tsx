import { useQuery } from '@tanstack/react-query';
import { Monitor, Moon, Sun } from 'lucide-react';
import { useState } from 'react';
import { PageHeader } from '@/components/layout/app-shell';
import { PageContent, PageDescription, SettingsGroup, SettingsRow } from '@/components/layout/page';
import { StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { JsonView, Kbd } from '@/components/ui/misc';
import { api } from '@/lib/api';
import { exitMock, isMock } from '@/lib/mock';
import { type Theme, updateSettings, useSettings } from '@/lib/settings';
import { cn } from '@/lib/utils';

export function SettingsPage() {
  const settings = useSettings();
  const [draft, setDraft] = useState({ apiBaseUrl: settings.apiBaseUrl, serviceToken: settings.serviceToken, tenantId: settings.tenantId });
  const [saved, setSaved] = useState(false);
  const ready = useQuery({ queryKey: ['readyz', settings.apiBaseUrl], queryFn: api.ready, retry: false });
  const live = useQuery({ queryKey: ['livez', settings.apiBaseUrl], queryFn: api.health, retry: false });
  const dirty = draft.apiBaseUrl !== settings.apiBaseUrl || draft.serviceToken !== settings.serviceToken || draft.tenantId !== settings.tenantId;
  const themes: [Theme, string, typeof Sun][] = [['light', 'Light', Sun], ['dark', 'Dark', Moon], ['system', 'System', Monitor]];
  const save = () => { updateSettings(draft); setSaved(true); setTimeout(() => setSaved(false), 1500); };
  return (
    <>
      <PageHeader title="Settings" />
      <PageContent>
        <PageDescription title="Settings" description="Connection, appearance and shortcuts for this browser. Stored in localStorage only." />

        <SettingsGroup title="Connection" description="How the console reaches agent-api.">
          <SettingsRow label="API base URL" description="Empty = same origin; the dev/preview server proxies /v1 to agent-api (:9610).">
            <Input className="w-[260px]" placeholder="Same origin" value={draft.apiBaseUrl} onChange={(e) => setDraft({ ...draft, apiBaseUrl: e.target.value })} />
          </SettingsRow>
          <SettingsRow label="Service token" description="Sent as Authorization: Bearer. Required for schedules.">
            <Input className="w-[260px]" type="password" autoComplete="off" placeholder="Not set" value={draft.serviceToken} onChange={(e) => setDraft({ ...draft, serviceToken: e.target.value })} />
          </SettingsRow>
          <SettingsRow label="Tenant ID" description="Must equal agent-api SAGE_TENANT_ID; used in schedule definitions.">
            <Input className="w-[260px]" value={draft.tenantId} onChange={(e) => setDraft({ ...draft, tenantId: e.target.value })} />
          </SettingsRow>
          <div className="flex items-center justify-end gap-2 py-3">
            {saved ? <span className="text-[12px] text-muted">Saved</span> : null}
            <Button size="sm" disabled={!dirty} onClick={save}>Save changes</Button>
          </div>
        </SettingsGroup>

        <SettingsGroup title="Appearance">
          <SettingsRow label="Theme" description="System follows your OS preference.">
            <div className="flex rounded-md border border-line-strong p-0.5">
              {themes.map(([value, label, Icon]) => (
                <button key={value} type="button" onClick={() => updateSettings({ theme: value })} className={cn('flex h-6 items-center gap-1.5 rounded-[5px] px-2 text-[12px] text-muted transition-colors hover:text-fg', settings.theme === value && 'bg-active text-fg')}>
                  <Icon className="size-3.5" strokeWidth={1.75} />{label}
                </button>
              ))}
            </div>
          </SettingsRow>
        </SettingsGroup>

        <SettingsGroup title="Health">
          <SettingsRow label="Liveness" description="GET /livez">{live.error ? <span className="text-[12.5px] text-red">Unreachable</span> : <StatusBadge status={live.data?.status} />}</SettingsRow>
          <SettingsRow label="Readiness" description="GET /readyz" stacked>{ready.error ? <span className="text-[12.5px] text-red">{ready.error.message}</span> : <JsonView value={ready.data ?? null} className="w-full" />}</SettingsRow>
        </SettingsGroup>

        <SettingsGroup title="Developer">
          <SettingsRow label="Mock data" description="Read-only demo dataset for screenshots and UI work. Toggle with ?mock=1 / ?mock=0.">
            {isMock() ? <Button size="sm" variant="secondary" onClick={exitMock}>Exit mock mode</Button> : <Button size="sm" variant="secondary" onClick={() => { window.location.search = '?mock=1'; }}>Enable</Button>}
          </SettingsRow>
        </SettingsGroup>

        <SettingsGroup title="Keyboard shortcuts">
          {[['⌘ K', 'Command menu'], ['G O', 'Overview'], ['G C', 'Chat'], ['G T', 'Tasks'], ['G S', 'Schedules'], ['G A', 'Apps'], ['G P', 'Packages'], ['G M', 'Providers'], ['G ,', 'Settings'], ['↵', 'Send message']].map(([keys = '', label]) => (
            <SettingsRow key={keys} label={label}><span className="flex gap-1">{keys.split(' ').map((k) => <Kbd key={k}>{k}</Kbd>)}</span></SettingsRow>
          ))}
        </SettingsGroup>
      </PageContent>
    </>
  );
}
