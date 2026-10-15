// Adapted from Beautiful UI "streaming-text" + "stream-text" (MIT © 2026 Shane Levine): answer body with caret, actions, follow-ups.
import { useState, type ReactNode } from 'react';
import { useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';

function renderBlocks(text: string): ReactNode[] {
  const blocks = text.split(/\n{2,}/);
  return blocks.map((block, i) => {
    const lines = block.split('\n');
    if (lines.every((l) => /^\s*([•\-*]|\d+[.)])\s+/.test(l))) {
      return <ul key={i} className="flex flex-col gap-1 pl-1">{lines.map((l, j) => <li key={j} className="flex gap-2"><span className="mt-[9px] size-1 shrink-0 rounded-full bg-ink-3" /><span>{l.replace(/^\s*([•\-*]|\d+[.)])\s+/, '')}</span></li>)}</ul>;
    }
    return <p key={i} className="whitespace-pre-wrap">{block}</p>;
  });
}

export function StreamingText({ text, streaming, actions, followUps, onFollowUp, className }: { text: string; streaming?: boolean; actions?: ReactNode; followUps?: string[]; onFollowUp?: (s: string) => void; className?: string }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  return (
    <div className={cn('flex flex-col', className)}>
      <div className="flex flex-col gap-3 text-[14px] leading-[1.6] tracking-[-0.005em] text-ink">
        {renderBlocks(text)}
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
