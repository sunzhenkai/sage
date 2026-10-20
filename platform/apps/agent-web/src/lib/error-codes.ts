/**
 * Authoritative inventory of the server error codes the console renders.
 *
 * `API_ERROR_CODES` mirrors every code agent-api emits through `sendError(...)` (plus the two chat
 * kernel codes `HARNESS_FAILURE` / `CANCELLED`); `API_ERROR_CODE_FAMILIES` covers codes that reach
 * the console by passthrough (`cause.code` from `packages/*`) and only get a generic sentence.
 *
 * `error-codes.test.ts` keeps this list, the `errors` namespace of both dictionaries and the
 * detail policy below in lockstep — a new code must be registered here before it can be rendered.
 */

/** Codes with a dedicated sentence in the `errors` dictionary (exact match wins over families). */
export const API_ERROR_CODES = [
  // apps-api.ts
  'APP_ALREADY_EXISTS',
  'APP_AUTHENTICATION_REQUIRED',
  'APP_NOT_FOUND',
  'APP_OPERATION_REJECTED',
  'APP_PACKAGE_ID_MISMATCH',
  'APP_UNAVAILABLE',
  'APP_UPLOAD_UNTRUSTED_FIELD',
  // runs-api.ts
  'INPUT_REMOVED',
  'PACKAGE_RUN_UNTRUSTED_FIELD',
  'PACKAGE_RUN_ADMISSION_NOT_AVAILABLE',
  'PACKAGE_RUN_AUTHENTICATION_REQUIRED',
  'IDEMPOTENCY_KEY_INVALID',
  'RELEASE_NOT_FOUND',
  'PACKAGE_RUN_MANIFEST_MISSING',
  'PROVIDER_DEPENDENCY_MISSING',
  'PACKAGE_RUN_ENTRY_MISSING',
  'PACKAGE_PARAMS_INVALID',
  'PACKAGE_SNAPSHOT_SOURCE_UNAVAILABLE',
  'PACKAGE_RUN_ADMISSION_IDEMPOTENCY_CONFLICT',
  'ADMISSION_SPEC_COMMIT_FAILED',
  'PACKAGE_RUN_REJECTED',
  'PACKAGE_RUN_UNAVAILABLE',
  // packages-api.ts
  'PACKAGE_AUTHENTICATION_REQUIRED',
  'PACKAGE_REGISTRATION_REJECTED',
  'PACKAGE_UNAVAILABLE',
  'PACKAGE_NOT_FOUND',
  'PACKAGE_REGISTRATION_UNTRUSTED_FIELD',
  'PACKAGE_OPERATION_FORBIDDEN',
  'SCHEDULE_RULE_INVALID',
  'SCHEDULE_FORBIDDEN',
  'SCHEDULE_VALIDATION_FAILED',
  'SCHEDULE_ALREADY_EXISTS',
  'SCHEDULE_NOT_FOUND',
  'SCHEDULE_REVISION_CONFLICT',
  'SCHEDULE_STORE_UNAVAILABLE',
  // catalog-api.ts (+ provider-catalog service codes)
  'CATALOG_INVALID_REQUEST',
  'CATALOG_SYNC_ATTEMPT_NOT_FOUND',
  'CATALOG_UNAVAILABLE',
  'CATALOG_AUTHENTICATION_REQUIRED',
  'CATALOG_SYNC_FORBIDDEN',
  'CATALOG_PROJECTION_UNAVAILABLE',
  'CATALOG_CURSOR_SNAPSHOT_CHANGED',
  'CATALOG_SYNC_RATE_LIMITED',
  'CATALOG_SHUTTING_DOWN',
  // provider-connections-api.ts
  'PROVIDER_CONNECTIONS_AUTHENTICATION_REQUIRED',
  'PROVIDER_CONNECTIONS_UNAVAILABLE',
  'PROVIDER_CONNECTION_UNTRUSTED_FIELD',
  'PROVIDER_CONNECTION_INVALID_REQUEST',
  'SECRET_BACKEND_UNAVAILABLE',
  'PROVIDER_CONNECTION_NOT_FOUND',
  'PROVIDER_CONNECTION_PROTECTED',
  'PROVIDER_CONNECTION_IN_USE',
  // run-agent-settings-api.ts
  'RUN_AGENT_SETTINGS_AUTHENTICATION_REQUIRED',
  'RUN_AGENT_SETTINGS_UNAVAILABLE',
  'RUN_AGENT_SETTINGS_UNTRUSTED_FIELD',
  'RUN_AGENT_SETTINGS_INVALID_PROVIDER',
  // effect-resolutions-api.ts
  'EFFECT_RESOLUTION_INVALID',
  // chat kernel codes (chat-compatibility.ts)
  'HARNESS_FAILURE',
  'CANCELLED'
] as const;

/** Passthrough families: the longest matching prefix wins, and the server detail is always kept. */
export const API_ERROR_CODE_FAMILIES = [
  'SOURCE_ARCHIVE',
  'SOURCE',
  'PACKAGE_LOCK',
  'PACKAGE_OUTPUT',
  'PACKAGE',
  'KERNEL',
  'CAPABILITY',
  'CHECKPOINT',
  'LEDGER',
  'EVENT',
  'ENVELOPE',
  'SPEC',
  'REPLAY',
  'RETRY',
  'EFFECT',
  'USAGE',
  'IDENTITY',
  'MIGRATION',
  'ADMISSION',
  'CANDIDATE',
  'ENGINE',
  'COMMAND',
  'TARGET',
  'CHAIN',
  'RECEIPT',
  'OBSERVATION',
  'RELEASE',
  'API'
] as const;

/**
 * Codes whose server `message` carries runtime detail that a fixed sentence cannot express
 * (rejected field names, task names, schedule ids, validation violations, kernel failures…).
 * The raw server text is kept next to the localized sentence instead of being dropped.
 */
export const API_ERROR_DETAIL_CODES = [
  'APP_OPERATION_REJECTED',
  'APP_PACKAGE_ID_MISMATCH',
  'APP_UPLOAD_UNTRUSTED_FIELD',
  'CATALOG_INVALID_REQUEST',
  'HARNESS_FAILURE',
  'PACKAGE_PARAMS_INVALID',
  'PACKAGE_REGISTRATION_REJECTED',
  'PACKAGE_REGISTRATION_UNTRUSTED_FIELD',
  'PACKAGE_RUN_REJECTED',
  'PACKAGE_RUN_UNAVAILABLE',
  'PACKAGE_RUN_UNTRUSTED_FIELD',
  'PACKAGE_SNAPSHOT_SOURCE_UNAVAILABLE',
  'PROVIDER_CONNECTION_INVALID_REQUEST',
  'PROVIDER_CONNECTION_PROTECTED',
  'PROVIDER_CONNECTION_UNTRUSTED_FIELD',
  'PROVIDER_DEPENDENCY_MISSING',
  'RUN_AGENT_SETTINGS_INVALID_PROVIDER',
  'RUN_AGENT_SETTINGS_UNAVAILABLE',
  'RUN_AGENT_SETTINGS_UNTRUSTED_FIELD',
  'SCHEDULE_ALREADY_EXISTS',
  'SCHEDULE_NOT_FOUND',
  'SCHEDULE_RULE_INVALID',
  'SCHEDULE_VALIDATION_FAILED',
  'SECRET_BACKEND_UNAVAILABLE'
] as const;

/** Longest matching family prefix for `code` (boundary is `_`), or undefined when no family applies. */
export function errorCodeFamily(code: string): string | undefined {
  let best: string | undefined;
  for (const family of API_ERROR_CODE_FAMILIES) {
    if (code.startsWith(`${family}_`) && (best === undefined || family.length > best.length)) best = family;
  }
  return best;
}

/** Whether the raw server message of `code` is kept as secondary text. */
export function keepsErrorDetail(code: string): boolean {
  return (API_ERROR_DETAIL_CODES as readonly string[]).includes(code);
}
