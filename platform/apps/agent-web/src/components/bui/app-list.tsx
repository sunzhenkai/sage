import { Link } from 'react-router';
import { Monogram } from '@/components/bui/atoms';
import { useT } from '@/lib/i18n';
import type { AppSummary } from '@/lib/types';
import { statusLabelKey } from '@/components/ui/status';
import { cn, relativeTimeShort } from '@/lib/utils';

/** Secondary pane app rows — same card language as SessionList. */
export function AppList({ items, activeId }: { items: AppSummary[]; activeId?: string | undefined }) {
  const t = useT();
  return (
    <div className="flex flex-col gap-2 pb-4 pt-1">
      {items.map((app) => {
        const active = app.appId === activeId;
        const statusKey = statusLabelKey(app.status);
        const statusLabel = statusKey === undefined ? app.status[0]!.toUpperCase() + app.status.slice(1) : t(statusKey);
        const meta = app.latestVersion
          ? t('apps.columns.versionMeta', { version: app.latestVersion, count: app.releaseCount })
          : '—';
        return (
          <Link
            key={app.appId}
            to={`/apps/${encodeURIComponent(app.appId)}`}
            className={cn('group flex items-start gap-2.5 rounded-[10px] px-2 py-2 transition-colors duration-75', active ? 'bg-surface shadow-card ring-1 ring-accent' : 'shadow-card hover:bg-hover-2')}
          >
            <span className="relative mt-0.5 grid size-8 shrink-0 place-items-center">
              <Monogram text={app.appId} className="size-8 rounded-[9px] text-[12.5px]" />
              <span className={cn('absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full ring-2 ring-[var(--panel)]', app.status === 'active' ? 'bg-green' : app.status === 'disabled' ? 'bg-orange' : 'bg-ink-3')} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2">
                <span className={cn('truncate text-[13px] font-medium tracking-[-0.01em]', active ? 'text-ink' : 'text-fg-2')}>{app.appId}</span>
                <span className="ml-auto shrink-0 text-[11px] tabular-nums text-ink-3">{relativeTimeShort(app.updatedAt)}</span>
              </span>
              <span className="mt-0.5 block truncate text-[12px] text-ink-2">{meta}</span>
              <span className="mt-1.5 flex items-center gap-2 text-[11px] text-ink-3">
                <span className="inline-flex items-center gap-1">
                  <span className={cn('size-1.5 rounded-full', app.status === 'active' ? 'bg-green' : app.status === 'disabled' ? 'bg-orange' : 'bg-ink-3')} />
                  {statusLabel}
                </span>
                {app.hasUnpublishedChanges ? <span className="rounded-[5px] px-1 text-amber shadow-[inset_0_0_0_1px_var(--line)]">{t('apps.columns.unpublished')}</span> : null}
              </span>
            </span>
          </Link>
        );
      })}
    </div>
  );
}

export function AppListSkeleton() {
  return (
    <div className="flex flex-col gap-2 pt-1">
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="flex items-start gap-2.5 rounded-[10px] px-2 py-2">
          <div className="skeleton size-8 shrink-0 rounded-[9px]" />
          <div className="flex min-w-0 flex-1 flex-col gap-1.5 py-0.5">
            <div className="skeleton h-2.5" style={{ width: `${48 + ((i * 17) % 30)}%` }} />
            <div className="skeleton h-2 w-2/3 opacity-60" />
          </div>
        </div>
      ))}
    </div>
  );
}
