import { errorCodeFamily, keepsErrorDetail } from './error-codes';
import { t } from './i18n';

/** What an error renderer needs: the localized sentence, plus raw server detail when it is kept. */
export interface ErrorDisplay {
  text: string;
  detail?: string;
}

/** Reads a non-empty string field (`code` / `message`) from an arbitrary error-ish value. */
function field(value: unknown, key: 'code' | 'message'): string | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const found = (value as Record<string, unknown>)[key];
  return typeof found === 'string' && found.length > 0 ? found : undefined;
}

/**
 * Localized display text for a server-reported error.
 *
 * Resolution order: exact `errors.<CODE>` sentence → longest `errors._<FAMILY>` fallback → the raw
 * server message (unregistered codes keep their English text so new codes never render as a bare key).
 * Codes marked in `API_ERROR_DETAIL_CODES` (and every family hit) also keep the raw server message as
 * `detail`, because their text carries runtime facts a fixed sentence cannot express.
 */
export function errorDisplay(error: unknown): ErrorDisplay {
  if (error === null || error === undefined) return { text: '' };
  const code = field(error, 'code');
  const serverMessage = field(error, 'message') ?? (error instanceof Error ? error.message : undefined);
  if (code === undefined) return { text: serverMessage ?? String(error) };

  const exactKey = `errors.${code}`;
  const exact = t(exactKey);
  if (exact !== exactKey) {
    const detail = keepsErrorDetail(code) && serverMessage !== undefined && serverMessage !== exact ? serverMessage : undefined;
    return detail === undefined ? { text: exact } : { text: exact, detail };
  }
  const family = errorCodeFamily(code);
  if (family !== undefined) {
    const familyKey = `errors._${family}`;
    const familyText = t(familyKey);
    if (familyText !== familyKey) return serverMessage === undefined ? { text: familyText } : { text: familyText, detail: serverMessage };
  }
  return { text: serverMessage ?? code };
}

/** Convenience wrapper for call sites that only need the sentence. */
export function errorText(error: unknown): string {
  return errorDisplay(error).text;
}
