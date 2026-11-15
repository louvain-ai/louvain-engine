import type { Source } from "./source.js";

/** A document's first non-empty line, bounded: its subject or title in this corpus. */
export const firstLine = (text: string): string =>
  (text.split("\n").find((l) => l.trim().length > 0) ?? "").trim().slice(0, 300) || "(no subject)";

/** A chat has no title; a mail's is its `Subject:` line; any other document's is its first line. */
export function titleOf(source: Source, text: string): string | undefined {
  if (source === "slack") return undefined;
  if (source === "gmail")
    return /^Subject:[ \t]*(\S.*)$/m.exec(text)?.[1]?.trim().slice(0, 300) ?? firstLine(text);
  return firstLine(text);
}

export const UNDATED = "2026-01-01T12:00:00.000Z";

/**
 * The date a file's name carries and how much of it is known: a mail's or a transcript's day (noon is ours), a
 * `-20xx` suffix's year (mid-year is ours), or nothing, which is said as `unknown`.
 */
export function occurredAt(
  source: Source,
  slug: string,
): { at: string; precision: "day" | "year" | "unknown" } {
  const day = (m: RegExpExecArray | null) => (m ? `${m[1]}-${m[2]}-${m[3]}T12:00:00.000Z` : null);
  const year = (m: RegExpExecArray | null) => (m ? `${m[1]}-06-30T12:00:00.000Z` : null);
  const byDay = source === "gmail" || source === "fireflies";
  const iso =
    source === "gmail"
      ? day(/^(\d{4})(\d{2})(\d{2})-/.exec(slug))
      : source === "fireflies"
        ? day(/^(\d{4})-(\d{2})-(\d{2})-/.exec(slug))
        : year(/-(20[2-3]\d)$/.exec(slug));
  if (iso && !Number.isNaN(Date.parse(iso))) return { at: iso, precision: byDay ? "day" : "year" };
  return { at: UNDATED, precision: "unknown" };
}

/** Who wrote it, where the document says: a mail's sender by name, else address; a channel's first speaker. */
export function authorOf(source: Source, text: string): string | undefined {
  if (source === "gmail") {
    const m = /^From:\s*(.*?)\s*<([^>]+)>/m.exec(text);
    const name = m?.[1]?.trim() ?? "";
    if (m?.[2])
      return (name && name.length <= 200 ? name : m[2].trim().toLowerCase()).slice(0, 200);
  }
  if (source === "slack") return /^([a-z0-9._-]{1,40}): /m.exec(text)?.[1];
  return undefined;
}
