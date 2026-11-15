/**
 * A date or time number format drawn for the grid: day, month and year names, a 12- or 24-hour clock, and `m` as
 * minutes beside an hour or a second. Elapsed time (`[h]`) and fractional seconds are null, never a guess.
 */

/** Whether a section draws a date or time: a y/d/h/s token, or an m that is not inside quotes or brackets. */
export function isDateSection(section: string): boolean {
  const tokens = section
    .replace(/"[^"]*"/g, "")
    .replace(/\\./g, "")
    .replace(/\[[^\]]*\]/g, "")
    .toLowerCase();
  return /[ymdhs]/.test(tokens.replace(/am\/pm|a\/p/g, "")) || /am\/pm|a\/p/.test(tokens);
}

/** `serial` drawn by a date or time section, or null for a negative serial or a section this does not draw. */
export function drawDate(serial: number, section: string, date1904: boolean): string | null {
  if (serial < 0) return null;
  const tokens = dateTokens(section);
  if (!tokens) return null;
  const epoch = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
  const at = new Date(epoch + Math.round(serial * 86_400) * 1000);
  if (Number.isNaN(at.getTime())) return null;
  const clock: Clock = {
    at,
    twelve: tokens.some((t) => t.kind === "ampm"),
    hour: at.getUTCHours(),
    kinds: tokens.map((t) => t.kind),
  };
  return tokens.map((t, i) => drawToken(t, i, clock)).join("");
}

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

type DateToken =
  | { kind: "literal"; text: string }
  | { kind: "y" | "m" | "d" | "h" | "s" | "ampm"; n: number };

/** A date or time section as tokens, or null for what this does not draw (elapsed time, fractional seconds). */
function dateTokens(section: string): DateToken[] | null {
  const out: DateToken[] = [];
  for (let i = 0; i < section.length; i++) {
    const c = section.charAt(i);
    const lower = c.toLowerCase();
    if (c === '"') {
      const close = section.indexOf('"', i + 1);
      if (close < 0) return null;
      out.push({ kind: "literal", text: section.slice(i + 1, close) });
      i = close;
    } else if (c === "\\") {
      out.push({ kind: "literal", text: section.charAt(i + 1) });
      i++;
    } else if (c === "_" || c === "*") i++;
    else if (c === "[") {
      const close = section.indexOf("]", i + 1);
      if (close < 0) return null;
      const inner = section.slice(i + 1, close);
      // A locale (`[$-409]`) or a colour changes nothing drawn here; elapsed time (`[h]`) is not a clock.
      if (/^[hms]+$/i.test(inner)) return null;
      i = close;
    } else if (/^am\/pm/i.test(section.slice(i, i + 5))) {
      out.push({ kind: "ampm", n: 5 });
      i += 4;
    } else if (/^a\/p/i.test(section.slice(i, i + 3))) {
      out.push({ kind: "ampm", n: 1 });
      i += 2;
    } else if ("ymdhs".includes(lower)) {
      let n = 1;
      while (section.charAt(i + n).toLowerCase() === lower) n++;
      out.push({ kind: lower as "y" | "m" | "d" | "h" | "s", n });
      i += n - 1;
    } else if (c === "." && section.charAt(i + 1) === "0") return null;
    else out.push({ kind: "literal", text: c });
  }
  return out;
}

const pad2 = (n: number): string => String(n).padStart(2, "0");

type Clock = { at: Date; twelve: boolean; hour: number; kinds: DateToken["kind"][] };

function drawToken(t: DateToken, i: number, clock: Clock): string {
  const { at, hour } = clock;
  switch (t.kind) {
    case "literal":
      return t.text;
    case "y":
      return t.n <= 2 ? pad2(at.getUTCFullYear() % 100) : String(at.getUTCFullYear());
    case "d":
      return dayText(at, t.n);
    case "m":
      return isMinute(clock.kinds, i, t.n) ? count(at.getUTCMinutes(), t.n) : monthText(at, t.n);
    case "h":
      return count(clock.twelve ? hour % 12 || 12 : hour, t.n);
    case "s":
      return count(at.getUTCSeconds(), t.n);
    case "ampm":
      return t.n === 5 ? (hour < 12 ? "AM" : "PM") : hour < 12 ? "A" : "P";
  }
}

/** `m` is minutes beside an hour before it or a second after it, and a month otherwise. */
function isMinute(kinds: DateToken["kind"][], i: number, n: number): boolean {
  const before = kinds
    .slice(0, i)
    .filter((k) => k !== "literal")
    .pop();
  const after = kinds.slice(i + 1).find((k) => k !== "literal");
  return n <= 2 && (before === "h" || after === "s");
}

const count = (value: number, n: number): string => (n === 1 ? String(value) : pad2(value));

function dayText(at: Date, n: number): string {
  const day = at.getUTCDate();
  const name = DAYS[at.getUTCDay()] ?? "";
  return n === 1 ? String(day) : n === 2 ? pad2(day) : n === 3 ? name.slice(0, 3) : name;
}

function monthText(at: Date, n: number): string {
  const month = at.getUTCMonth();
  const name = MONTHS[month] ?? "";
  return n === 1
    ? String(month + 1)
    : n === 2
      ? pad2(month + 1)
      : n === 3
        ? name.slice(0, 3)
        : n === 4
          ? name
          : name.charAt(0);
}
