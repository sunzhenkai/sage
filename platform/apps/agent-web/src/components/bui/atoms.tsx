// Atoms adapted from Beautiful UI (entity-chip, value-pill, records-table tags, task-rows pills) — MIT © 2026 Shane Levine.
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** Tag hues from records-table.css; color-mixed against the surface for both themes. */
export const TAG_HUES = ['oklch(0.671 0.118 219.351)', 'oklch(0.757 0.153 66.401)', 'oklch(0.652 0.131 162.865)', 'oklch(0.62 0.17 295)', 'oklch(0.66 0.17 20)', 'oklch(0.72 0.14 100)', 'oklch(0.65 0.16 340)', 'oklch(0.7 0.13 45)'];
export function hueFor(text: string): string { let h = 0; for (const c of text) h = (h * 31 + c.charCodeAt(0)) >>> 0; return TAG_HUES[h % TAG_HUES.length]!; }

export function Tag({ children, hue, className }: { children: ReactNode; hue?: string; className?: string }) {
  return <span className={cn('bui-tag inline-flex h-[22px] shrink-0 items-center rounded-[6px] px-1.5 text-[12px] font-medium leading-none', className)} style={{ ['--tag-base' as string]: hue ?? hueFor(String(children)) }}>{children}</span>;
}

export function Monogram({ text, className }: { text: string; className?: string }) {
  return <span className={cn('grid size-5 shrink-0 place-items-center rounded-[5px] bg-field text-[10.5px] font-semibold text-ink-2 shadow-hairline', className)}>{(text.replace(/^[^a-z0-9]+/i, '')[0] ?? '?').toUpperCase()}</span>;
}

export type PillTone = 'green' | 'red' | 'orange' | 'accent' | 'neutral';
const pill: Record<PillTone, string> = { green: 'bg-green-tint text-green', red: 'bg-red-tint text-red', orange: 'bg-orange-tint text-orange', accent: 'bg-accent-tint text-accent-ink', neutral: 'bg-field text-ink-2' };
export function StatusPill({ tone = 'neutral', children, className }: { tone?: PillTone; children: ReactNode; className?: string }) {
  return <span className={cn('inline-flex h-[22px] shrink-0 items-center gap-1.5 rounded-full px-2 text-[11.5px] font-medium', pill[tone], className)}>{children}</span>;
}
export function toneFor(status: string | undefined): PillTone {
  switch (status?.toLowerCase()) {
    case 'succeeded': case 'completed': case 'active': case 'alive': case 'ready': case 'available': case 'open': return 'green';
    case 'failed': case 'missed': case 'cancelled': case 'deleted': return 'red';
    case 'paused': case 'skipped': case 'effect_unknown': case 'disabled': return 'orange';
    case 'running': return 'accent';
    default: return 'neutral';
  }
}

/** Monospace delta value pill (value-pill). */
export function ValuePill({ value, positive }: { value: ReactNode; positive?: boolean }) {
  return <code className={cn('rounded-[5px] px-1 font-mono text-[12px]', positive === undefined ? 'bg-field text-ink-2' : positive ? 'bg-green-tint text-green' : 'bg-red-tint text-red')}>{value}</code>;
}

export function SpinnerRing({ active, children, size = 24 }: { active?: boolean; children?: ReactNode; size?: number }) {
  const stroke = 2; const r = (size - stroke) / 2; const c = 2 * Math.PI * r;
  return (
    <span className="relative inline-flex shrink-0 items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="absolute inset-0" style={active ? { animation: 'spin 1.1s linear infinite' } : undefined}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--line)" strokeWidth={stroke} />
        {active ? <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--ink-3)" strokeWidth={stroke} strokeLinecap="round" strokeDasharray={`${c * 0.28} ${c * 0.72}`} /> : null}
      </svg>
      <span className="relative text-[10.5px] font-semibold tabular-nums text-ink">{children}</span>
    </span>
  );
}
export function RoundBadge({ tone, children, size = 22 }: { tone: 'red' | 'green' | 'orange' | 'neutral'; children: ReactNode; size?: number }) {
  return <span className={cn('flex shrink-0 items-center justify-center rounded-full text-white', tone === 'red' ? 'bg-red' : tone === 'green' ? 'bg-green' : tone === 'orange' ? 'bg-orange' : 'bg-ink-3')} style={{ width: size, height: size }}>{children}</span>;
}
export const CheckGlyph = <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>;
export const XGlyph = <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12" /></svg>;
export const PauseGlyph = <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></svg>;
export const BangGlyph = <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round"><path d="M12 6v8M12 18.5v.5" /></svg>;
export const DashGlyph = <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round"><path d="M7 12h10" /></svg>;

/** Task-rows status badge: green check / red x / orange pause / spinner ring. */
export function StatusGlyph({ status, size = 22, step }: { status: string | undefined; size?: number; step?: ReactNode }) {
  switch (status) {
    case 'succeeded': case 'completed': case 'promoted': case 'SUCCEEDED': return <RoundBadge tone="green" size={size}>{CheckGlyph}</RoundBadge>;
    case 'failed': case 'FAILED': case 'MISSED': return <RoundBadge tone="red" size={size}>{XGlyph}</RoundBadge>;
    case 'paused': case 'PAUSED': return <RoundBadge tone="orange" size={size}>{PauseGlyph}</RoundBadge>;
    case 'effect_unknown': return <RoundBadge tone="orange" size={size}>{BangGlyph}</RoundBadge>;
    case 'cancelled': case 'SKIPPED': return <RoundBadge tone="neutral" size={size}>{DashGlyph}</RoundBadge>;
    case 'running': case 'active': case 'ACTIVE': return <SpinnerRing active size={size + 2}>{step}</SpinnerRing>;
    default: return <SpinnerRing size={size + 2}>{step}</SpinnerRing>;
  }
}
