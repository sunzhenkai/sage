/**
 * Time and byte formatting (spec §4.2, §9.3).
 * - full time: locale medium date + short time;
 * - short time: locale two-digit hour + minute;
 * - list rows: fixed `MM-DD HH:mm` (full time via dateTime/title or detail pages).
 */

export function formatFullTime(iso: string | number | Date, locale: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
}

export function formatShortTime(iso: string | number | Date, locale: string): string {
  return new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}

function pad2(value: number): string {
  return value.toString().padStart(2, "0");
}

/** Fixed locale-independent `MM-DD HH:mm` for dense list rows. */
export function formatListTime(iso: string | number | Date): string {
  const date = new Date(iso);
  return `${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

/** Asset byte sizes (spec §9.3): < 1 KiB → B, < 1 MiB → KB, else MB. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Chat artifact sizes (spec §6.7): always KB, minimum 1 KB. */
export function formatArtifactKB(bytes: number): string {
  return `${Math.max(1, Math.ceil(bytes / 1024))} KB`;
}
