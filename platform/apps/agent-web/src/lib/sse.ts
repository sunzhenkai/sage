import { authHeaders } from './api';
import type { TimelineEvent } from './types';

export type StreamState = 'connecting' | 'live' | 'reconnecting' | 'closed';

/**
 * fetch-based SSE reader (EventSource cannot send the Authorization header).
 * Reconnects with exponential backoff, resuming from the last seen `id:` (sequence).
 */
export function streamTimeline(
  url: (afterSequence: number) => string,
  startAfter: number,
  onEvent: (event: TimelineEvent) => void,
  onState: (state: StreamState) => void
): () => void {
  const controller = new AbortController();
  let last = startAfter;
  let attempt = 0;

  const run = async (): Promise<void> => {
    while (!controller.signal.aborted) {
      onState(attempt === 0 ? 'connecting' : 'reconnecting');
      try {
        const response = await fetch(url(last), { headers: { accept: 'text/event-stream', ...authHeaders() }, signal: controller.signal });
        if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
        onState('live');
        attempt = 0;
        const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
        let buffer = '';
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += value;
          let index: number;
          while ((index = buffer.indexOf('\n\n')) >= 0) {
            const frame = buffer.slice(0, index);
            buffer = buffer.slice(index + 2);
            let eventName = 'message';
            const data: string[] = [];
            for (const line of frame.split('\n')) {
              if (line.startsWith(':')) continue;
              if (line.startsWith('event:')) eventName = line.slice(6).trim();
              else if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
            }
            if (eventName !== 'timeline' || data.length === 0) continue;
            try {
              const event = JSON.parse(data.join('\n')) as TimelineEvent;
              if (event.sequence > last) { last = event.sequence; onEvent(event); }
            } catch { /* ignore malformed frame */ }
          }
        }
      } catch {
        if (controller.signal.aborted) break;
      }
      attempt += 1;
      onState('reconnecting');
      await new Promise((resolve) => setTimeout(resolve, Math.min(15_000, 500 * 2 ** Math.min(attempt, 5))));
    }
    onState('closed');
  };
  void run();
  return () => controller.abort();
}
