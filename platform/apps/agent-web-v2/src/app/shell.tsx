import { useRef, useState, type ReactNode } from "react";
import {
  Bot,
  CalendarClock,
  ListChecks,
  MessageSquare,
  Package,
  PanelLeftClose,
  PanelLeftOpen,
  Plug,
  Plus,
  Search,
  User,
  type LucideIcon,
} from "lucide-react";
import type { Session } from "@sage/app-contracts";
import { apiClient } from "@/lib/api";
import { useI18n, type MessageKey } from "@/lib/i18n";
import { readStorage, writeStorage } from "@/lib/storage";
import { useTheme, type ThemePreference } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InlineNotice } from "@/components/feedback";
import { navigateTo, workspaceHref, type RouteState, type WorkspaceView } from "./router";

/**
 * Workspace shell (spec §3.2): collapsible primary navigation plus the
 * content area. Cross-view stable features live here: brand link back to
 * Chat (preserving the current session), primary navigation with current
 * state, persisted collapse toggle, global New Chat action, and the static
 * search / runtime card / account menu placeholders.
 */

const SIDEBAR_COLLAPSED_KEY = "sage.web.sidebar.collapsed";

const NAV_ITEMS: ReadonlyArray<{ view: WorkspaceView; labelKey: MessageKey; icon: LucideIcon }> = [
  { view: "chat", labelKey: "shell.navChat", icon: MessageSquare },
  { view: "tasks", labelKey: "shell.navTasks", icon: ListChecks },
  { view: "packages", labelKey: "shell.navPackages", icon: Package },
  { view: "schedules", labelKey: "shell.navSchedules", icon: CalendarClock },
  { view: "providers", labelKey: "shell.navProviders", icon: Plug },
];

const THEME_OPTIONS: ReadonlyArray<{ value: ThemePreference; labelKey: MessageKey }> = [
  { value: "light", labelKey: "shell.themeLight" },
  { value: "dark", labelKey: "shell.themeDark" },
  { value: "system", labelKey: "shell.themeSystem" },
];

export function Shell({ route, children }: { route: RouteState; children: ReactNode }) {
  const { t } = useI18n();
  const { preference, setPreference } = useTheme();
  const [collapsed, setCollapsed] = useState(() => readStorage(SIDEBAR_COLLAPSED_KEY) === "true");

  // Global New Chat action (spec §3.2.4 / §6.1): synchronous guard against
  // duplicate submits; on failure the button becomes usable again and the
  // error shows next to it.
  const creatingRef = useRef(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const toggleSidebar = () => {
    setCollapsed((previous) => {
      const next = !previous;
      writeStorage(SIDEBAR_COLLAPSED_KEY, String(next));
      return next;
    });
  };

  const onNewChat = () => {
    if (creatingRef.current) return;
    creatingRef.current = true;
    setCreating(true);
    setCreateError(null);
    apiClient
      .request<Session>("/chat/sessions", { method: "POST", body: {} })
      .then((session) => {
        navigateTo(`/?session=${encodeURIComponent(session.sessionId)}`);
      })
      .catch((error: unknown) => {
        setCreateError(error instanceof Error ? error.message : t("common.unknown"));
      })
      .finally(() => {
        creatingRef.current = false;
        setCreating(false);
      });
  };

  const brandHref = workspaceHref({ view: "chat", session: route.session });

  return (
    <div className="flex h-screen overflow-hidden bg-background text-foreground">
      <aside
        className={cn("flex shrink-0 flex-col border-r bg-card transition-[width]", collapsed ? "w-16" : "w-64")}
      >
        <div className="flex h-14 items-center gap-2 border-b px-3">
          <a
            href={brandHref}
            aria-label={t("shell.brand")}
            className="flex min-w-0 flex-1 items-center gap-2 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Bot className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
            {collapsed ? null : <span className="truncate text-sm font-semibold">{t("shell.brand")}</span>}
          </a>
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleSidebar}
            aria-label={collapsed ? t("shell.expandSidebar") : t("shell.collapseSidebar")}
          >
            {collapsed ? (
              <PanelLeftOpen className="h-4 w-4" aria-hidden="true" />
            ) : (
              <PanelLeftClose className="h-4 w-4" aria-hidden="true" />
            )}
          </Button>
        </div>

        <div className="space-y-2 p-3">
          <Button onClick={onNewChat} disabled={creating} className={cn("w-full", collapsed && "px-0")}>
            <Plus aria-hidden="true" />
            {collapsed ? <span className="sr-only">{t("shell.newChat")}</span> : t("shell.newChat")}
          </Button>
          {createError ? (
            <InlineNotice variant="error">{createError}</InlineNotice>
          ) : null}
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              disabled
              aria-label={t("common.search")}
              placeholder={collapsed ? "" : t("shell.searchPlaceholder")}
              className="pl-8"
            />
          </div>
        </div>

        <nav aria-label={t("shell.navLabel")} className="flex-1 space-y-1 overflow-y-auto px-3 py-2">
          {NAV_ITEMS.map((item) => {
            const active = route.view === item.view;
            const Icon = item.icon;
            return (
              <a
                key={item.view}
                href={workspaceHref({ view: item.view, session: route.session })}
                aria-label={t(item.labelKey)}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  collapsed && "justify-center px-0",
                  active
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:bg-accent/60 hover:text-accent-foreground",
                )}
              >
                <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                {collapsed ? null : <span className="truncate">{t(item.labelKey)}</span>}
              </a>
            );
          })}
        </nav>

        <div className="space-y-3 border-t p-3">
          {collapsed ? null : (
            <div className="rounded-md border p-3">
              <div className="text-xs font-semibold">{t("shell.runtimeCardTitle")}</div>
              <div className="mt-1 text-xs text-muted-foreground">{t("shell.runtimeCardEmpty")}</div>
            </div>
          )}
          {collapsed ? null : (
            <div className="space-y-1">
              <label htmlFor="sage-theme-select" className="text-xs text-muted-foreground">
                {t("shell.themeLabel")}
              </label>
              <select
                id="sage-theme-select"
                aria-label={t("shell.themeLabel")}
                value={preference}
                onChange={(event) => setPreference(event.target.value as ThemePreference)}
                className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
              >
                {THEME_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {t(option.labelKey)}
                  </option>
                ))}
              </select>
            </div>
          )}
          <Button
            variant="ghost"
            aria-label={t("shell.accountMenu")}
            className={cn("w-full", collapsed ? "px-0" : "justify-start")}
          >
            <User aria-hidden="true" />
            {collapsed ? null : t("shell.accountMenu")}
          </Button>
        </div>
      </aside>

      <main className="min-w-0 flex-1 overflow-y-auto">{children}</main>
    </div>
  );
}
