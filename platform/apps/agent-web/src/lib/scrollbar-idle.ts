/** Thumb stays visible while its container is scrolling, then hides after idle. Width never changes. */
export const SCROLLBAR_ACTIVE_CLASS = 'scrollbar-active';
export const SCROLLBAR_IDLE_MS = 1_000;

export interface ScrollbarClock {
  schedule(callback: () => void, delayMs: number): number;
  cancel(id: number): void;
}

export function showScrollbarUntilIdle(
  element: { classList: { add(token: string): void; remove(token: string): void } },
  idleMs: number,
  clock: ScrollbarClock,
  timers: WeakMap<object, number>,
): void {
  element.classList.add(SCROLLBAR_ACTIVE_CLASS);
  const pending = timers.get(element);
  if (pending !== undefined) clock.cancel(pending);
  timers.set(element, clock.schedule(() => {
    timers.delete(element);
    element.classList.remove(SCROLLBAR_ACTIVE_CLASS);
  }, idleMs));
}

function isElement(target: EventTarget | null): target is Element {
  return typeof Element === 'function' && target instanceof Element;
}

function isDocument(target: EventTarget | null): target is Document {
  return typeof Document === 'function' && target instanceof Document;
}

/** Viewport scrolls target the Document; every other scroller is the event target itself. */
export function scrollbarElement(target: EventTarget | null, viewport: Element | null): Element | null {
  if (isElement(target)) return target;
  if (isDocument(target)) return viewport;
  return null;
}

/** Capture-phase listener so every overflow container (including non-bubbling scrolls) is covered. */
export function installAutoHideScrollbars(doc: Document = document, idleMs: number = SCROLLBAR_IDLE_MS): () => void {
  const timers = new WeakMap<object, number>();
  const clock: ScrollbarClock = {
    schedule: (callback, delayMs) => window.setTimeout(callback, delayMs),
    cancel: (id) => window.clearTimeout(id),
  };
  const onScroll = (event: Event): void => {
    const element = scrollbarElement(event.target, doc.scrollingElement);
    if (element) showScrollbarUntilIdle(element, idleMs, clock, timers);
  };
  doc.addEventListener('scroll', onScroll, { capture: true, passive: true });
  return () => doc.removeEventListener('scroll', onScroll, { capture: true });
}
