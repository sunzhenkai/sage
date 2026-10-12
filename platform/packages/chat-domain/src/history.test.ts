import { describe, expect, it } from 'vitest';
import {
  decodeSessionCursor,
  deriveSessionTitle,
  encodeSessionCursor,
  normalizeSessionFilters,
  normalizeHistoryLocale,
  safeHistoryPreview,
  sessionFilterHash,
  stripThinkSegments,
  safeHistoryPreviewFromParts,
  truncateCodePoints
} from './history.js';

describe('Chat history safety helpers', () => {
  it('derives normalized code-point-safe titles and artifact-only fallback', () => {
    expect(deriveSessionTitle([{ kind: 'text', text: '  hello\n\tworld  ' }])).toBe('hello world');
    expect([...deriveSessionTitle([{ kind: 'text', text: '😀'.repeat(100) }])!]).toHaveLength(80);
    expect(deriveSessionTitle([{ kind: 'artifact', artifact: { artifactRef: 'artifact://safe/1', name: 'secret.txt', mediaType: 'text/plain', sizeBytes: 1 } }])).toBe('Artifact conversation');
  });

  it('builds bounded previews without artifact content', () => {
    expect(safeHistoryPreview('text', `  ${'😀'.repeat(200)}  `, null)).toBe(truncateCodePoints('😀'.repeat(200), 160));
    expect(safeHistoryPreview('artifact', null, '<report>\n.txt')).toBe('[Artifact: report .txt]');
  });

  it('round-trips exact PostgreSQL microseconds and binds normalized filters', () => {
    const filters = normalizeSessionFilters('open', ' Hello ');
    expect(filters).toMatchObject({ status: 'open', q: 'hello', archived: false });
    const filterHash = sessionFilterHash(filters);
    const encoded = encodeSessionCursor({ sortTime: '2026-08-14T01:02:03.123456Z', sessionId: 'session-1', filterHash });
    expect(decodeSessionCursor(encoded, filterHash)).toMatchObject({ sortTime: '2026-08-14T01:02:03.123456Z', sessionId: 'session-1' });
    expect(() => decodeSessionCursor(encoded, sessionFilterHash(normalizeSessionFilters('closed', 'hello')))).toThrow(/filter-mismatched/);
    expect(() => encodeSessionCursor({ sortTime: '2026-08-14T01:02:03.123Z', sessionId: 'session-1', filterHash })).toThrow(/six microseconds/);
  });

  it('binds the archived dimension into the cursor filter hash', () => {
    const active = sessionFilterHash(normalizeSessionFilters('all', '', false));
    const archived = sessionFilterHash(normalizeSessionFilters('all', '', true));
    expect(active).toBe(sessionFilterHash(normalizeSessionFilters()));
    expect(active).not.toBe(archived);
    const encoded = encodeSessionCursor({ sortTime: '2026-08-14T01:02:03.123456Z', sessionId: 'session-1', filterHash: active });
    expect(() => decodeSessionCursor(encoded, archived)).toThrow(/filter-mismatched/);
    expect(() => decodeSessionCursor(encoded, sessionFilterHash(normalizeSessionFilters('open', '', true)))).toThrow(/filter-mismatched/);
  });
});

describe('Think-strip previews and untitled search fallback', () => {
  const previewPart = (kind: 'text' | 'artifact', extra: { text?: string | null; artifactName?: string | null } = {}) =>
    ({ kind, text: extra.text ?? null, artifactName: extra.artifactName ?? null });

  it('strips closed and unclosed think segments from previews', () => {
    expect(stripThinkSegments('<think>internal</think>可见回复')).toBe('可见回复');
    expect(stripThinkSegments('<THINK>leaked</THINK>after')).toBe('after');
    expect(stripThinkSegments('<think>never closed')).toBe('');
    expect(safeHistoryPreview('text', '<think>reasoning</think> 你好！有什么需要帮忙的？', null)).toBe('你好！有什么需要帮忙的？');
    expect(safeHistoryPreview('text', '<think>all reasoning', null)).toBeUndefined();
  });

  it('falls back to the next visible text part when the first is think-only', () => {
    const parts = [previewPart('text', { text: '<think>hidden' }), previewPart('text', { text: '  actual reply  ' }), previewPart('artifact', { artifactName: 'a.txt' })];
    expect(safeHistoryPreviewFromParts(parts)).toBe('actual reply');
    expect(safeHistoryPreviewFromParts([previewPart('artifact', { artifactName: 'b.txt' })])).toBe('[Artifact: b.txt]');
    expect(safeHistoryPreviewFromParts([previewPart('text', { text: '<think>x' })])).toBeUndefined();
    expect(safeHistoryPreviewFromParts([])).toBeUndefined();
  });

  it('matches untitled sessions via locale fallback title and binds it into cursor filters', () => {
    expect(normalizeHistoryLocale('zh-TW')).toBe('zh-CN');
    expect(normalizeHistoryLocale('en-GB')).toBe('en');
    expect(normalizeHistoryLocale('fr-FR')).toBe('zh-CN');
    expect(normalizeSessionFilters('all', 'untitled', false, 'zh-CN').untitledFallback).toBe('未命名对话');
    expect(normalizeSessionFilters('all', 'untitled', false, 'en').untitledFallback).toBe('Untitled Chat');
    const en = sessionFilterHash(normalizeSessionFilters('all', '', false, 'en'));
    const zh = sessionFilterHash(normalizeSessionFilters('all', '', false, 'zh-CN'));
    expect(en).not.toBe(zh);
    const encoded = encodeSessionCursor({ sortTime: '2026-08-14T01:02:03.123456Z', sessionId: 'session-1', filterHash: en });
    expect(() => decodeSessionCursor(encoded, zh)).toThrow(/filter-mismatched/);
  });
});
