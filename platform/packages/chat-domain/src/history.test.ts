import { describe, expect, it } from 'vitest';
import {
  decodeSessionCursor,
  deriveSessionTitle,
  encodeSessionCursor,
  normalizeSessionFilters,
  safeHistoryPreview,
  sessionFilterHash,
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
