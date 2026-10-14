import { useQuery } from '@tanstack/react-query';
import { Activity, Code2, Keyboard, Monitor, Moon, Palette, Plug, RotateCcw, Server, Sun, X } from 'lucide-react';
import { useState } from 'react';
import { Navigate, useParams } from 'react-router';
import { PageHeader, ViewTab, ViewTabs } from '@/components/layout/app-shell';
import { SettingsCard, SettingsEmpty, SettingsFooter, SettingsItem, SettingsSearch, SettingsShell, SettingsTitle } from '@/components/layout/settings-shell';
import { StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { JsonView, Kbd } from '@/components/ui/misc';
import { Switch } from '@/components/ui/switch';
import { api } from '@/lib/api';
import { exitMock, isMock } from '@/lib/mock';
import { type Theme, updateSettings, useSettings } from '@/lib/settings';
import { defaultShortcuts, resetAllShortcuts, resetShortcut, setShortcut, shortcutKeys, useShortcutOverrides } from '@/lib/shortcuts';

const pages = {
  appearance: { title: 'Appearance', description: 'How the console looks in this browser.' },
  shortcuts: { title: 'Keyboard shortcuts', description: 'Navigate the console without leaving the keyboard.' },
  general: { title: 'Connection', description: 'How the console reaches agent-api. Stored in localStorage only.' },
  status: { title: 'Status', description: 'Live probes against agent-api.' },
  developer: { title: 'Developer', description: 'Tools for UI development and screenshots.' }
} as const;
type PageId = keyof typeof pages;

const groups = [
  { label: 'Preferences', items: [{ to: '/settings/appearance', label: 'Appearance', icon: Palette }, { to: '/settings/shortcuts', label: 'Shortcuts', icon: Keyboard }] },
  { label: 'System', items: [{ to: '/settings/general', label: 'Connection', icon: Server }, { to: '/providers', label: 'Providers', icon: Plug, external: true }, { to: '/settings/status', label: 'Status', icon: Activity }, { to: '/settings/developer', label: 'Developer', icon: Code2 }] }
];

const match = (q: string, ...texts: string[]) => !q || texts.some((t) => t.toLowerCase().includes(q.toLowerCase()));

export function SettingsPage() {
  const { section = 'general' } = useParams();
  const [q, setQ] = useState('');
  if (!(section in pages)) return <Navigate to="/settings/general" replace />;
  const id = section as PageId;
  const page = pages[id];
  const reset = id === 'appearance' ? () => updateSettings({ theme: 'system' }) : id === 'shortcuts' ? resetAllShortcuts : id === 'general' ? () => updateSettings({ apiBaseUrl: '', serviceToken: '', tenantId: 'tenant-local' }) : undefined;
  return (
    <>
      <PageHeader title="Settings" />
      <SettingsShell groups={groups}>
      <SettingsTitle title={page.title} description={page.description}
        toolbar={<>
          <SettingsSearch value={q} onChange={setQ} placeholder={`Search ${page.title.toLowerCase()}`} />
          <div className="flex-1" />
          {reset ? <Button size="sm" variant="secondary" onClick={reset}><RotateCcw />Reset to defaults</Button> : null}
        </>} />
      {id === 'appearance' ? <AppearanceSection q={q} /> : id === 'shortcuts' ? <ShortcutsSection q={q} /> : id === 'general' ? <ConnectionSection key={section} q={q} /> : id === 'status' ? <StatusSection q={q} /> : <DeveloperSection q={q} />}
    </SettingsShell>
    </>
  );
}


function AppearanceSection({ q }: { q: string }) {
  const settings = useSettings();
  const themes: [Theme, string, typeof Sun][] = [['light', 'Light', Sun], ['dark', 'Dark', Moon], ['system', 'System', Monitor]];
  if (!match(q, 'theme', 'light', 'dark', 'system')) return <SettingsEmpty q={q} />;
  return (
    <SettingsCard title="Theme">
      <SettingsItem title="Color theme" description="System follows your OS preference.">
        <ViewTabs>
          {themes.map(([value, label, Icon]) => (
            <ViewTab key={value} active={settings.theme === value} onClick={() => updateSettings({ theme: value })}><span className="flex items-center gap-1.5"><Icon className="size-3.5" strokeWidth={1.75} />{label}</span></ViewTab>
          ))}
        </ViewTabs>
      </SettingsItem>
    </SettingsCard>
  );
}

function ShortcutsSection({ q }: { q: string }) {
  const overrides = useShortcutOverrides();
  const rows = defaultShortcuts.filter((s) => match(q, s.label, s.description, s.keys));
  if (!rows.length) return <SettingsEmpty q={q} />;
  const groupsOf = [{ title: 'General', rows: rows.filter((s) => !s.to) }, { title: 'Navigation', rows: rows.filter((s) => s.to) }].filter((g) => g.rows.length);
  return groupsOf.map((g) => (
    <SettingsCard key={g.title} title={g.title}>
      {g.rows.map((s) => {
        const keys = shortcutKeys(s, overrides);
        const changed = s.id in overrides;
        return (
          <SettingsItem key={s.id} title={s.label} description={s.description}>
            {keys ? <span className="flex gap-1">{keys.split(' ').map((k) => <Kbd key={k} className="h-[22px] min-w-[22px] text-[11.5px] text-ink">{k}</Kbd>)}</span> : <span className="t-meta">Not set</span>}
            <span className="ml-2 flex gap-0.5">
              <Button size="icon-sm" variant="ghost" title="Reset to default" aria-label={`Reset ${s.label}`} disabled={!changed} onClick={() => resetShortcut(s.id)}><RotateCcw /></Button>
              <Button size="icon-sm" variant="ghost" title="Clear shortcut" aria-label={`Clear ${s.label}`} disabled={s.fixed || !keys} onClick={() => setShortcut(s.id, '')}><X /></Button>
            </span>
          </SettingsItem>
        );
      })}
    </SettingsCard>
  ));
}

function ConnectionSection({ q }: { q: string }) {
  const settings = useSettings();
  const [draft, setDraft] = useState({ apiBaseUrl: settings.apiBaseUrl, serviceToken: settings.serviceToken, tenantId: settings.tenantId });
  const [saved, setSaved] = useState(false);
  const dirty = draft.apiBaseUrl !== settings.apiBaseUrl || draft.serviceToken !== settings.serviceToken || draft.tenantId !== settings.tenantId;
  const rows = [
    { k: 'api base url origin proxy', el: <SettingsItem key="u" title="API base URL" description="Empty = same origin; dev server proxies /v1 to :9610."><Input className="w-[260px]" placeholder="Same origin" value={draft.apiBaseUrl} onChange={(e) => setDraft({ ...draft, apiBaseUrl: e.target.value })} /></SettingsItem> },
    { k: 'service token bearer auth', el: <SettingsItem key="t" title="Service token" description="Sent as Authorization: Bearer. Required for schedules."><Input className="w-[260px]" type="password" autoComplete="off" placeholder="Not set" value={draft.serviceToken} onChange={(e) => setDraft({ ...draft, serviceToken: e.target.value })} /></SettingsItem> },
    { k: 'tenant id', el: <SettingsItem key="n" title="Tenant ID" description="Must equal agent-api SAGE_TENANT_ID."><Input className="w-[260px]" value={draft.tenantId} onChange={(e) => setDraft({ ...draft, tenantId: e.target.value })} /></SettingsItem> }
  ].filter((r) => match(q, r.k));
  if (!rows.length) return <SettingsEmpty q={q} />;
  return (
    <SettingsCard title="agent-api">
      {rows.map((r) => r.el)}
      <SettingsFooter>
        {saved ? <span className="t-meta">Saved</span> : null}
        <Button size="sm" disabled={!dirty} onClick={() => { updateSettings(draft); setSaved(true); setTimeout(() => setSaved(false), 1500); }}>Save changes</Button>
      </SettingsFooter>
    </SettingsCard>
  );
}

function StatusSection({ q }: { q: string }) {
  const settings = useSettings();
  const ready = useQuery({ queryKey: ['readyz', settings.apiBaseUrl], queryFn: api.ready, retry: false });
  const live = useQuery({ queryKey: ['livez', settings.apiBaseUrl], queryFn: api.health, retry: false });
  const showLive = match(q, 'liveness livez'); const showReady = match(q, 'readiness readyz');
  if (!showLive && !showReady) return <SettingsEmpty q={q} />;
  return (
    <SettingsCard title="Probes">
      {showLive ? <SettingsItem title="Liveness" description="GET /livez">{live.error ? <span className="text-[12.5px] text-red">Unreachable</span> : <StatusBadge status={live.data?.status} />}</SettingsItem> : null}
      {showReady ? <SettingsItem title="Readiness" description="GET /readyz" stacked>{ready.error ? <span className="text-[12.5px] text-red">{ready.error.message}</span> : <JsonView value={ready.data ?? null} className="w-full" />}</SettingsItem> : null}
    </SettingsCard>
  );
}

function DeveloperSection({ q }: { q: string }) {
  if (!match(q, 'mock data demo')) return <SettingsEmpty q={q} />;
  return (
    <SettingsCard title="Data">
      <SettingsItem title="Mock data" description="Read-only demo dataset. Also toggled with ?mock=1 / ?mock=0.">
        <Switch label="Mock data" checked={isMock()} onChange={(v) => { if (v) window.location.search = '?mock=1'; else exitMock(); }} />
      </SettingsItem>
    </SettingsCard>
  );
}
