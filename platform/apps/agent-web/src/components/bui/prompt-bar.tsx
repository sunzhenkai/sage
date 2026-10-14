// Adapted from Beautiful UI "prompt-bar" + "chat-composer" (MIT © 2026 Shane Levine):
// rounded composer with @ sources, / commands, model picker and an ink send button.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

export type PromptMenuItem = { key: string; icon?: ReactNode | undefined; label: ReactNode; hint?: ReactNode | undefined; insert?: string | undefined; run?: () => void | undefined; disabled?: boolean | undefined };
export type PromptModel = { id: string; label: string; disabled?: boolean | undefined };

function Menu({ items, footer, active, onPick }: { items: PromptMenuItem[]; footer: ReactNode; active: number; onPick: (i: PromptMenuItem) => void }) {
  return (
    <div className="absolute inset-x-0 bottom-[calc(100%+8px)] z-30 overflow-hidden rounded-[12px] bg-surface p-1 shadow-overlay" style={{ animation: 'pop-in 160ms cubic-bezier(0.23,1,0.32,1) both', transformOrigin: 'bottom center' }}>
      <div className="max-h-[280px] overflow-y-auto">
        {items.length === 0 ? <div className="px-2.5 py-2 text-[12.5px] text-ink-3">No matches</div> : items.map((it, i) => (
          <button key={it.key} type="button" disabled={it.disabled} onMouseDown={(e) => { e.preventDefault(); onPick(it); }}
            className={cn('flex h-9 w-full items-center gap-3 rounded-control px-2.5 text-left transition-colors disabled:opacity-40', i === active ? 'bg-hover-2' : 'hover:bg-hover')}>
            {it.icon ? <span className="flex size-4 shrink-0 items-center justify-center text-ink-2 [&_svg]:size-4">{it.icon}</span> : null}
            <span className="shrink-0 text-[13px] font-medium text-ink">{it.label}</span>
            {it.hint ? <span className="truncate text-[12.5px] text-ink-3">{it.hint}</span> : null}
          </button>
        ))}
      </div>
      <div className="mx-1 mt-1 border-t border-line px-1.5 pb-0.5 pt-1.5 text-[11px] text-ink-3">{footer}</div>
    </div>
  );
}

export function PromptBar({ value, onChange, onSubmit, placeholder = 'Ask anything — @ to reference, / for commands', models, model, onModel, sources = [], commands = [], busy, status, className }: {
  value: string; onChange: (v: string) => void; onSubmit: () => void; placeholder?: string; models: PromptModel[]; model: string; onModel: (id: string) => void;
  sources?: PromptMenuItem[]; commands?: PromptMenuItem[]; busy?: boolean; status?: ReactNode; className?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [menu, setMenu] = useState<null | '@' | '/'>(null);
  const [active, setActive] = useState(0);
  const [modelOpen, setModelOpen] = useState(false);
  const token = menu ? (value.match(menu === '@' ? /@([^\s@]*)$/ : /^\/(\S*)$/)?.[1] ?? '') : '';
  const pool = menu === '@' ? sources : menu === '/' ? commands : [];
  const items = pool.filter((i) => !token || String(i.key).toLowerCase().includes(token.toLowerCase()) || String(i.label).toLowerCase().includes(token.toLowerCase()));
  const canSend = value.trim().length > 0 && !busy;
  useEffect(() => { const el = ref.current; if (el) { el.style.height = 'auto'; el.style.height = `${Math.min(el.scrollHeight, 200)}px`; } }, [value]);
  useEffect(() => {
    if (/@[^\s@]*$/.test(value) && sources.length) setMenu('@');
    else if (/^\/\S*$/.test(value) && commands.length) setMenu('/');
    else setMenu(null);
    setActive(0);
  }, [value, sources.length, commands.length]);
  const pick = (it: PromptMenuItem) => {
    if (it.run) { it.run(); onChange(''); }
    else if (menu === '@') onChange(value.replace(/@[^\s@]*$/, `${it.insert ?? `@${it.key}`} `));
    setMenu(null); ref.current?.focus();
  };
  const current = models.find((m) => m.id === model);
  return (
    <div className={cn('relative', className)}>
      {menu ? <Menu items={items} active={active} onPick={pick} footer={menu === '@' ? 'Type to search tasks, apps & schedules' : 'Commands run locally in this console'} /> : null}
      <div onClick={() => ref.current?.focus()} className="flex cursor-text items-end gap-1.5 rounded-[14px] bg-surface p-1.5 shadow-raised transition-shadow focus-within:shadow-overlay">
        <button type="button" title="Reference (@)" onClick={(e) => { e.stopPropagation(); onChange(`${value}${value && !value.endsWith(' ') ? ' ' : ''}@`); ref.current?.focus(); }} className="flex size-8 shrink-0 items-center justify-center rounded-full text-ink-3 transition-colors hover:bg-hover hover:text-ink">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
        </button>
        <textarea ref={ref} rows={1} value={value} placeholder={placeholder} aria-label="Prompt"
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (menu && items.length) {
              if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => (a + 1) % items.length); return; }
              if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => (a - 1 + items.length) % items.length); return; }
              if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); const it = items[active]; if (it) pick(it); return; }
            }
            if (e.key === 'Escape') { setMenu(null); return; }
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); if (canSend) onSubmit(); }
          }}
          className="block max-h-[200px] min-h-8 flex-1 resize-none bg-transparent py-[7px] text-[14px] leading-[18px] text-ink outline-none placeholder:text-ink-3" />
        <div className="relative flex shrink-0 items-center gap-1">
          {status}
          <button type="button" onClick={(e) => { e.stopPropagation(); setModelOpen((o) => !o); }} className="flex h-8 max-w-[180px] items-center gap-1 rounded-full px-2.5 text-[13px] text-ink-2 transition-colors hover:bg-hover hover:text-ink" title="Provider connection">
            <span className="truncate">{current?.label ?? 'Server default'}</span>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>
          </button>
          {modelOpen ? (
            <>
              <div className="fixed inset-0 z-20" onClick={(e) => { e.stopPropagation(); setModelOpen(false); }} />
              <div className="absolute bottom-[calc(100%+10px)] right-8 z-30 w-56 rounded-[12px] bg-surface p-1 shadow-overlay" style={{ animation: 'pop-in 160ms cubic-bezier(0.23,1,0.32,1) both', transformOrigin: 'bottom right' }}>
                <div className="px-2 pb-1 pt-1.5 text-[11px] font-medium text-ink-3">Provider connection</div>
                {[{ id: '', label: 'Server default' }, ...models].map((m) => (
                  <button key={m.id} type="button" disabled={'disabled' in m && m.disabled} onClick={(e) => { e.stopPropagation(); onModel(m.id); setModelOpen(false); }} className="flex h-8 w-full items-center justify-between gap-2 rounded-control px-2 text-left text-[13px] text-ink hover:bg-hover disabled:opacity-40">
                    <span className="truncate">{m.label}</span>
                    {m.id === model ? <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg> : null}
                  </button>
                ))}
              </div>
            </>
          ) : null}
          <button type="button" aria-label="Send" title="Send (Enter)" disabled={!canSend} onClick={(e) => { e.stopPropagation(); onSubmit(); }}
            className="flex size-8 items-center justify-center rounded-[9px] transition-[background-color,color,transform] duration-200 enabled:active:scale-[0.96]"
            style={{ background: canSend ? 'var(--ink)' : 'var(--line-strong)', color: canSend ? 'var(--surface)' : 'var(--ink-2)' }}>
            {busy ? <span className="size-3.5 rounded-full border-[1.5px] border-current border-t-transparent" style={{ animation: 'spin 700ms linear infinite' }} />
              : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19V5M5 12l7-7 7 7" /></svg>}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Right-aligned user message bubble (chat-composer). */
export function UserBubble({ children }: { children: ReactNode }) {
  return <div className="readable whitespace-pre-wrap rounded-xl bg-field px-3 py-1.5 text-[14px] leading-[1.45] text-ink">{children}</div>;
}
