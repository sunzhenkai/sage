import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
// Adapted from Beautiful UI "streaming-text" + "stream-text" (MIT © 2026 Shane Levine): answer body with caret, actions, follow-ups.
import { useState, type ReactNode } from 'react';
import { useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';

const mdComponents: Components = {
  h1: ({ children }) => <h3 className="mt-1 text-[17px] font-semibold tracking-[-0.01em]">{children}</h3>,
  h2: ({ children }) => <h3 className="mt-1 text-[16px] font-semibold tracking-[-0.01em]">{children}</h3>,
  h3: ({ children }) => <h4 className="mt-1 text-[15px] font-semibold">{children}</h4>,
  h4: ({ children }) => <h5 className="text-[14px] font-semibold">{children}</h5>,
  p: ({ children }) => <p className="whitespace-pre-wrap">{children}</p>,
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  ul: ({ children }) => <ul className="flex list-disc flex-col gap-1 pl-5 marker:text-ink-3">{children}</ul>,
  ol: ({ children }) => <ol className="flex list-decimal flex-col gap-1 pl-5 marker:text-ink-3">{children}</ol>,
  a: ({ href, children }) => <a href={href} target="_blank" rel="noreferrer noopener" className="text-accent-ink underline-offset-2 hover:underline">{children}</a>,
  blockquote: ({ children }) => <blockquote className="border-l-2 border-line pl-3 text-ink-2">{children}</blockquote>,
  hr: () => <hr className="border-line" />,
  pre: ({ children }) => <pre className="overflow-x-auto rounded-control bg-inset px-3 py-2.5 font-mono text-[12.5px] leading-5 [&_code]:bg-transparent [&_code]:p-0">{children}</pre>,
  code: ({ children }) => <code className="rounded-[4px] bg-inset px-1 py-0.5 font-mono text-[12.5px]">{children}</code>,
  table: ({ children }) => <div className="overflow-x-auto"><table className="w-full border-collapse text-[13px]">{children}</table></div>,
  th: ({ children }) => <th className="border-b border-line px-2 py-1.5 text-left font-semibold">{children}</th>,
  td: ({ children }) => <td className="border-b border-line px-2 py-1.5 align-top">{children}</td>
};

/** Assistant markdown (GFM). Raw HTML is never rendered (react-markdown escapes it by default). */
export function Markdown({ text }: { text: string }) {
  return <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml components={mdComponents}>{text}</ReactMarkdown>;
}

export function StreamingText({ text, streaming, actions, followUps, onFollowUp, className }: { text: string; streaming?: boolean; actions?: ReactNode; followUps?: string[]; onFollowUp?: (s: string) => void; className?: string }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  return (
    <div className={cn('flex flex-col', className)}>
      <div className="flex flex-col gap-3 text-[14px] leading-[1.6] tracking-[-0.005em] text-ink">
        <Markdown text={text} />
        {streaming ? <span className="stream-caret" style={{ animation: 'none' }} /> : null}
      </div>
      {!streaming ? (
        <div className="-ml-1.5 mt-2 flex items-center gap-0.5 text-ink-3">
          <button type="button" title={t('common.copy')} onClick={() => { void navigator.clipboard?.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1400); }); }} className={cn('primitive-icon flex size-7 items-center justify-center rounded-control transition-colors hover:bg-hover hover:text-ink', copied && 'text-green')}>
            {copied ? <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
              : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="12" height="12" rx="2.5" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>}
          </button>
          {actions}
        </div>
      ) : null}
      {!streaming && followUps?.length ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {followUps.map((f) => <button key={f} type="button" onClick={() => onFollowUp?.(f)} className="inline-flex h-8 items-center rounded-full bg-surface px-3 text-[13px] text-ink shadow-btn transition-colors hover:bg-inset">{f}</button>)}
        </div>
      ) : null}
    </div>
  );
}
