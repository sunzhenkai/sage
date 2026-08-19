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

export function safeHistoryPreview(kind: 'text' | 'artifact' | null, text: string | null, artifactName: string | null): string | undefined {
  if (kind === 'text' && text !== null) {
    const normalized = normalizeWhitespace(text);
    return normalized === '' ? undefined : truncateCodePoints(normalized, 160);
  }
  if (kind === 'artifact') return truncateCodePoints(`[Artifact: ${safeArtifactName(artifactName ?? 'artifact')}]`, 160);
  return undefined;
}

export interface NormalizedSessionFilters { readonly status: SessionHistoryStatus; readonly q: string; readonly archived: boolean }
export const normalizeSessionFilters = (status?: SessionHistoryStatus, q?: string, archived?: boolean): NormalizedSessionFilters => ({
  status: status ?? 'all',
  q: normalizeWhitespace(q ?? '').toLocaleLowerCase('en-US'),
  archived: archived ?? false
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
