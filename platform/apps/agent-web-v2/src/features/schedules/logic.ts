import { ApiError } from "@/lib/api";

/**
 * Schedule authentication failure (spec §10.3): HTTP 401 or the
 * `SCHEDULE_AUTHENTICATION_REQUIRED` code both mean the server has no
 * service token configured; the UI must show configuration guidance instead
 * of the raw HTTP error.
 */
export function isScheduleAuthError(error: unknown): boolean {
  return (
    error instanceof ApiError && (error.status === 401 || error.code === "SCHEDULE_AUTHENTICATION_REQUIRED")
  );
}
