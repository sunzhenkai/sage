import type { ReactNode } from 'react';

/**
 * 横幅反馈：kind 决定配色、图标与 ARIA 角色（error → alert 断言式播报，success → status 静默播报）。
 * title 存在时正文包一层 <div><strong/>…</div>，否则正文直接平铺；action 渲染在正文之后（链接/按钮组）。
 */
export function Banner({ kind, title, children, action, onDismiss, dismissLabel }: {
  readonly kind: 'error' | 'success';
  readonly title?: string | undefined;
  readonly children?: ReactNode;
  readonly action?: ReactNode;
  readonly onDismiss?: (() => void) | undefined;
  readonly dismissLabel?: string | undefined;
}) {
  const body = typeof children === 'string' ? <p>{children}</p> : children;
  return <div className={kind === 'error' ? 'error-banner' : 'success-banner'} role={kind === 'error' ? 'alert' : 'status'}>
    <span aria-hidden="true">{kind === 'error' ? '!' : '✓'}</span>
    {title === undefined ? body : <div><strong>{title}</strong>{body}</div>}
    {action}
    {onDismiss === undefined ? null : <button className="icon-button" type="button" aria-label={dismissLabel} onClick={onDismiss}>×</button>}
  </div>;
}

/** 行内提示：error 变体加 -error 配色并以 alert 播报，其余按 status 静默播报。 */
export function InlineNotice({ error = false, className, children }: {
  readonly error?: boolean;
  readonly className?: string | undefined;
  readonly children: ReactNode;
}) {
  const classes = ['inline-notice', ...(error ? ['-error'] : []), ...(className === undefined ? [] : [className])].join(' ');
  return <div className={classes} role={error ? 'alert' : 'status'}>{children}</div>;
}

/** 整区加载态：spinner + 主文案 + 可选补充说明。 */
export function LoadingState({ label, detail }: {
  readonly label: string;
  readonly detail?: string | undefined;
}) {
  return <div className="loading-state"><span className="loading-spinner" /><strong>{label}</strong>{detail === undefined ? null : <p>{detail}</p>}</div>;
}

/** 空态面板：图标 + 标题 + 说明 + 可选操作（按钮/链接）。 */
export function EmptyPanel({ icon, title, hint, action }: {
  readonly icon: string;
  readonly title: string;
  readonly hint: string;
  readonly action?: ReactNode;
}) {
  return <div className="empty-panel"><span className="empty-orb" aria-hidden="true">{icon}</span><h3>{title}</h3><p>{hint}</p>{action}</div>;
}
