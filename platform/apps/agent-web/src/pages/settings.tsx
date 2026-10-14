import { useQuery } from '@tanstack/react-query';
import { Activity, Code2, Keyboard, Monitor, Moon, Palette, Plug, Sun } from 'lucide-react';
import { Navigate, NavLink, useParams } from 'react-router';
import { useState } from 'react';
import { PageHeader, ViewTab, ViewTabs } from '@/components/layout/app-shell';
import { CardRow, PageContent, PageDescription, SettingsGroup, SettingsRow } from '@/components/layout/page';
import { StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { JsonView, Kbd } from '@/components/ui/misc';
import { api } from '@/lib/api';
import { exitMock, isMock } from '@/lib/mock';
import { type Theme, updateSettings, useSettings } from '@/lib/settings';
import { cn } from '@/lib/utils';

const sections = [
  { id: 'general', label: 'General', icon: Plug, description: 'How the console reaches agent-api.' },
  { id: 'appearance', label: 'Appearance', icon: Palette, description: 'Theme for this browser.' },
  { id: 'status', label: 'Status', icon: Activity, description: 'Live probes against agent-api.' },
  { id: 'developer', label: 'Developer', icon: Code2, description: 'Tools for UI development.' },
  { id: 'shortcuts', label: 'Shortcuts', icon: Keyboard, description: 'Available anywhere in the console.' }
] as const;
type SectionId = (typeof sections)[number]['id'];

export function SettingsPage() {
  const { section = 'general' } = useParams();
  const current = sections.find((x) => x.id === section);
  const settings = useSettings();
  const [draft, setDraft] = useState({ apiBaseUrl: settings.apiBaseUrl, serviceToken: settings.serviceToken, tenantId: settings.tenantId });
  const [saved, setSaved] = useState(false);
  const ready = useQuery({ queryKey: ['readyz', settings.apiBaseUrl], queryFn: api.ready, retry: false });
  const live = useQuery({ queryKey: ['livez', settings.apiBaseUrl], queryFn: api.health, retry: false });
  const dirty = draft.apiBaseUrl !== settings.apiBaseUrl || draft.serviceToken !== settings.serviceToken || draft.tenantId !== settings.tenantId;
  const themes: [Theme, string, typeof Sun][] = [['light', 'Light', Sun], ['dark', 'Dark', Moon], ['system', 'System', Monitor]];
  const save = () => { updateSettings(draft); setSaved(true); setTimeout(() => setSaved(false), 1500); };
  if (!current) return <Navigate to="/settings/general" replace />;
  const show = (id: SectionId) => current.id === id;
  return (
    <>
      <PageHeader title="Settings" />
      <PageContent width="narrow">
        <div className="flex items-start gap-8">
        <nav aria-label="Settings sections" className="sticky top-0 flex w-[168px] shrink-0 flex-col gap-px">
          {sections.map(({ id, label, icon: Icon }) => (
            <NavLink key={id} to={`/settings/${id}`} className={({ isActive }) => cn('relative flex h-[30px] items-center gap-2 rounded-md px-2 text-[13px] font-medium text-muted transition-colors hover:bg-hover hover:text-fg', isActive && 'bg-accent-tint font-semibold text-accent-ink ring-1 ring-inset ring-accent/45 hover:bg-accent-tint hover:text-accent-ink before:absolute before:inset-y-[6px] before:left-0 before:w-[3px] before:rounded-full before:bg-accent')}>
              {({ isActive }) => <><Icon className={cn('size-[15px] shrink-0', isActive ? 'text-accent' : 'text-faint')} strokeWidth={isActive ? 2 : 1.6} />{label}</>}
            </NavLink>
          ))}
        </nav>
        <div className="min-w-0 flex-1">
        <PageDescription title={current.label} description={`${current.description} Stored in localStorage only.`} />

        {show('general') ? (
        <SettingsGroup title="Connection" description="How the console reaches agent-api.">
          <SettingsRow label="API base URL" description="Empty = same origin; the dev/preview server proxies /v1 to agent-api (:9610).">
            <Input className="w-full" placeholder="Same origin" value={draft.apiBaseUrl} onChange={(e) => setDraft({ ...draft, apiBaseUrl: e.target.value })} />
          </SettingsRow>
          <SettingsRow label="Service token" description="Sent as Authorization: Bearer. Required for schedules.">
            <Input className="w-full" type="password" autoComplete="off" placeholder="Not set" value={draft.serviceToken} onChange={(e) => setDraft({ ...draft, serviceToken: e.target.value })} />
          </SettingsRow>
          <SettingsRow label="Tenant ID" description="Must equal agent-api SAGE_TENANT_ID; used in schedule definitions.">
            <Input className="w-full" value={draft.tenantId} onChange={(e) => setDraft({ ...draft, tenantId: e.target.value })} />
          </SettingsRow>
          <CardRow className="justify-end gap-2">
            {saved ? <span className="text-[12px] text-muted">Saved</span> : null}
            <Button size="sm" disabled={!dirty} onClick={save}>Save changes</Button>
          </CardRow>
        </SettingsGroup>
        ) : null}

        {show('appearance') ? (
        <SettingsGroup title="Appearance" description="Theme for this browser.">
          <SettingsRow label="Theme" description="System follows your OS preference.">
            <ViewTabs>
              {themes.map(([value, label, Icon]) => (
                <ViewTab key={value} active={settings.theme === value} onClick={() => updateSettings({ theme: value })}>
                  <span className="flex items-center gap-1.5"><Icon className="size-3.5" strokeWidth={1.75} />{label}</span>
                </ViewTab>
              ))}
            </ViewTabs>
          </SettingsRow>
        </SettingsGroup>
        ) : null}

        {show('status') ? (
        <SettingsGroup title="Health" description="Live probes against agent-api.">
          <SettingsRow label="Liveness" description="GET /livez">{live.error ? <span className="text-[12.5px] text-red">Unreachable</span> : <StatusBadge status={live.data?.status} />}</SettingsRow>
          <SettingsRow label="Readiness" description="GET /readyz" stacked>{ready.error ? <span className="text-[12.5px] text-red">{ready.error.message}</span> : <JsonView value={ready.data ?? null} className="w-full" />}</SettingsRow>
        </SettingsGroup>
        ) : null}

        {show('developer') ? (
        <SettingsGroup title="Developer" description="Tools for UI development.">
          <SettingsRow label="Mock data" description="Read-only demo dataset for screenshots and UI work. Toggle with ?mock=1 / ?mock=0.">
            {isMock() ? <Button size="sm" variant="secondary" onClick={exitMock}>Exit mock mode</Button> : <Button size="sm" variant="secondary" onClick={() => { window.location.search = '?mock=1'; }}>Enable</Button>}
          </SettingsRow>
        </SettingsGroup>
        ) : null}

        {show('shortcuts') ? (
        <SettingsGroup title="Keyboard shortcuts" description="Available anywhere in the console.">
          {[['⌘ K', 'Command menu'], ['G O', 'Overview'], ['G C', 'Chat'], ['G T', 'Tasks'], ['G S', 'Schedules'], ['G A', 'Apps'], ['G P', 'Packages'], ['G M', 'Providers'], ['G ,', 'Settings'], ['↵', 'Send message']].map(([keys = '', label]) => (
            <SettingsRow key={keys} label={label}><span className="flex gap-1">{keys.split(' ').map((k) => <Kbd key={k}>{k}</Kbd>)}</span></SettingsRow>
          ))}
        </SettingsGroup>
        ) : null}
        </div>
        </div>
      </PageContent>
    </>
  );
}
