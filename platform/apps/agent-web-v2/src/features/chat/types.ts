import type { Session, TimelineEvent } from "@sage/app-contracts";

/** `GET /chat/sessions/:id` — the Web mainly reads `session` (spec §6.2.1). */
export interface SessionDetailResponse {
  session: Session;
}

/** `GET /chat/sessions/:id/events` — timeline snapshot / incremental catch-up. */
export interface SessionEventsResponse {
  events: TimelineEvent[];
}

/** `POST /chat/messages/:messageId/promotions` response (spec §6.7). */
export interface PromotionResponse {
  association?: { taskId?: string | undefined } | undefined;
}

/** User-facing error message: ApiError message first, then a fallback string. */
export function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}
