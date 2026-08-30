import { useEffect, useRef, type ReactNode } from 'react';

/**
 * 表单字段包装：统一 .field 布局（标签 + 控件 + 可选提示）。
 * 所有表单页统一从这里取控件，保证视觉一致；样式集中在 styles.css 的 .field 一节。
 */
export function Field({ label, wide = false, hint, className, children }: {
  readonly label: string;
  readonly wide?: boolean;
  readonly hint?: string | undefined;
  readonly className?: string | undefined;
  readonly children: ReactNode;
}) {
  const classes = ['field', ...(wide ? ['field-wide'] : []), ...(className === undefined ? [] : [className])].join(' ');
  return <label className={classes}>
    <span>{label}</span>
    {children}
    {hint === undefined ? null : <small className="muted-copy">{hint}</small>}
  </label>;
}

/** 受控文本控件的公共 props；onChange 直接回传 value，省略 event 解构。 */
interface TextControlProps {
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly placeholder?: string | undefined;
  readonly maxLength?: number | undefined;
  readonly disabled?: boolean;
  readonly wide?: boolean;
  readonly hint?: string | undefined;
}

export function TextField({ label, value, onChange, placeholder, maxLength, disabled = false, wide = false, hint, type = 'text' }: TextControlProps & { readonly type?: 'text' | 'password' }) {
  return <Field label={label} wide={wide} hint={hint}>
    <input type={type} aria-label={label} value={value} placeholder={placeholder} maxLength={maxLength} disabled={disabled} onChange={(event) => onChange(event.target.value)} />
  </Field>;
}

export function TextAreaField({ label, value, onChange, placeholder, maxLength, disabled = false, wide = true, hint, rows = 3 }: TextControlProps & { readonly rows?: number }) {
  return <Field label={label} wide={wide} hint={hint}>
    <textarea aria-label={label} value={value} rows={rows} placeholder={placeholder} maxLength={maxLength} disabled={disabled} onChange={(event) => onChange(event.target.value)} />
  </Field>;
}

export function SelectField({ label, value, onChange, disabled = false, wide = false, hint, className, children }: {
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly disabled?: boolean;
  readonly wide?: boolean;
  readonly hint?: string | undefined;
  readonly className?: string | undefined;
  readonly children: ReactNode;
}) {
  return <Field label={label} wide={wide} hint={hint} className={className}>
    <select aria-label={label} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}>{children}</select>
  </Field>;
}

/** 轻量模态（零依赖）：面包屑式上下文 + 极简表单；Esc 关闭、Tab 焦点圈定、关闭后焦点归还。 */
export function Modal({ open, breadcrumb, title, onClose, closeLabel, children }: {
  readonly open: boolean;
  readonly breadcrumb: string;
  readonly title: string;
  readonly onClose: () => void;
  readonly closeLabel: string;
  readonly children: ReactNode;
}) {
  const backdropRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open || typeof document === 'undefined') return;
    const backdrop = backdropRef.current;
    if (backdrop === null) return;
    const focusables = (): HTMLElement[] => Array.from(backdrop.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')).filter((element) => !element.hasAttribute('disabled'));
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    focusables()[0]?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); return; }
      if (event.key !== 'Tab') return;
      const list = focusables();
      if (list.length === 0) return;
      const first = list[0]!, last = list[list.length - 1]!;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => { document.removeEventListener('keydown', onKeyDown); previous?.focus?.(); };
  }, [open, onClose]);
  if (!open) return null;
  return <div className="provider-modal-backdrop" ref={backdropRef} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="provider-modal app-modal" role="dialog" aria-modal="true" aria-label={title}>
      <header className="app-modal-head">
        <div><p className="app-modal-breadcrumb">{breadcrumb}</p><h2>{title}</h2></div>
        <button className="icon-button" type="button" aria-label={closeLabel} onClick={onClose}>×</button>
      </header>
      {children}
    </section>
  </div>;
}
