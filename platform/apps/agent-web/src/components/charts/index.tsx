import { Fragment, useMemo, type ReactNode } from 'react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
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
      grid: v('--chart-grid'), axis: v('--chart-axis'), green: v('--green'), red: v('--red'), amber: v('--amber'), accent: v('--accent'), faint: v('--faint'), muted: v('--muted'),
      status: { succeeded: v('--chart-success'), failed: v('--chart-fail'), active: v('--chart-running'), running: v('--chart-running'), paused: v('--chart-warn'), cancelled: v('--chart-muted'), effect_unknown: v('--chart-warn') } as Record<string, string>
    };
  }, [settings.theme, typeof document !== 'undefined' && document.documentElement.classList.contains('dark')]);
}

export interface Series { key: string; label: string; color: string }

const axisProps = (color: string) => ({ tick: { fill: color, fontSize: 11 }, tickLine: false, axisLine: false });

function ChartTooltip({ active, payload, label, series }: { active?: boolean; payload?: { dataKey?: string | number; value?: number | string }[]; label?: string | number; series: Series[] }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="min-w-[140px] rounded-[8px] border px-2.5 py-2 text-[11.5px] tabular-nums shadow-overlay" style={{ background: 'var(--tooltip-bg)', color: 'var(--tooltip-fg)', borderColor: 'var(--tooltip-border)' }}>
      <div className="mb-1 text-[11px]" style={{ color: 'var(--tooltip-muted)' }}>{label}</div>
      {series.map((s) => {
        const p = payload.find((x) => x.dataKey === s.key);
        if (!p) return null;
        return (
          <div key={s.key} className="flex items-center gap-2 py-px">
            <span className="size-2 rounded-full" style={{ background: s.color }} />
            <span className="flex-1">{s.label}</span>
            <span className="font-medium">{p.value}</span>
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
      <LineChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: unit ? -6 : -18 }}>
        <CartesianGrid vertical={false} stroke={t.grid} />
        <XAxis dataKey={xKey} {...axisProps(t.axis)} interval="preserveStartEnd" minTickGap={16} />
        <YAxis {...axisProps(t.axis)} width={56} unit={unit} />
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
export function BarList({ items, color, format = (n: number) => String(n) }: { items: { name: ReactNode; value: number; color?: string | undefined }[]; color: string; format?: (n: number) => string }) {
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

/** Signed delta chip: green when good, red when bad. */
export function Delta({ value, good }: { value: number; good?: 'up' | 'down' | undefined }) {
  const ok = value === 0 ? null : (good ?? 'up') === 'up' ? value > 0 : value < 0;
  return <span className={cn('inline-flex items-center rounded-[5px] px-1 text-[11.5px] font-medium tabular-nums', ok === null ? 'text-ink-3' : ok ? 'bg-green-tint text-green' : 'bg-red-tint text-red')}>{value > 0 ? '+' : value < 0 ? '−' : '±'}{Math.abs(value)}%</span>;
}

/** Chart card anatomy: title + description (header), optional value + delta, chart body. White bordered content card. */
export function ChartCard({ title, description, value, delta, actions, children, className }: { title: string; description?: ReactNode; value?: ReactNode; delta?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn('flex min-w-0 flex-col rounded-card bg-surface shadow-card', className)}>
      <header className="flex items-start gap-3 px-4 pb-1 pt-3.5">
        <div className="min-w-0 flex-1">
          <h3 className="text-[13px] font-semibold tracking-[-0.01em] text-ink">{title}</h3>
          {description ? <p className="mt-0.5 text-[12px] text-muted">{description}</p> : null}
        </div>
        {actions}
      </header>
      {value !== undefined ? <div className="flex items-baseline gap-2 px-4 pt-1"><span className="tabular text-[24px] font-semibold tracking-[-0.02em] text-ink">{value}</span>{delta}</div> : null}
      <div className="px-3 pb-3 pt-2">{children}</div>
    </section>
  );
}

export function StatTile({ label, value, delta, spark, color }: { label: string; value: ReactNode; delta?: ReactNode; spark?: number[]; color: string }) {
  return (
    <section className="flex min-w-0 flex-col rounded-card bg-surface px-4 pb-3 pt-3.5 shadow-card">
      <div className="text-[12.5px] font-medium text-ink-2">{label}</div>
      <div className="mt-1.5 flex items-end gap-3">
        <div className="tabular text-[24px] font-semibold leading-7 tracking-[-0.02em] text-ink">{value}</div>
        {delta ? <div className="pb-0.5 text-[12px] text-muted">{delta}</div> : null}
      </div>
      <div className="mt-2 h-7">{spark && spark.some((v) => v > 0) ? <Sparkline values={spark} color={color} /> : <div className="mt-3.5 h-px bg-line" />}</div>
    </section>
  );
}

export function Donut({ items, height = 180, center }: { items: { name: string; value: number; color: string }[]; height?: number; center?: ReactNode }) {
  const total = items.reduce((a, b) => a + b.value, 0) || 1;
  const data = items.filter((i) => i.value > 0);
  return (
    <div className="relative" style={{ height }}>
      <ResponsiveContainer width="100%" height={height}>
        <PieChart>
          <Pie data={data} dataKey="value" nameKey="name" innerRadius="62%" outerRadius="88%" paddingAngle={2} stroke="none" isAnimationActive={false}>
            {data.map((d) => <Cell key={d.name} fill={d.color} />)}
          </Pie>
          <Tooltip content={({ active, payload }) => active && payload?.[0] ? (
            <div className="rounded-[8px] border px-2.5 py-2 text-[11.5px] shadow-overlay" style={{ background: 'var(--tooltip-bg)', color: 'var(--tooltip-fg)', borderColor: 'var(--tooltip-border)' }}>
              <div className="flex items-center gap-2"><span className="size-2 rounded-full" style={{ background: payload[0].payload.color }} />{payload[0].name}<span className="ml-auto font-medium tabular-nums">{payload[0].value} · {Math.round((Number(payload[0].value) / total) * 100)}%</span></div>
            </div>
          ) : null} />
        </PieChart>
      </ResponsiveContainer>
      {center ? <div className="pointer-events-none absolute inset-0 grid place-items-center"><div className="text-center">{center}</div></div> : null}
    </div>
  );
}

/** 7×N activity heatmap (columns = days, rows = weekday Mon–Sun). values[dayIndex][weekday0=Mon]. */
export function Heatmap({ days, values, color }: { days: string[]; values: number[][]; color: string }) {
  const flat = values.flat();
  const max = Math.max(1, ...flat);
  const weeks = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  return (
    <div className="overflow-x-auto px-1">
      <div className="inline-grid gap-[3px]" style={{ gridTemplateColumns: `28px repeat(${days.length}, 12px)` }}>
        <span />
        {days.map((d, i) => <span key={i} className="truncate text-center text-[9px] text-ink-3" title={d}>{i % 3 === 0 ? d.slice(-2) : ''}</span>)}
        {weeks.map((w, wi) => (
          <Fragment key={w}>
            <span className="pr-1 text-right text-[10px] leading-3 text-ink-3">{w[0]}</span>
            {days.map((_, di) => {
              const v = values[di]?.[wi] ?? 0;
              return <span key={`${di}-${wi}`} title={`${days[di]} ${w}: ${v}`} className="size-3 rounded-[3px]" style={{ background: v === 0 ? 'var(--inset)' : `color-mix(in oklch, ${color} ${Math.max(18, Math.round((v / max) * 100))}%, transparent)` }} />;
            })}
          </Fragment>
        ))}
      </div>
    </div>
  );
}

export function ChartSkeleton({ height = 180 }: { height?: number }) {
  return <div className="animate-pulse rounded-control bg-inset" style={{ height }} aria-hidden />;
}
