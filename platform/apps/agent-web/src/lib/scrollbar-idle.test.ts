import { afterEach, describe, expect, it, vi } from 'vitest';
import { SCROLLBAR_ACTIVE_CLASS, SCROLLBAR_IDLE_MS, showScrollbarUntilIdle } from './scrollbar-idle';

function fakeElement(): { classList: { add(token: string): void; remove(token: string): void }; tokens: Set<string> } {
  const tokens = new Set<string>();
  return {
    tokens,
    classList: {
      add: (token) => { tokens.add(token); },
      remove: (token) => { tokens.delete(token); },
    },
  };
}

function fakeClock(): { schedule: (callback: () => void, delayMs: number) => number; cancel: (id: number) => void; canceled: number[] } {
  let seq = 0;
  const handles = new Map<number, ReturnType<typeof setTimeout>>();
  const canceled: number[] = [];
  return {
    canceled,
    schedule(callback, delayMs) {
      const id = ++seq;
      handles.set(id, setTimeout(() => { handles.delete(id); callback(); }, delayMs));
      return id;
    },
    cancel(id) {
      canceled.push(id);
      const handle = handles.get(id);
      if (handle !== undefined) clearTimeout(handle);
      handles.delete(id);
    },
  };
}

describe('showScrollbarUntilIdle', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('shows the thumb immediately and hides it after the idle window', () => {
    vi.useFakeTimers();
    const element = fakeElement();
    showScrollbarUntilIdle(element, SCROLLBAR_IDLE_MS, fakeClock(), new WeakMap());
    expect(element.tokens.has(SCROLLBAR_ACTIVE_CLASS)).toBe(true);
    vi.advanceTimersByTime(SCROLLBAR_IDLE_MS - 1);
    expect(element.tokens.has(SCROLLBAR_ACTIVE_CLASS)).toBe(true);
    vi.advanceTimersByTime(1);
    expect(element.tokens.has(SCROLLBAR_ACTIVE_CLASS)).toBe(false);
  });

  it('restarts the idle window while scrolling continues', () => {
    vi.useFakeTimers();
    const element = fakeElement();
    const clock = fakeClock();
    const timers = new WeakMap<object, number>();
    showScrollbarUntilIdle(element, SCROLLBAR_IDLE_MS, clock, timers);
    vi.advanceTimersByTime(800);
    showScrollbarUntilIdle(element, SCROLLBAR_IDLE_MS, clock, timers);
    expect(clock.canceled).toEqual([1]);
    vi.advanceTimersByTime(800);
    expect(element.tokens.has(SCROLLBAR_ACTIVE_CLASS)).toBe(true);
    vi.advanceTimersByTime(200);
    expect(element.tokens.has(SCROLLBAR_ACTIVE_CLASS)).toBe(false);
  });
});
