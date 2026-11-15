/**
 * A calendar's events as text, from `ical.js`'s parse, run in a reader process (`calendar-worker.ts`). Read from
 * each component's properties, never through `ICAL.Event`, whose end for a DURATION walks the start forward a month
 * per step: a duration is said, never added, and a recurrence is said, never expanded. One event the library cannot
 * read is skipped and counted, never the whole file lost. The bounds checked before it are in `calendar.ts`.
 */
import { zonedInstant } from "@louvain/engine-core";
import windowsIana from "windows-iana";

type Time = { toString(): string; isDate: boolean };
type Duration = {
  weeks: number;
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  isNegative: boolean;
};
type Property = {
  getParameter(name: string): unknown;
  getFirstValue(): unknown;
};
type Component = {
  getFirstProperty(name: string): Property | null;
  getFirstPropertyValue(name: string): unknown;
  getAllProperties(name: string): Property[];
  getAllSubcomponents(name: string): Component[];
};
export type Ical = {
  parse(input: string): unknown;
  Component: new (jcal: unknown) => Component;
};

const FREQ: Record<string, string> = {
  DAILY: "daily",
  WEEKLY: "weekly",
  MONTHLY: "monthly",
  YEARLY: "yearly",
  HOURLY: "hourly",
  MINUTELY: "every minute",
  SECONDLY: "every second",
};

const text = (value: unknown): string | null =>
  typeof value === "string" && value.trim() !== "" ? value : null;

/** A date and time in the zone the file wrote it in (`YYYY-MM-DD HH:MM`); a date alone for an all-day event. */
function when(component: Component, name: string): string | null {
  const time = component.getFirstPropertyValue(name) as Time | null;
  if (!time || typeof time.toString !== "function") return null;
  const raw = time.toString();
  if (time.isDate) return raw;
  const [date, clock = ""] = raw.split("T");
  const tzid = component.getFirstProperty(name)?.getParameter("tzid");
  const zone = raw.endsWith("Z") ? "UTC" : typeof tzid === "string" ? tzid : "";
  return `${date} ${clock.slice(0, 5)}${zone ? ` ${zone}` : ""}`;
}

/** "1 week 2 days 1 h 30 min", from the duration's own parts: nothing is added to a date. */
function lasting(duration: Duration): string {
  const parts = [
    duration.weeks ? `${duration.weeks} week${duration.weeks === 1 ? "" : "s"}` : "",
    duration.days ? `${duration.days} day${duration.days === 1 ? "" : "s"}` : "",
    duration.hours ? `${duration.hours} h` : "",
    duration.minutes ? `${duration.minutes} min` : "",
    duration.seconds ? `${duration.seconds} s` : "",
  ].filter(Boolean);
  return `${duration.isNegative ? "minus " : ""}${parts.join(" ") || "no time"}`;
}

/** A mailbox address without its scheme, or the name the file gave it. */
function who(property: Property): string {
  const cn = property.getParameter("cn");
  const value = property.getFirstValue();
  const address = typeof value === "string" ? value.replace(/^mailto:/i, "") : "";
  const name = typeof cn === "string" ? cn : "";
  return name && address ? `${name} <${address}>` : name || address;
}

/**
 * The one event an invite is, as the file states it, or null. What a mail's `invite.ics` shares with a calendar's own
 * event: its UID, its start as an instant (a date alone for an all-day event is that day's UTC midnight; a TZID `Intl`
 * does not know, or a floating time, names no instant), and the organiser's address. A repeating event is a series, not one event, and has none. Sender-written: it only lets two
 * readable records count as one witness (`kg/read/context.ts`), never groups a listing.
 */
/**
 * An IANA zone for a TZID `Intl` does not know: Outlook and Exchange write the Windows name ("Pacific Standard Time"),
 * which CLDR's windowsZones maps to one zone per territory; the world's (`001`) is that name's own. `windows-iana`
 * carries CLDR's table and is loaded only in this reader's process. A name it does not hold (a custom "Customized
 * Time Zone") names nothing: no instant, no invite.
 */
function ianaFor(tzid: string): string | null {
  return windowsIana.findIana(tzid.trim(), "001")[0] ?? null;
}

function inviteOf(component: Component): { uid: string; start: string; organiser: string } | null {
  const uid = text(component.getFirstPropertyValue("uid"))?.trim();
  if (!uid || uid.length > 1000 || component.getFirstPropertyValue("rrule")) return null;
  const organiserValue = component.getFirstProperty("organizer")?.getFirstValue();
  const organiser =
    typeof organiserValue === "string"
      ? organiserValue
          .replace(/^mailto:/i, "")
          .trim()
          .toLowerCase()
      : "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(organiser)) return null;
  const time = component.getFirstPropertyValue("dtstart") as Time | null;
  if (!time || typeof time.toString !== "function") return null;
  const raw = time.toString();
  let at: number | null = null;
  if (time.isDate) at = Date.parse(`${raw}T00:00:00.000Z`);
  else if (raw.endsWith("Z")) at = Date.parse(raw);
  else {
    const tzid = component.getFirstProperty("dtstart")?.getParameter("tzid");
    const [day = "", clock = ""] = raw.split("T");
    if (typeof tzid === "string") {
      at = zonedInstant(day, clock.slice(0, 8), tzid);
      const iana = at === null ? ianaFor(tzid) : null;
      if (iana) at = zonedInstant(day, clock.slice(0, 8), iana);
    }
  }
  if (at === null || Number.isNaN(at)) return null;
  return { uid, start: new Date(at).toISOString(), organiser };
}

function eventBlock(component: Component): string {
  const lines = [text(component.getFirstPropertyValue("summary")) ?? "Untitled event"];
  const start = when(component, "dtstart");
  const end = when(component, "dtend");
  const duration = component.getFirstPropertyValue("duration") as Duration | null;
  if (start) {
    // An end on the same day says only its time; a DURATION is said as one, never turned into an end.
    const sameDay = end && start.length > 10 && start.slice(0, 10) === end.slice(0, 10);
    const until = end && end !== start ? ` – ${sameDay ? end.slice(11) : end}` : "";
    const span =
      !end && duration && typeof duration === "object" ? `, for ${lasting(duration)}` : "";
    lines.push(`When: ${start}${until}${span}`);
  }
  const rule = component.getFirstPropertyValue("rrule") as {
    freq?: string;
    toString(): string;
  } | null;
  if (rule) lines.push(`Repeats: ${FREQ[rule.freq ?? ""] ?? "on a rule"} (${rule.toString()})`);
  const location = text(component.getFirstPropertyValue("location"));
  if (location) lines.push(`Where: ${location}`);
  const organizer = component.getFirstProperty("organizer");
  if (organizer) lines.push(`Organiser: ${who(organizer)}`);
  const attendees = component.getAllProperties("attendee").map(who).filter(Boolean);
  if (attendees.length > 0) lines.push(`Attendees: ${attendees.join(", ")}`);
  const description = text(component.getFirstPropertyValue("description"));
  if (description) lines.push("", description);
  return lines.join("\n");
}

/**
 * The events, one parse per VEVENT: `ical.js` validates a property's value as it parses (an RRULE with an unknown FREQ
 * throws), so one bad event failed the whole file's parse. When that happens each VEVENT block is parsed on its own,
 * and a block that still fails is skipped and counted. Line by line, linear.
 */
function eventsOneByOne(
  ICAL: Ical,
  source: string,
): { roots: Component[]; failed: number; names: string[] } {
  const lines = source.split(/\r?\n/);
  const roots: Component[] = [];
  const names: string[] = [];
  let failed = 0;
  let block: string[] | null = null;
  for (const line of lines) {
    if (/^X-WR-CALNAME:/i.test(line)) names.push(line.slice(line.indexOf(":") + 1).trim());
    if (/^BEGIN:VEVENT\s*$/i.test(line)) block = [line];
    else if (block) {
      block.push(line);
      if (/^END:VEVENT\s*$/i.test(line)) {
        try {
          roots.push(
            new ICAL.Component(
              ICAL.parse(["BEGIN:VCALENDAR", ...block, "END:VCALENDAR", ""].join("\r\n")),
            ),
          );
        } catch {
          // swallowed: this one event is not readable; it is counted in `meta.skipped` and the rest are read.
          failed++;
        }
        block = null;
      }
    }
  }
  return { roots, failed, names };
}

export function readCalendar(
  ICAL: Ical,
  source: string,
  limits: { maxEvents: number; deadline: number },
): { text: string; meta: Record<string, unknown> } {
  const parsed = parsedRoots(ICAL, source);
  const read = eventBlocks(parsed.roots, limits);
  const skipped = parsed.skipped + read.skipped;
  const { events, invite, truncated } = read;
  return {
    text: [...parsed.headings, ...read.headings, ...read.blocks].join("\n\n"),
    meta: {
      events,
      // Only a file of exactly ONE readable event is an invite; one it could not read may have been another.
      ...(invite && events === 1 && skipped === 0 ? { invite } : {}),
      ...(skipped > 0 ? { skipped } : {}),
      ...(truncated ? { truncated: true } : {}),
    },
  };
}

/** The file's calendars, parsed whole, or one event at a time when the whole will not parse. */
function parsedRoots(
  ICAL: Ical,
  source: string,
): { roots: Component[]; skipped: number; headings: string[] } {
  try {
    const parsed = ICAL.parse(source) as unknown[];
    // Two calendars in one file parse to a list of components rather than one.
    const roots = (typeof parsed[0] === "string" ? [parsed] : parsed).map(
      (jcal) => new ICAL.Component(jcal),
    );
    return { roots, skipped: 0, headings: [] };
  } catch (whole) {
    const one = eventsOneByOne(ICAL, source);
    // Nothing read even one event at a time: not a calendar the library can parse (the caller reads it as text).
    if (one.roots.length === 0) throw whole;
    return { roots: one.roots, skipped: one.failed, headings: one.names.filter(Boolean) };
  }
}

/** Each calendar's name and each event's block, in order, up to `maxEvents` and the deadline. */
function eventBlocks(roots: Component[], limits: { maxEvents: number; deadline: number }) {
  const out = {
    headings: [] as string[],
    blocks: [] as string[],
    events: 0,
    skipped: 0,
    truncated: false,
  };
  let invite: ReturnType<typeof inviteOf> = null;
  for (const root of roots) {
    const name = text(root.getFirstPropertyValue("x-wr-calname"));
    if (name) out.headings.push(name);
    for (const component of root.getAllSubcomponents("vevent")) {
      if (out.events >= limits.maxEvents) {
        out.truncated = true;
        break;
      }
      if (Date.now() > limits.deadline) throw new Error("deadline");
      try {
        out.blocks.push(eventBlock(component));
        out.events++;
        invite = out.events === 1 ? inviteOf(component) : null;
      } catch {
        // swallowed: one event the library cannot read (no DTSTART, an unknown RRULE FREQ) is skipped and counted
        // in `meta.skipped`, and the rest of the calendar is still read.
        out.skipped++;
      }
    }
  }
  return { ...out, invite };
}
