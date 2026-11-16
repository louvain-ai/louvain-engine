import { createHash } from "node:crypto";
import type { Span } from "@louvain/engine-core";

/**
 * Small pure helpers every mailbox package shares: finding a model's quote in the record, comparing
 * names and values, reading dates, and reading a model's JSON reply without trusting it.
 */

// ———————————————————————————— quotes → spans ————————————————————————————

/** What a model changes when it "copies" text: runs of whitespace, curly quotes, dashes, ellipses. */
function foldChar(ch: string): string {
  if (/\s/.test(ch)) return " ";
  if (ch === "‘" || ch === "’" || ch === "‚" || ch === "′") return "'";
  if (ch === "“" || ch === "”" || ch === "„" || ch === "″") return '"';
  if (ch === "–" || ch === "—" || ch === "‑") return "-";
  return ch;
}

/** The text folded, with each folded character's offset in the original. Whitespace runs collapse to one. */
function folded(text: string, from = 0, to = text.length): { chars: string; offsets: number[] } {
  let chars = "";
  const offsets: number[] = [];
  let lastSpace = false;
  for (let i = from; i < to; i += 1) {
    const f = foldChar(text[i] as string);
    if (f === " ") {
      if (lastSpace) continue;
      lastSpace = true;
    } else lastSpace = false;
    chars += f;
    offsets.push(i);
  }
  return { chars, offsets };
}

/**
 * Where a quote sits in the record, found by code — never taken from the model.
 *
 * Exact first; then with whitespace collapsed and typographic quotes and dashes folded, which is what a
 * model changes when it copies a sentence out of a wrapped mail. Searched only inside `within` (the
 * message's own words), so a quote from quoted history or an earlier message is not found. Returns null
 * when the quote is not there: the caller drops the statement rather than citing text nobody wrote.
 */
export function locateQuote(text: string, quote: string, within?: Span): Span | null {
  const from = within?.start ?? 0;
  const to = within?.end ?? text.length;
  const q = quote.trim().replace(/^["'“”‘’]+|["'“”‘’]+$/g, "");
  if (q.length === 0) return null;
  const exact = text.slice(from, to).indexOf(q);
  if (exact >= 0) return { start: from + exact, end: from + exact + q.length };
  const hay = folded(text, from, to);
  const needle = folded(q).chars.trim();
  if (needle.length === 0) return null;
  const at = hay.chars.indexOf(needle);
  if (at < 0) return null;
  const start = hay.offsets[at] as number;
  const last = hay.offsets[at + needle.length - 1] as number;
  return { start, end: last + 1 };
}

export const spanInside = (inner: Span, outer: Span | null | undefined): boolean =>
  !!outer && inner.start >= outer.start && inner.end <= outer.end;

// ———————————————————————————— names and values ————————————————————————————

/** Lower-cased letter/number tokens of a name, accents folded, one-letter tokens dropped. */
export const nameTokens = (s: string): string[] =>
  s
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N} ]+/gu, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1);

/**
 * Two names name the same thing when every token of one is in the other: "Alex" and "Alex Rivera" agree,
 * "James Ferguson" and "Alex Rivera" do not. Corporate suffixes are ignored ("Northwind Health Ltd" and
 * "Northwind Health"). An empty name agrees with nothing.
 */
export function namesAgree(a: string, b: string): boolean {
  const strip = (tokens: string[]) => tokens.filter((t) => !CORPORATE.has(t));
  const x = strip(nameTokens(a));
  const y = strip(nameTokens(b));
  if (x.length === 0 || y.length === 0) return false;
  return x.every((t) => y.includes(t)) || y.every((t) => x.includes(t));
}

const CORPORATE: ReadonlySet<string> = new Set([
  "ltd",
  "limited",
  "inc",
  "llc",
  "plc",
  "corp",
  "corporation",
  "co",
  "company",
  "gmbh",
  "pty",
  "the",
]);

/** A literal as compared: case, whitespace and punctuation other than digits' separators folded. */
export const normaliseLiteral = (s: string): string =>
  s
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[_\-–—]+/g, " ")
    .replace(/[^\p{L}\p{N}.$£€% ]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

/** An enum value as a model may write it ("Legal review", "legal-review") onto the declared spelling. */
export function matchEnum(value: string, allowed: readonly string[]): string | null {
  const want = normaliseLiteral(value).replace(/ /g, "_");
  return allowed.find((a) => normaliseLiteral(a).replace(/ /g, "_") === want) ?? null;
}

/** Digits of a money amount with k/m multipliers applied, for comparing "$410k" with "410,000". */
export function moneyAmount(s: string): number | null {
  const m = /(\d[\d,]*(?:\.\d+)?)\s*(k|m|bn|million|thousand|billion)?/i.exec(s);
  if (!m) return null;
  const n = Number((m[1] as string).replace(/,/g, ""));
  if (!Number.isFinite(n)) return null;
  const unit = (m[2] ?? "").toLowerCase();
  const mult =
    unit === "k" || unit === "thousand"
      ? 1e3
      : unit === "m" || unit === "million"
        ? 1e6
        : unit === "bn" || unit === "billion"
          ? 1e9
          : 1;
  return n * mult;
}

/**
 * A money amount WITH THE THINGS THAT MAKE IT COMPARABLE, or null.
 *
 * `moneyAmount` above answers "is this the same figure as that one", which is all the verifier needs.
 * Arithmetic needs more: £410k/yr and $410k/yr are the same digits and not the same value, and adding
 * a yearly figure to a one-off is not a total of anything. So an aggregate asks for this, and refuses
 * where the parts disagree rather than returning a number nobody should trust.
 *
 * `currency` is the symbol or ISO code as written, normalised to a code where the symbol is unambiguous;
 * an amount with no currency at all is its own class and only combines with others of the same. `period`
 * likewise: `null` is a one-off, and it never silently matches `year`.
 */
export function moneyValue(
  s: string,
): { amount: number; currency: string | null; period: string | null } | null {
  const amount = moneyAmount(s);
  if (amount === null) return null;
  const SYMBOL: Record<string, string> = { $: "USD", "£": "GBP", "€": "EUR", "¥": "JPY" };
  const symbol = /[$£€¥]/.exec(s)?.[0];
  const code = /\b(USD|GBP|EUR|JPY|AUD|NZD|CAD|CHF|SEK|NOK|DKK|INR|SGD|HKD)\b/i.exec(s)?.[1];
  const currency = code ? code.toUpperCase() : symbol ? (SYMBOL[symbol] as string) : null;
  const period =
    /\/\s*(yr|year|y|a|annum)\b|\bper\s+(year|annum)\b|\bp\.?a\.?\b|\bannual(ly)?\b|\bARR\b/i.test(
      s,
    )
      ? "year"
      : /\/\s*(mo|month|m)\b|\bper\s+month\b|\bmonthly\b|\bMRR\b/i.test(s)
        ? "month"
        : /\/\s*(qtr|quarter|q)\b|\bper\s+quarter\b|\bquarterly\b/i.test(s)
          ? "quarter"
          : null;
  return { amount, currency, period };
}

/** Whether two money values may be added or ordered: same currency, same period. */
export const comparableMoney = (
  a: { currency: string | null; period: string | null },
  b: { currency: string | null; period: string | null },
): boolean => a.currency === b.currency && a.period === b.period;

// ———————————————————————————— dates ————————————————————————————

/**
 * A calendar date as `YYYY-MM-DD`, or null. A date is only a date with a four-digit year in it: a runtime
 * parser completes "September 16, 75" to 1975, and a century guessed is a fact invented.
 */
export function isoDate(v: string): string | null {
  const t = v.trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:$|[T ])/.exec(t);
  if (m) {
    const d = new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00Z`);
    return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== `${m[1]}-${m[2]}-${m[3]}`
      ? null
      : `${m[1]}-${m[2]}-${m[3]}`;
  }
  if (!/(?<!\d)\d{4}(?!\d)/.test(t)) return null;
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

/**
 * The UTC offset a local time in this message means ("+12:00", "Z"). Timestamps come back from the database in
 * UTC, so the offset written in the ISO string says nothing about where the message was written: the mailbox's
 * configured `timeZone` does. Without one, the string's own offset.
 */
export function offsetOf(iso: string, timeZone?: string): string {
  if (timeZone && timeZone !== "UTC") {
    const d = new Date(iso);
    if (!Number.isNaN(d.getTime())) {
      const name =
        new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longOffset" })
          .formatToParts(d)
          .find((p) => p.type === "timeZoneName")?.value ?? "";
      const m = /GMT([+-]\d{2}:\d{2})/.exec(name);
      return m ? (m[1] as string) : "Z";
    }
  }
  const m = /(Z|[+-]\d{2}:?\d{2})$/.exec(iso.trim());
  return m ? (m[1] as string) : "Z";
}

/**
 * A full ISO datetime, or null. A bare date is midnight UTC; a local time with no offset ("2026-09-17T15:00",
 * what a model writes for "Thursday 3pm") takes `offset` — the message's own zone — rather than the zone of
 * whatever machine happens to parse it.
 */
export function isoDateTime(v: string, offset = "Z"): string | null {
  const t = v.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return isoDate(t) ? `${t}T00:00:00Z` : null;
  if (!/(?<!\d)\d{4}(?!\d)/.test(t)) return null;
  const local = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(t);
  const d = new Date(local ? `${t.replace(" ", "T")}${offset}` : t);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * "2026-09-14 (Monday)" — what a model resolves "on Thursday" against. The date is the message's OWN local
 * date (the one its timestamp is written in), not UTC: a Thursday-morning mail in Auckland is still Thursday.
 */
export function dayLabel(iso: string, timeZone?: string): string {
  if (timeZone && timeZone !== "UTC") {
    const d = new Date(iso);
    if (!Number.isNaN(d.getTime())) {
      const parts = Object.fromEntries(
        new Intl.DateTimeFormat("en-GB", {
          timeZone,
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          weekday: "long",
          hourCycle: "h23",
        })
          .formatToParts(d)
          .map((p) => [p.type, p.value]),
      );
      return `${parts.year}-${parts.month}-${parts.day} (${parts.weekday}) ${parts.hour}:${parts.minute} UTC${offsetOf(iso, timeZone).replace("Z", "+00:00")}`;
    }
  }
  const local = /^(\d{4}-\d{2}-\d{2})/.exec(iso.trim())?.[1];
  const d = new Date(local ? `${local}T12:00:00Z` : iso);
  if (Number.isNaN(d.getTime())) return iso;
  const day = d.toLocaleDateString("en-GB", { weekday: "long", timeZone: "UTC" });
  return `${d.toISOString().slice(0, 10)} (${day})`;
}

// ———————————————————————————— model replies ————————————————————————————

/**
 * The JSON object in a model's reply, or null. Tolerates a reasoning block, a code fence and prose around
 * the object; never repairs the JSON itself — a reply that is not JSON is dropped, not guessed at.
 */
export function parseModelJson(raw: string): unknown {
  const body = raw
    .replace(/^[\s\S]*?<\/think>/i, "")
    .replace(/```(?:json)?/gi, "")
    .trim();
  try {
    return JSON.parse(body);
  } catch {
    // swallowed: a reply with prose around the object is expected; the outermost braces are tried next.
  }
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(body.slice(start, end + 1));
  } catch {
    // swallowed: an unreadable reply is dropped, never guessed at; the caller counts it and retries once.
    return null;
  }
}

/**
 * The statements a cut-off reply finished. A reply that reached its token budget ends mid-object, and as JSON it is
 * nothing — so a dense document section that said a great deal used to come back as nothing at all, and the
 * corrective retry, at the same budget, was cut off the same way (measured on an ERB pull request: 2 × 4,000 output
 * tokens, no statements). Every element of the `statements` array that CLOSED before the cut is a complete,
 * well-formed statement, exactly as the model wrote it; the one it was writing when it stopped is dropped. Scans the
 * text once, honouring strings and escapes; null when there is no `statements` array or nothing in it closed. Pure.
 */
export function salvageStatements(raw: string): unknown[] | null {
  const key = raw.search(/"statements"\s*:\s*\[/);
  if (key < 0) return null;
  const open = raw.indexOf("[", key);
  const out: unknown[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;
  for (let i = open + 1; i < raw.length; i += 1) {
    const c = raw[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === "{") {
      if (depth === 0) start = i;
      depth += 1;
    } else if (c === "}") {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        try {
          out.push(JSON.parse(raw.slice(start, i + 1)));
        } catch {
          // swallowed: an element that does not parse is not a statement; the elements around it still are.
        }
        start = -1;
      }
    } else if (c === "]" && depth === 0) break;
  }
  return out.length > 0 ? out : null;
}

export const isObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);

export const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

export function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

/**
 * A step's fingerprint for the ledger: a hash of its prompt text and of the functions that build the model's turn,
 * so an edited prompt or turn is a new run rather than a cached answer to the old one.
 */
export function fingerprint(...parts: (string | ((...args: never[]) => unknown))[]): string {
  const hash = createHash("sha256");
  for (const part of parts)
    hash.update(typeof part === "string" ? part : part.toString()).update("\0");
  return hash.digest("hex").slice(0, 16);
}
