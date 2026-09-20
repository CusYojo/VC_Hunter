export interface PublicationWindow { start: string; end: string; }
const DAY_MS = 86_400_000;
const SHANGHAI_OFFSET_MS = 8 * 3_600_000;

/** Reject relative/ambiguous dates; date-only news is a Shanghai calendar date. */
export function normalizeNewsPublishedAt(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2}))?$/.test(text)) return null;
  if (text.length > 10 && Number(text.slice(11, 13)) > 23) return null;
  const day = text.slice(0, 10);
  const calendar = Date.parse(`${day}T00:00:00.000Z`);
  if (!Number.isFinite(calendar) || new Date(calendar).toISOString().slice(0, 10) !== day) return null;
  const timestamp = Date.parse(text.length === 10 ? `${text}T00:00:00+08:00` : text);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

export function publicationWindowForDay(observedAt: string): PublicationWindow {
  const timestamp = Date.parse(observedAt);
  if (!Number.isFinite(timestamp)) throw new Error("Invalid news observation time.");
  const start = Math.floor((timestamp + SHANGHAI_OFFSET_MS) / DAY_MS) * DAY_MS - SHANGHAI_OFFSET_MS;
  return { start: new Date(start).toISOString(), end: new Date(start + DAY_MS).toISOString() };
}

export function isPublishedInWindow(value: string | null | undefined, window: PublicationWindow): boolean {
  const normalized = normalizeNewsPublishedAt(value);
  return normalized !== null && normalized >= window.start && normalized < window.end;
}
