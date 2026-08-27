import type { ReactNode } from 'react';

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
