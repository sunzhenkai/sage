import { createHash } from 'node:crypto';
import type { MessagePart, SessionHistoryStatus } from '@sage/app-contracts';

const normalizeWhitespace = (value: string): string => value.trim().replace(/\s+/gu, ' ');
export const truncateCodePoints = (value: string, limit: number): string => [...value].slice(0, limit).join('');
export const safeArtifactName = (value: string): string => {
  const cleaned = [...normalizeWhitespace(value)]
    .filter((character) => { const codePoint = character.codePointAt(0)!; return codePoint > 31 && codePoint !== 127; })
    .join('').replace(/[<>]/gu, '');
  return truncateCodePoints(cleaned || 'artifact', 120);
};

export function deriveSessionTitle(parts: readonly MessagePart[]): string | undefined {
  const text = parts.find((part): part is Extract<MessagePart, { kind: 'text' }> => part.kind === 'text' && normalizeWhitespace(part.text).length > 0);
  if (text !== undefined) return truncateCodePoints(normalizeWhitespace(text.text), 80);
  return parts.some((part) => part.kind === 'artifact') ? 'Artifact conversation' : undefined;
}

/** 剔除推理区间：已闭合 <think>…</think> 整段移除；未闭合 <think> 视为其后全部为推理内容。 */
export const stripThinkSegments = (value: string): string => {
  const closedStripped = value.replace(/<think>[\s\S]*?<\/think>/giu, '');
  const openIndex = closedStripped.search(/<think>/iu);
  return openIndex === -1 ? closedStripped : closedStripped.slice(0, openIndex);
};

export function safeHistoryPreview(kind: 'text' | 'artifact' | null, text: string | null, artifactName: string | null): string | undefined {
  if (kind === 'text' && text !== null) {
    const normalized = normalizeWhitespace(stripThinkSegments(text));
    return normalized === '' ? undefined : truncateCodePoints(normalized, 160);
  }
  if (kind === 'artifact') return truncateCodePoints(`[Artifact: ${safeArtifactName(artifactName ?? 'artifact')}]`, 160);
  return undefined;
}

export interface PreviewCandidatePart { readonly kind: string; readonly text: string | null; readonly artifactName: string | null }
/**
 * 从最新 message 的候选 parts（按 part_index 序）生成 preview：
 * 首个「剥离 think 后仍有可见文本」的 text part，否则首个 artifact label，仍无则缺省。
 */
export function safeHistoryPreviewFromParts(parts: readonly PreviewCandidatePart[]): string | undefined {
  for (const part of parts) {
    if (part.kind === 'text') {
      const preview = part.text === null ? undefined : safeHistoryPreview('text', part.text, null);
      if (preview !== undefined) return preview;
      continue;
    }
    if (part.kind === 'artifact') return safeHistoryPreview('artifact', null, part.artifactName);
  }
  return undefined;
}

/** 未命名会话的默认显示标题（与 Agent Web locale 文案一致），供 NULL title 的搜索回退匹配。 */
export const untitledTitleForLocale = (locale: 'en' | 'zh-CN'): string => locale === 'zh-CN' ? '未命名对话' : 'Untitled Chat';
/** 与 Agent Web 一致的 locale 收敛：zh* → zh-CN，en* → en，其余默认 zh-CN。 */
export const normalizeHistoryLocale = (locale?: string): 'en' | 'zh-CN' => {
  const value = (locale ?? '').trim().toLowerCase();
  if (value.startsWith('en')) return 'en';
  if (value.startsWith('zh')) return 'zh-CN';
  return 'zh-CN';
};

export interface NormalizedSessionFilters { readonly status: SessionHistoryStatus; readonly q: string; readonly archived: boolean; readonly untitledFallback: string }
export const normalizeSessionFilters = (status?: SessionHistoryStatus, q?: string, archived?: boolean, locale?: string): NormalizedSessionFilters => ({
  status: status ?? 'all',
  q: normalizeWhitespace(q ?? '').toLocaleLowerCase('en-US'),
  archived: archived ?? false,
  untitledFallback: untitledTitleForLocale(normalizeHistoryLocale(locale))
});
export const sessionFilterHash = (filters: NormalizedSessionFilters): string =>
  createHash('sha256').update(JSON.stringify(filters)).digest('hex');

interface HistoryCursorV1 { readonly v: 1; readonly sortTime: string; readonly sessionId: string; readonly filterHash: string }
const postgresMicros = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
export function encodeSessionCursor(value: Omit<HistoryCursorV1, 'v'>): string {
  if (!postgresMicros.test(value.sortTime)) throw new Error('sortTime must be PostgreSQL UTC with six microseconds');
  return Buffer.from(JSON.stringify({ v: 1, ...value } satisfies HistoryCursorV1)).toString('base64url');
}
export function decodeSessionCursor(cursor: string, expectedFilterHash: string): HistoryCursorV1 {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as Partial<HistoryCursorV1>;
    if (parsed.v !== 1 || typeof parsed.sortTime !== 'string' || !postgresMicros.test(parsed.sortTime)
      || typeof parsed.sessionId !== 'string' || parsed.sessionId.length === 0 || parsed.sessionId.length > 128
      || parsed.filterHash !== expectedFilterHash) throw new Error('invalid cursor');
    return parsed as HistoryCursorV1;
  } catch {
    throw new Error('Invalid or filter-mismatched Chat history cursor');
  }
}
