import type { ReactNode } from 'react';

/** Left-aligned agent response surface; users speak in right-aligned field bubbles. */
export function AgentResponse({ children }: { children: ReactNode }) {
  return <div className="flex w-full flex-col gap-3 rounded-card bg-surface px-4 py-3.5 shadow-card">{children}</div>;
}
