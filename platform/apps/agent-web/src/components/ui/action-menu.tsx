import { MoreHorizontal } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

export type ActionMenuItem = {
  id: string;
  label: string;
  onSelect: () => void;
  disabled?: boolean;
  danger?: boolean;
};

/** Header overflow menu: one icon, secondary actions behind it. */
export function ActionMenu({ label, items }: { label: string; items: ActionMenuItem[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('mousedown', onPointer);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onPointer);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={label}
        title={label}
        onClick={() => setOpen((value) => !value)}
        className="grid size-7 place-items-center rounded-control text-faint hover:bg-hover hover:text-fg"
      >
        <MoreHorizontal className="size-3.5" strokeWidth={1.75} />
      </button>
      {open ? (
        <div id={menuId} role="menu" className="absolute right-0 top-[calc(100%+4px)] z-30 min-w-44 rounded-card bg-surface py-1 shadow-overlay">
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              onClick={() => { setOpen(false); item.onSelect(); }}
              className={cn('flex h-8 w-full items-center px-3 text-left text-[13px] hover:bg-hover disabled:opacity-50', item.danger ? 'text-red' : 'text-fg')}
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
