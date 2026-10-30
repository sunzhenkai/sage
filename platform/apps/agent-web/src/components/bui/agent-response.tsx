import type { ReactNode } from 'react';

/** Left-aligned, full-width agent response (no card); users speak in right-aligned field bubbles. */
export function AgentResponse({ children }: { children: ReactNode }) {
  return <div className="flex w-full flex-col gap-3">{children}</div>;
}
