// Adapted from Beautiful UI "loading-state" (MIT © 2026 Shane Levine).
import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

const chevron = Array.from({ length: 9 }, (_, i) => { const r = Math.floor(i / 3), c = i % 3; return (c + Math.abs(r - 1)) * 90; });
const ORBIT_ORDER = [0, 1, 2, 5, 8, 7, 6, 3];
const orbit = Array.from({ length: 9 }, (_, i) => { const k = ORBIT_ORDER.indexOf(i); return k === -1 ? null : k * 110; });
const PATTERNS = { drive: { delays: chevron, dur: 650, round: false }, dots: { delays: chevron, dur: 650, round: true }, orbit: { delays: orbit, dur: 950, round: false } } as const;
export type LoaderVariant = keyof typeof PATTERNS;

export function LoaderGrid({ variant = 'drive', className }: { variant?: LoaderVariant; className?: string }) {
  const { delays, dur, round } = PATTERNS[variant];
  return (
    <span aria-hidden className={cn('grid shrink-0 grid-cols-[repeat(3,4px)] gap-[1.5px]', className)}>
      {delays.map((delay, i) => (
        <span key={i} className={cn('size-[4px] bg-ink', round ? 'rounded-full' : 'rounded-[1px]')}
          style={{ opacity: delay === null ? 0.07 : 0.15, animation: delay === null ? 'none' : `pixel-on ${dur}ms ease-in-out ${delay}ms infinite` }} />
      ))}
    </span>
  );
}

export function formatElapsed(ms: number): string {
  const total = Math.max(0, ms) / 1000;
  if (total < 60) return `${total.toFixed(1)}s`;
  if (total < 3600) return `${Math.floor(total / 60)}m ${(total % 60).toFixed(0)}s`;
  return `${Math.floor(total / 3600)}h ${Math.floor((total % 3600) / 60)}m`;
}

function useNow(interval = 100) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), interval); return () => clearInterval(t); }, [interval]);
  return now;
}

/** Pixel-grid loader + shimmering label + live elapsed timer (from `since` when given). */
export function LoadingState({ label = 'Working', since, variant = 'drive', className }: { label?: string; since?: string | number | undefined; variant?: LoaderVariant; className?: string }) {
  const [mounted] = useState(() => Date.now());
  const now = useNow();
  const start = since === undefined ? mounted : typeof since === 'number' ? since : new Date(since).getTime();
  return (
    <div role="status" className={cn('flex w-fit items-center gap-2.5', className)}>
      <LoaderGrid variant={variant} />
      <span className="shimmer-label text-[13px] font-medium">{label}</span>
      <span className="font-mono text-[12px] tabular-nums text-ink-3">{formatElapsed(now - start)}</span>
    </div>
  );
}
