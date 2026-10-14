import { cn } from '@/lib/utils';

export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={() => onChange(!checked)}
      className={cn('relative h-[18px] w-[30px] shrink-0 rounded-full border transition-colors disabled:opacity-50', checked ? 'border-accent bg-accent' : 'border-line-strong bg-surface')}>
      <span className={cn('absolute top-1/2 size-3 -translate-y-1/2 rounded-full shadow-sm transition-[left] duration-150', checked ? 'left-[14px] bg-white' : 'left-[2px] bg-faint')} />
    </button>
  );
}
