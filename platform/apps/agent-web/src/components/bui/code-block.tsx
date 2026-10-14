// Adapted from Beautiful UI "code-block" (MIT © 2026 Shane Levine): line-numbered listing with copy.
import { useCallback, useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

const JSON_TOKEN = /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|(-?\b\d+(?:\.\d+)?(?:e[+-]?\d+)?\b)/gi;
function highlightJson(line: string): ReactNode[] {
  const out: ReactNode[] = []; let last = 0; let m: RegExpExecArray | null; JSON_TOKEN.lastIndex = 0;
  while ((m = JSON_TOKEN.exec(line))) {
    if (m.index > last) out.push(line.slice(last, m.index));
    if (m[1]) out.push(<span key={m.index} className={m[2] ? 'text-ink' : 'text-green'}>{m[1]}</span>, m[2] ?? '');
    else if (m[3]) out.push(<span key={m.index} className="text-purple">{m[3]}</span>);
    else out.push(<span key={m.index} className="text-orange">{m[4]}</span>);
    last = m.index + m[0].length;
  }
  if (last < line.length) out.push(line.slice(last));
  return out;
}

const FileIcon = () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--ink-3)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /></svg>;

export function CodeBlock({ code, filename, language = 'text', maxHeight = 420, actions, className, bare }: { code: string; filename?: ReactNode; language?: 'json' | 'text'; maxHeight?: number | 'none'; actions?: ReactNode; className?: string; bare?: boolean }) {
  const [copied, setCopied] = useState(false);
  const copy = useCallback(() => { void navigator.clipboard?.writeText(code).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }); }, [code]);
  const lines = code.replace(/\n$/, '').split('\n');
  const gutter = String(lines.length).length > 2 ? 'grid-cols-[32px_minmax(0,1fr)]' : 'grid-cols-[24px_minmax(0,1fr)]';
  return (
    <div className={cn('w-full overflow-hidden', bare ? '' : 'rounded-card bg-surface shadow-card', className)}>
      {filename !== undefined || !bare ? (
        <div className="flex h-10 items-center gap-2 border-b border-line px-3.5 text-[12.5px]">
          <span className="inline-flex min-w-0 items-center gap-[7px]"><FileIcon /><span className="truncate font-mono leading-none text-ink">{filename ?? (language === 'json' ? 'data.json' : 'output.txt')}</span></span>
          <span className="ml-auto flex items-center gap-1">
            {actions}
            <button type="button" aria-label="Copy code" onClick={copy} className={cn('-mr-1 flex h-6 items-center gap-1 rounded-[6px] px-1.5 text-[12px] font-medium transition-colors duration-100 hover:bg-hover', copied ? 'text-green' : 'text-ink-3 hover:text-ink')}>
              {copied ? <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
                : <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="12" height="12" rx="2.5" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>}
              {copied ? 'Copied' : 'Copy'}
            </button>
          </span>
        </div>
      ) : null}
      <div className="overflow-auto py-3 font-mono text-[12px] leading-[1.65] text-ink-2" style={{ maxHeight: maxHeight === 'none' ? undefined : maxHeight }}>
        <div className="relative min-w-fit">
          <span className={cn('pointer-events-none absolute inset-y-0 w-px bg-line', String(lines.length).length > 2 ? 'left-8' : 'left-6')} />
          {lines.map((line, i) => (
            <div key={i} className={cn('grid items-start', gutter)}>
              <span className="select-none text-center text-[11px] text-ink-3">{i + 1}</span>
              <code className="whitespace-pre pl-2 pr-4">{language === 'json' ? highlightJson(line) : line}</code>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
