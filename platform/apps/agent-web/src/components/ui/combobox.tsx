/**
 * Searchable select for catalog-backed forms (provider / model pickers).
 * The result list renders inline below the input (never a portal) so a scrolling
 * Dialog can't clip it. While open it swallows Escape at the window capture phase,
 * otherwise Radix Dialog's document capture listener would close the whole dialog.
 */
import { ChevronDown } from 'lucide-react';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { Input } from './input';

export interface ComboboxOption {
  value: string;
  label: string;
  hint?: string | undefined;
  meta?: ReactNode | undefined;
  disabled?: boolean | undefined;
}

export function Combobox({ value, display, query, onQueryChange, onSelect, options, placeholder, disabled, loading, error, empty, footer, autoFocus }: {
  value?: string | undefined;
  display: string;
  query: string;
  onQueryChange: (query: string) => void;
  onSelect: (option: ComboboxOption) => void;
  options: ComboboxOption[];
  placeholder?: string | undefined;
  disabled?: boolean | undefined;
  loading?: boolean | undefined;
  error?: string | undefined;
  empty?: string | undefined;
  footer?: ReactNode | undefined;
  autoFocus?: boolean | undefined;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const t = useT();
  const placeholderText = placeholder ?? t('ui.combobox.placeholder');
  const emptyText = empty ?? t('ui.combobox.empty');

  const close = () => { setOpen(false); setActive(0); onQueryChange(''); };
  const pick = (option: ComboboxOption) => { if (option.disabled) return; onSelect(option); close(); };

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) close();
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  });

  useEffect(() => {
    if (!open) return;
    const onKeyDownCapture = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !containerRef.current?.contains(event.target as Node)) return;
      event.preventDefault();
      event.stopPropagation();
      close();
    };
    window.addEventListener('keydown', onKeyDownCapture, { capture: true });
    return () => window.removeEventListener('keydown', onKeyDownCapture, { capture: true });
  });

  useEffect(() => { setActive((index) => Math.min(index, Math.max(options.length - 1, 0))); }, [options.length]);

  const move = (delta: number) => {
    if (options.length === 0) return;
    setActive((index) => (index + delta + options.length) % options.length);
  };

  return (
    <div ref={containerRef} className="w-full">
      <div className="relative">
        <Input
          role="combobox"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          aria-autocomplete="list"
          autoComplete="off"
          spellCheck={false}
          disabled={disabled}
          autoFocus={autoFocus}
          className="pr-7"
          placeholder={placeholderText}
          value={open ? query : display}
          onFocus={() => setOpen(true)}
          onChange={(event) => { setOpen(true); onQueryChange(event.target.value); }}
          onKeyDown={(event) => {
            if (disabled) return;
            if (event.key === 'ArrowDown') { event.preventDefault(); if (open) move(1); else setOpen(true); return; }
            if (event.key === 'ArrowUp') { event.preventDefault(); if (open) move(-1); return; }
            if (event.key === 'Enter') { const option = open ? options[active] : undefined; if (option !== undefined) { event.preventDefault(); pick(option); } return; }
            if (event.key === 'Tab') { if (open) close(); }
          }}
        />
        <ChevronDown className="pointer-events-none absolute right-2 top-4 size-3.5 -translate-y-1/2 text-faint" strokeWidth={1.75} />
      </div>
      {open ? (
        <div className="mt-1 overflow-hidden rounded-card bg-surface shadow-overlay">
          <div id={listId} role="listbox" className="max-h-[232px] overflow-y-auto p-1">
            {error !== undefined ? <div className="px-2.5 py-2 text-[12.5px] leading-[18px] text-red">{error}</div> : null}
            {error === undefined && options.length === 0 ? (
              <div className="px-2.5 py-2 text-[12.5px] text-ink-3">{loading ? t('ui.combobox.loading') : emptyText}</div>
            ) : null}
            {options.map((option, index) => (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={option.value === value}
                disabled={option.disabled}
                onMouseDown={(event) => { event.preventDefault(); pick(option); }}
                onMouseEnter={() => setActive(index)}
                className={cn(
                  'flex h-9 w-full items-center gap-2.5 rounded-control px-2.5 text-left transition-colors',
                  index === active ? 'bg-hover-2' : 'hover:bg-hover',
                  option.disabled && 'opacity-40'
                )}
              >
                <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">{option.label}</span>
                {option.hint !== undefined ? <span className="max-w-[45%] shrink-0 truncate font-mono text-[11.5px] text-ink-3">{option.hint}</span> : null}
                {option.meta}
              </button>
            ))}
          </div>
          {footer !== undefined ? <div className="border-t border-line px-2.5 py-1.5 text-[11px] text-ink-3">{footer}</div> : null}
        </div>
      ) : null}
    </div>
  );
}
