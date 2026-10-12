import { describe, expect, it } from 'vitest';
import type { ChatStore } from '@sage/chat-domain';
import { createChatApi } from './index.js';

describe('Chat timeline SSE heartbeat', () => {
  it('emits a comment heartbeat on idle streams within the configured interval', async () => {
    let closed = false;
    const signalWait = (signal: AbortSignal, ms: number): Promise<void> => new Promise((resolve) => {
      const timer = setTimeout(() => { if (!signal.aborted) resolve(); else resolve(); }, ms);
      signal.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
    });
    const store = {
      async migrate() {},
      async markActiveRunsFailed() { return []; },
      async listTimeline() { return []; },
      async waitForTimeline(_tenantId: string, _sessionId: string, _after: number, signal: AbortSignal) {
        if (signal.aborted || closed) return [];
        await signalWait(signal, 20);
        return [];
      }
    } as unknown as ChatStore;
    // 受控时钟：首次调用（lastWriteAt 初始化）为 t0，此后每次读表直接前进 25s，
    // 让 20s 心跳阈值在测试内确定性触发。
    // 受控单调时钟：每次读表前进 25s（> 20s 心跳阈值），首次读表即写入 lastWriteAt，
    // 第二次读表（首个空闲轮询）即触发心跳，测试在毫秒级完成。
    const base = Date.parse('2026-08-30T00:00:00.000Z');
    let clockMs = 0;
    const app = await createChatApi({ store, now: () => new Date(base + (clockMs += 25_000)) });
    await app.listen({ port: 0, host: '127.0.0.1' });
    const address = app.server.address();
    if (address === null || typeof address === 'string') throw new Error('server address unavailable');
    const url = `http://127.0.0.1:${address.port}/v1/chat/sessions/session-sse/timeline?afterSequence=0`;
    const controller = new AbortController();
    try {
      const response = await fetch(url, { signal: controller.signal, headers: { accept: 'text/event-stream' } });
      expect(response.status).toBe(200);
      const reader = response.body?.getReader();
      if (!reader) throw new Error('response body unreadable');
      const decoder = new TextDecoder();
      let buffered = '';
      const deadline = Date.now() + 5_000;
      while (!buffered.includes(': ping') && Date.now() < deadline) {
        const chunk = await reader.read();
        if (chunk.done) break;
        buffered += decoder.decode(chunk.value, { stream: true });
      }
      expect(buffered).toContain(': ping');
      expect(buffered).toContain(':ok');
    } finally {
      closed = true;
      controller.abort();
      await app.close();
    }
  });
});
