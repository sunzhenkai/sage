// Adapted from Beautiful UI "records-table" (MIT © 2026 Shane Levine): CRM-style grid with row numbers,
// hairline cell borders, sticky header/first column, sortable headers and a count footer.
import { useMemo, useState, type ReactNode } from 'react';
import { useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';

export type RecordColumn<T> = { key: string; label: ReactNode; icon?: ReactNode; width?: number | string; align?: 'left' | 'right'; sort?: (a: T, b: T) => number; render: (row: T) => ReactNode };

const SortIcon = ({ dir }: { dir: 'asc' | 'desc' | null }) => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className={cn('shrink-0 transition-opacity', dir ? 'opacity-100' : 'opacity-0 group-hover/h:opacity-60')}>
    {dir === 'asc' ? <path d="M12 19V5M5 12l7-7 7 7" /> : <path d="M12 5v14M19 12l-7 7-7-7" />}
  </svg>
);

export function RecordsTable<T>({ columns, rows, getKey, onRowClick, activeKey, footer, hideFooter, empty, className, fill }: {
  columns: RecordColumn<T>[]; rows: T[]; getKey: (row: T) => string; onRowClick?: (row: T) => void; activeKey?: string | undefined; footer?: ReactNode; hideFooter?: boolean; empty?: ReactNode; className?: string; fill?: boolean;
}) {
  const t = useT();
  const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' } | null>(null);
  const sorted = useMemo(() => {
    const col = sort && columns.find((c) => c.key === sort.key);
    if (!sort || !col?.sort) return rows;
    const s = [...rows].sort(col.sort);
    return sort.dir === 'desc' ? s.reverse() : s;
  }, [rows, sort, columns]);
  const cycle = (key: string) => setSort((cur) => (cur?.key !== key ? { key, dir: 'asc' } : cur.dir === 'asc' ? { key, dir: 'desc' } : null));
  return (
    <div className={cn('flex min-h-0 flex-col overflow-hidden', fill ? 'flex-1 bg-panel [--rt-bg:var(--panel)] [--rt-head:var(--table-head)]' : 'rounded-card bg-surface shadow-card [--rt-bg:var(--surface)] [--rt-head:var(--table-head)]', className)}>
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full border-separate border-spacing-0 text-[13px] font-medium text-ink" style={{ tableLayout: 'fixed', minWidth: 760 }}>
          <colgroup>
            <col style={{ width: 44 }} />
            {columns.map((c) => <col key={c.key} style={c.width !== undefined ? { width: c.width } : undefined} />)}
          </colgroup>
          <thead>
            <tr>
              <th className="sticky left-0 top-0 z-20 h-9 border-b border-r border-line border-b-line-strong bg-[var(--rt-head)]" />
              {columns.map((c, i) => {
                const dir = sort?.key === c.key ? sort.dir : null;
                return (
                  <th key={c.key} className={cn('sticky top-0 z-10 h-9 border-b border-line border-b-line-strong bg-[var(--rt-head)] p-0 text-left font-normal', i < columns.length - 1 && 'border-r')}>
                    <button type="button" disabled={!c.sort} onClick={() => cycle(c.key)} className={cn('group/h flex h-9 w-full items-center gap-1.5 px-2 text-[12px] font-semibold text-ink transition-colors enabled:hover:bg-hover enabled:hover:text-ink', c.align === 'right' && 'justify-end')}>
                      {c.icon ? <span className="inline-flex shrink-0 text-ink-3 [&_svg]:size-3.5">{c.icon}</span> : null}
                      <span className="truncate">{c.label}</span>
                      {c.sort ? <SortIcon dir={dir} /> : null}
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {sorted.map((row, idx) => {
              const key = getKey(row);
              const active = key === activeKey;
              return (
                <tr key={key} onClick={onRowClick ? () => onRowClick(row) : undefined} className={cn('group/r', onRowClick && 'cursor-pointer')}>
                  <td className={cn('sticky left-0 z-[5] h-[35px] border-b border-r border-line text-center transition-colors', active ? 'bg-accent-tint' : 'bg-[var(--rt-bg)] group-hover/r:bg-hover')}>
                    <span className="inline-flex size-6 items-center justify-center text-[11.5px] tabular-nums text-ink-3">{idx + 1}</span>
                  </td>
                  {columns.map((c, i) => (
                    <td key={c.key} className={cn('h-[35px] overflow-hidden text-ellipsis whitespace-nowrap border-b border-line px-2 transition-colors', i < columns.length - 1 && 'border-r', c.align === 'right' && 'text-right', active ? 'bg-accent-tint' : 'group-hover/r:bg-hover')}>
                      {c.render(row)}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
        {rows.length === 0 ? empty : null}
      </div>
      {hideFooter ? null : (
        <div className="flex min-h-[35px] shrink-0 items-center gap-3 border-t border-line px-3 text-[11.5px] text-ink-3">
          <span><span className="mr-[3px] text-[13px] font-medium text-ink">{rows.length}</span>{t('recordsTable.count')}</span>
          {footer}
        </div>
      )}
    </div>
  );
}
