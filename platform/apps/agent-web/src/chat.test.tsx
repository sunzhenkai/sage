import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { TimelineEvent } from '@sage/app-contracts';
import { ChatTimeline, deduplicate } from './chat.js';

const at = (sequence: number, payload: TimelineEvent['payload'], runId = 'run-1'): TimelineEvent => ({ schemaVersion: '1', sessionId: 'session-1', runId, sequence, occurredAt: '2026-08-12T00:00:00.000Z', payload });

describe('Chat UI application contracts', () => {
  it('renders text, Tool activity, Artifact refs, stable errors, and Retry without inline Artifact content', () => {
    const events = [
      at(1, { kind: 'text', text: 'hello' }),
      at(2, { kind: 'tool', toolName: 'search', status: 'completed' }),
      at(3, { kind: 'artifact', artifact: { artifactRef: 'artifact://chat/result', name: 'result.txt', mediaType: 'text/plain', sizeBytes: 9000 } }),
      at(4, { kind: 'error', error: { code: 'CHAT_API_RESTARTED', message: 'restart boundary', retryable: true } })
    ];
    const html = renderToStaticMarkup(<ChatTimeline events={events} onRetry={vi.fn()} />);
    expect(html).toContain('hello');
    expect(html).toContain('Tool: search');
    expect(html).toContain('artifact://chat/result');
    expect(html).toContain('CHAT_API_RESTARTED');
    expect(html).toContain('Retry');
    expect(html).not.toContain('Task Card');
    expect(html).not.toContain('oversized-content');
  });

  it('deduplicates reconnect replay by sequence and preserves gap-free order', () => {
    const events = deduplicate([at(3, { kind: 'run', status: 'succeeded', attempt: 1 }), at(1, { kind: 'text', text: 'one' }), at(2, { kind: 'tool', toolName: 't', status: 'completed' }), at(2, { kind: 'tool', toolName: 't', status: 'completed' })]);
    expect(events.map((event) => event.sequence)).toEqual([1, 2, 3]);
  });
});


  it('shows promotion only for explicit eligibility and fails closed for legacy or assistant text', () => {
    const promote = vi.fn();
    const explicit = renderToStaticMarkup(<ChatTimeline events={[at(1, { kind: 'text', text: 'eligible', messageId: 'message-1', promotionEligibility: 'explicit' })]} onPromote={promote} />);
    const none = renderToStaticMarkup(<ChatTimeline events={[at(1, { kind: 'text', text: 'assistant', messageId: 'message-2', promotionEligibility: 'none' })]} onPromote={promote} />);
    const legacy = renderToStaticMarkup(<ChatTimeline events={[at(1, { kind: 'text', text: 'legacy', messageId: 'message-3' })]} onPromote={promote} />);
    expect(explicit).toContain('Promote to Task');
    expect(none).not.toContain('Promote to Task');
    expect(legacy).not.toContain('Promote to Task');
  });
