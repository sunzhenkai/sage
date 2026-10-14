import { useMemo } from 'react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useSettings } from '@/lib/settings';
import { cn } from '@/lib/utils';

/** Reads chart tokens from CSS so series colors follow the active theme. */
export function useChartTheme() {
  const settings = useSettings();
  return useMemo(() => {
    const css = getComputedStyle(document.documentElement);
    const v = (name: string) => css.getPropertyValue(name).trim();
    return {
      series: [1, 2, 3, 4, 5, 6].map((i) => v(`--chart-${i}`)),
      grid: v('--chart-grid'), axis: v('--chart-axis'), green: v('--green'), red: v('--red'), amber: v('--amber'), faint: v('--faint'), muted: v('--muted')
    };
  }, [settings.theme, typeof document !== 'undefined' && document.documentElement.classList.contains('dark')]);
}

export interface Series { key: string; label: string; color: string }

const axisProps = (color: string) => ({ tick: { fill: color, fontSize: 11 }, tickLine: false, axisLine: false });

function ChartTooltip({ active, payload, label, series }: { active?: boolean; payload?: { dataKey?: string | number; value?: number | string }[]; label?: string | number; series: Series[] }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="min-w-[140px] rounded-lg border border-line-strong bg-raised px-2.5 py-2 text-[12px] shadow-pop">
      <div className="mb-1 text-[11px] text-muted">{label}</div>
      {series.map((s) => {
        const p = payload.find((x) => x.dataKey === s.key);
        if (!p) return null;
        return (
          <div key={s.key} className="flex items-center gap-2 py-px">
            <span className="size-2 rounded-[2px]" style={{ background: s.color }} />
            <span className="flex-1 text-fg-2">{s.label}</span>
            <span className="tabular font-medium text-fg">{p.value}</span>
          </div>
        );
      })}
    </div>
  );
}

export function StackedBars({ data, series, xKey = 'label', height = 200 }: { data: Record<string, string | number>[]; series: Series[]; xKey?: string; height?: number }) {
  const t = useChartTheme();
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 0, bottom: 0, left: -18 }} barCategoryGap="28%">
        <CartesianGrid vertical={false} stroke={t.grid} />
        <XAxis dataKey={xKey} {...axisProps(t.axis)} interval="preserveStartEnd" minTickGap={16} />
        <YAxis {...axisProps(t.axis)} allowDecimals={false} width={40} />
        <Tooltip cursor={{ fill: 'var(--hover)' }} content={(p) => <ChartTooltip {...(p as object)} series={series} />} />
        {series.map((s, i) => <Bar key={s.key} dataKey={s.key} stackId="a" fill={s.color} radius={i === series.length - 1 ? [2, 2, 0, 0] : 0} isAnimationActive={false} />)}
      </BarChart>
    </ResponsiveContainer>
  );
}

export function AreaTrend({ data, series, xKey = 'label', height = 200 }: { data: Record<string, string | number>[]; series: Series[]; xKey?: string; height?: number }) {
  const t = useChartTheme();
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 8, right: 0, bottom: 0, left: -18 }}>
        <defs>
          {series.map((s) => (
            <linearGradient key={s.key} id={`g-${s.key}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={s.color} stopOpacity={0.32} />
              <stop offset="100%" stopColor={s.color} stopOpacity={0} />
            </linearGradient>
          ))}
        </defs>
        <CartesianGrid vertical={false} stroke={t.grid} />
        <XAxis dataKey={xKey} {...axisProps(t.axis)} interval="preserveStartEnd" minTickGap={16} />
        <YAxis {...axisProps(t.axis)} allowDecimals={false} width={40} />
        <Tooltip cursor={{ stroke: t.grid }} content={(p) => <ChartTooltip {...(p as object)} series={series} />} />
        {series.map((s) => <Area key={s.key} type="monotone" dataKey={s.key} stroke={s.color} strokeWidth={1.5} fill={`url(#g-${s.key})`} isAnimationActive={false} dot={false} activeDot={{ r: 3, strokeWidth: 0 }} />)}
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function LineTrend({ data, series, xKey = 'label', height = 200, unit = '' }: { data: Record<string, string | number>[]; series: Series[]; xKey?: string; height?: number; unit?: string }) {
  const t = useChartTheme();
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 0, bottom: 0, left: -18 }}>
        <CartesianGrid vertical={false} stroke={t.grid} />
        <XAxis dataKey={xKey} {...axisProps(t.axis)} interval="preserveStartEnd" minTickGap={16} />
        <YAxis {...axisProps(t.axis)} width={48} unit={unit} />
        <Tooltip cursor={{ stroke: t.grid }} content={(p) => <ChartTooltip {...(p as object)} series={series} />} />
        {series.map((s) => <Line key={s.key} type="monotone" dataKey={s.key} stroke={s.color} strokeWidth={1.5} dot={false} isAnimationActive={false} activeDot={{ r: 3, strokeWidth: 0 }} />)}
      </LineChart>
    </ResponsiveContainer>
  );
}

export function Sparkline({ values, color, height = 28 }: { values: number[]; color: string; height?: number }) {
  const data = values.map((v, i) => ({ i, v }));
  const id = `sp-${color.replace(/[^a-z0-9]/gi, '')}`;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
        <defs><linearGradient id={id} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity={0.28} /><stop offset="100%" stopColor={color} stopOpacity={0} /></linearGradient></defs>
        <Area type="monotone" dataKey="v" stroke={color} strokeWidth={1.25} fill={`url(#${id})`} isAnimationActive={false} dot={false} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

/** Horizontal bar list (Linear insights table-with-bars style). */
export function BarList({ items, color, format = (n: number) => String(n) }: { items: { name: React.ReactNode; value: number; color?: string | undefined }[]; color: string; format?: (n: number) => string }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <div className="flex flex-col gap-1">
      {items.map((item, idx) => (
        <div key={idx} className="relative flex h-7 items-center px-2 text-[12.5px]">
          <div className="absolute inset-y-0 left-0 rounded-[4px]" style={{ width: `${(item.value / max) * 100}%`, background: item.color ?? color, opacity: 0.16 }} />
          <span className="relative flex-1 truncate text-fg-2">{item.name}</span>
          <span className="tabular relative text-muted">{format(item.value)}</span>
        </div>
      ))}
    </div>
  );
}

export function Legend({ series }: { series: Series[] }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      {series.map((s) => <span key={s.key} className="flex items-center gap-1.5 text-[11.5px] text-muted"><span className="size-2 rounded-[2px]" style={{ background: s.color }} />{s.label}</span>)}
    </div>
  );
}

/** Placeholder chart for empty data: faint bars + label. */
export function GhostChart({ height = 200, label = 'No data in this range' }: { height?: number; label?: string }) {
  const bars = [32, 48, 26, 60, 42, 70, 38, 54, 30, 64, 46, 58, 36, 50];
  return (
    <div className="relative" style={{ height }}>
      <div className="absolute inset-x-0 bottom-0 flex h-full items-end gap-[6%] px-2 pb-5 opacity-[0.5]">
        {bars.map((h, i) => <div key={i} className="flex-1 rounded-t-[2px] bg-hover" style={{ height: `${h}%` }} />)}
      </div>
      <div className="absolute inset-0 grid place-items-center"><span className="rounded-md bg-panel/80 px-2 py-1 text-[12px] text-muted">{label}</span></div>
    </div>
  );
}

export function ChartCard({ title, description, value, actions, children, className }: { title: string; description?: React.ReactNode; value?: React.ReactNode; actions?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn('flex min-w-0 flex-col rounded-[10px] border border-line bg-tile', className)}>
      <header className="flex items-start gap-3 px-4 pb-1 pt-3.5">
        <div className="min-w-0 flex-1">
          <h3 className="text-[13px] font-medium tracking-[-0.01em] text-fg">{title}</h3>
          {description ? <p className="mt-0.5 text-[12px] text-muted">{description}</p> : null}
        </div>
        {actions}
      </header>
      {value !== undefined ? <div className="tabular px-4 pt-1 text-[24px] font-medium tracking-[-0.02em] text-fg">{value}</div> : null}
      <div className="px-3 pb-3 pt-2">{children}</div>
    </section>
  );
}

export function StatTile({ label, value, delta, spark, color }: { label: string; value: React.ReactNode; delta?: React.ReactNode; spark?: number[]; color: string }) {
  return (
    <section className="flex min-w-0 flex-col rounded-[10px] border border-line bg-tile px-4 pb-3 pt-3.5">
      <div className="text-[12.5px] text-muted">{label}</div>
      <div className="mt-1.5 flex items-end gap-3">
        <div className="tabular text-[24px] font-medium leading-7 tracking-[-0.02em] text-fg">{value}</div>
        {delta ? <div className="pb-0.5 text-[12px] text-muted">{delta}</div> : null}
      </div>
      <div className="mt-2 h-7">{spark && spark.some((v) => v > 0) ? <Sparkline values={spark} color={color} /> : <div className="mt-3.5 h-px bg-line" />}</div>
    </section>
  );
}
