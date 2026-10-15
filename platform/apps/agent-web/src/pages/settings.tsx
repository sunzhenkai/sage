import { useQuery } from '@tanstack/react-query';
import { Activity, Code2, Keyboard, Monitor, Moon, Palette, Plug, RotateCcw, Server, Sun, X } from 'lucide-react';
import { useState } from 'react';
import { Navigate, useParams } from 'react-router';
import { ViewTab, ViewTabs } from '@/components/layout/app-shell';
import { SettingsCard, SettingsEmpty, SettingsFooter, SettingsItem, SettingsSearch, SettingsShell, SettingsTitle, type SettingsNavItem } from '@/components/layout/settings-shell';
import { StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { JsonView, Kbd } from '@/components/ui/misc';
import { Switch } from '@/components/ui/switch';
import { api } from '@/lib/api';
import { setLanguagePref, useT, type LanguagePref } from '@/lib/i18n';
import { exitMock, isMock } from '@/lib/mock';
import { type Theme, updateSettings, useSettings } from '@/lib/settings';
import { defaultShortcuts, resetAllShortcuts, resetShortcut, setShortcut, shortcutKeys, useShortcutOverrides, type Shortcut } from '@/lib/shortcuts';

/** Static maps hold translation keys only; every label is resolved at render time so switching language applies immediately. */
const pages = {
  appearance: { title: 'settings.pages.appearance.title', description: 'settings.pages.appearance.description' },
  shortcuts: { title: 'settings.pages.shortcuts.title', description: 'settings.pages.shortcuts.description' },
  general: { title: 'settings.pages.general.title', description: 'settings.pages.general.description' },
  status: { title: 'settings.pages.status.title', description: 'settings.pages.status.description' },
  developer: { title: 'settings.pages.developer.title', description: 'settings.pages.developer.description' }
} as const;
type PageId = keyof typeof pages;

const groups: { label: string; items: SettingsNavItem[] }[] = [
  { label: 'settings.groups.preferences', items: [{ to: '/settings/appearance', label: 'settings.nav.appearance', icon: Palette }, { to: '/settings/shortcuts', label: 'settings.nav.shortcuts', icon: Keyboard }] },
  { label: 'settings.groups.system', items: [{ to: '/settings/general', label: 'settings.nav.connection', icon: Server }, { to: '/providers', label: 'nav.providers', icon: Plug, external: true }, { to: '/settings/status', label: 'settings.nav.status', icon: Activity }, { to: '/settings/developer', label: 'settings.nav.developer', icon: Code2 }] }
];

/** `keywords` keeps the original English search terms; `texts` are the rendered (translated) labels. */
const match = (q: string, ...texts: string[]) => !q || texts.some((t) => t.toLowerCase().includes(q.toLowerCase()));

export function SettingsPage() {
  const { section = 'general' } = useParams();
  const [q, setQ] = useState('');
  const t = useT();
  if (!(section in pages)) return <Navigate to="/settings/general" replace />;
  const id = section as PageId;
  const page = pages[id];
  const title = t(page.title);
  const reset = id === 'appearance' ? () => { updateSettings({ theme: 'system' }); setLanguagePref('auto'); } : id === 'shortcuts' ? resetAllShortcuts : id === 'general' ? () => updateSettings({ apiBaseUrl: '', serviceToken: '', tenantId: 'tenant-local' }) : undefined;
  return (
    <SettingsShell groups={groups.map((g) => ({ label: t(g.label), items: g.items.map((i) => ({ ...i, label: t(i.label) })) }))} header={title}>
      <SettingsTitle title={title} description={t(page.description)}
        toolbar={<>
          <SettingsSearch value={q} onChange={setQ} placeholder={t('settings.searchPlaceholder', { title: title.toLowerCase() })} />
          <div className="flex-1" />
          {reset ? <Button size="sm" variant="secondary" onClick={reset}><RotateCcw />{t('settings.resetToDefaults')}</Button> : null}
        </>} />
      {id === 'appearance' ? <AppearanceSection q={q} /> : id === 'shortcuts' ? <ShortcutsSection q={q} /> : id === 'general' ? <ConnectionSection key={section} q={q} /> : id === 'status' ? <StatusSection q={q} /> : <DeveloperSection q={q} />}
    </SettingsShell>
  );
}


function AppearanceSection({ q }: { q: string }) {
  const t = useT();
  const settings = useSettings();
  const themes: [Theme, string, typeof Sun][] = [['light', t('settings.appearance.light'), Sun], ['dark', t('settings.appearance.dark'), Moon], ['system', t('settings.appearance.system'), Monitor]];
  const languages: [LanguagePref, string][] = [['auto', t('settings.appearance.languageAuto')], ['en', t('settings.appearance.languageEnglish')], ['zh-CN', t('settings.appearance.languageChinese')]];
  if (!match(q, t('settings.appearance.card'), t('settings.appearance.title'), t('settings.appearance.description'), t('settings.appearance.language'), t('settings.appearance.languageDescription'), ...themes.map(([, label]) => label), ...languages.map(([, label]) => label))) return <SettingsEmpty q={q} />;
  return (
    <SettingsCard title={t('settings.appearance.card')}>
      <SettingsItem title={t('settings.appearance.title')} description={t('settings.appearance.description')}>
        <ViewTabs>
          {themes.map(([value, label, Icon]) => (
            <ViewTab key={value} active={settings.theme === value} onClick={() => updateSettings({ theme: value })}><span className="flex items-center gap-1.5"><Icon className="size-3.5" strokeWidth={1.75} />{label}</span></ViewTab>
          ))}
        </ViewTabs>
      </SettingsItem>
      <SettingsItem title={t('settings.appearance.language')} description={t('settings.appearance.languageDescription')}>
        <ViewTabs>
          {languages.map(([value, label]) => (
            <ViewTab key={value} active={settings.language === value} onClick={() => setLanguagePref(value)}>{label}</ViewTab>
          ))}
        </ViewTabs>
      </SettingsItem>
    </SettingsCard>
  );
}

function ShortcutsSection({ q }: { q: string }) {
  const t = useT();
  const overrides = useShortcutOverrides();
  const label = (s: Shortcut) => t(s.labelKey);
  const description = (s: Shortcut) => t(s.descriptionKey);
  const rows = defaultShortcuts.filter((s) => match(q, label(s), description(s), s.keys));
  if (!rows.length) return <SettingsEmpty q={q} />;
  const groupsOf = [{ key: 'general', title: t('settings.shortcuts.general'), rows: rows.filter((s) => !s.to) }, { key: 'navigation', title: t('settings.shortcuts.navigation'), rows: rows.filter((s) => s.to) }].filter((g) => g.rows.length);
  return groupsOf.map((g) => (
    <SettingsCard key={g.key} title={g.title}>
      {g.rows.map((s) => {
        const keys = shortcutKeys(s, overrides);
        const changed = s.id in overrides;
        return (
          <SettingsItem key={s.id} title={label(s)} description={description(s)}>
            {keys ? <span className="flex gap-1">{keys.split(' ').map((k) => <Kbd key={k} className="h-[22px] min-w-[22px] text-[11.5px] text-ink">{k}</Kbd>)}</span> : <span className="t-meta">{t('settings.shortcuts.notSet')}</span>}
            <span className="ml-2 flex gap-0.5">
              <Button size="icon-sm" variant="ghost" title={t('settings.shortcuts.reset')} aria-label={t('settings.shortcuts.resetAria', { label: label(s) })} disabled={!changed} onClick={() => resetShortcut(s.id)}><RotateCcw /></Button>
              <Button size="icon-sm" variant="ghost" title={t('settings.shortcuts.clear')} aria-label={t('settings.shortcuts.clearAria', { label: label(s) })} disabled={s.fixed || !keys} onClick={() => setShortcut(s.id, '')}><X /></Button>
            </span>
          </SettingsItem>
        );
      })}
    </SettingsCard>
  ));
}

function ConnectionSection({ q }: { q: string }) {
  const t = useT();
  const settings = useSettings();
  const [draft, setDraft] = useState({ apiBaseUrl: settings.apiBaseUrl, serviceToken: settings.serviceToken, tenantId: settings.tenantId });
  const [saved, setSaved] = useState(false);
  const dirty = draft.apiBaseUrl !== settings.apiBaseUrl || draft.serviceToken !== settings.serviceToken || draft.tenantId !== settings.tenantId;
  const rows = [
    { key: 'u', keywords: 'api base url origin proxy', title: t('settings.general.apiBaseUrl.title'), description: t('settings.general.apiBaseUrl.description'), control: <Input className="w-[260px]" placeholder={t('settings.general.apiBaseUrl.placeholder')} value={draft.apiBaseUrl} onChange={(e) => setDraft({ ...draft, apiBaseUrl: e.target.value })} /> },
    { key: 't', keywords: 'service token bearer auth', title: t('settings.general.serviceToken.title'), description: t('settings.general.serviceToken.description'), control: <Input className="w-[260px]" type="password" autoComplete="off" placeholder={t('settings.general.serviceToken.placeholder')} value={draft.serviceToken} onChange={(e) => setDraft({ ...draft, serviceToken: e.target.value })} /> },
    { key: 'n', keywords: 'tenant id', title: t('settings.general.tenantId.title'), description: t('settings.general.tenantId.description'), control: <Input className="w-[260px]" value={draft.tenantId} onChange={(e) => setDraft({ ...draft, tenantId: e.target.value })} /> }
  ].filter((r) => match(q, r.title, r.description, r.keywords));
  if (!rows.length) return <SettingsEmpty q={q} />;
  return (
    <SettingsCard title="agent-api">
      {rows.map((r) => <SettingsItem key={r.key} title={r.title} description={r.description}>{r.control}</SettingsItem>)}
      <SettingsFooter>
        {saved ? <span className="t-meta">{t('settings.general.saved')}</span> : null}
        <Button size="sm" disabled={!dirty} onClick={() => { updateSettings(draft); setSaved(true); setTimeout(() => setSaved(false), 1500); }}>{t('settings.general.save')}</Button>
      </SettingsFooter>
    </SettingsCard>
  );
}

function StatusSection({ q }: { q: string }) {
  const t = useT();
  const settings = useSettings();
  const ready = useQuery({ queryKey: ['readyz', settings.apiBaseUrl], queryFn: api.ready, retry: false });
  const live = useQuery({ queryKey: ['livez', settings.apiBaseUrl], queryFn: api.health, retry: false });
  const showLive = match(q, t('settings.status.liveness'), 'liveness livez'); const showReady = match(q, t('settings.status.readiness'), 'readiness readyz');
  if (!showLive && !showReady) return <SettingsEmpty q={q} />;
  return (
    <SettingsCard title={t('settings.status.card')}>
      {showLive ? <SettingsItem title={t('settings.status.liveness')} description="GET /livez">{live.error ? <span className="text-[12.5px] text-red">{t('settings.status.unreachable')}</span> : <StatusBadge status={live.data?.status} />}</SettingsItem> : null}
      {showReady ? <SettingsItem title={t('settings.status.readiness')} description="GET /readyz" stacked>{ready.error ? <span className="text-[12.5px] text-red">{ready.error.message}</span> : <JsonView value={ready.data ?? null} className="w-full" />}</SettingsItem> : null}
    </SettingsCard>
  );
}

function DeveloperSection({ q }: { q: string }) {
  const t = useT();
  if (!match(q, t('settings.developer.mockData'), t('settings.developer.mockDescription'), 'mock data demo')) return <SettingsEmpty q={q} />;
  return (
    <SettingsCard title={t('settings.developer.card')}>
      <SettingsItem title={t('settings.developer.mockData')} description={t('settings.developer.mockDescription')}>
        <Switch label={t('settings.developer.mockData')} checked={isMock()} onChange={(v) => { if (v) window.location.search = '?mock=1'; else exitMock(); }} />
      </SettingsItem>
    </SettingsCard>
  );
}
