/**
 * A WALL-CLOCK TIME IN A ZONE: `zonedInstant(day, clock, zone)` is the instant a wall-clock time names in a zone (an
 * invite's DTSTART with a TZID). The zone is always an ARGUMENT, never read from ambient state here; pure `Intl`.
 */

const clocks = new Map<string, Intl.DateTimeFormat>();
/** A zone's offset from UTC at an instant, in ms: its wall clock then, read as UTC, minus the instant. */
function offsetAt(ms: number, timeZone: string): number {
  let f = clocks.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    if (clocks.size >= 1_000) clocks.clear();
    clocks.set(timeZone, f);
  }
  const parts = f.formatToParts(ms);
  const part = (name: string) => Number(parts.find((p) => p.type === name)?.value);
  const wall = Date.UTC(
    part("year"),
    part("month") - 1,
    part("day"),
    part("hour"),
    part("minute"),
    part("second"),
  );
  return wall - Math.floor(ms / 1_000) * 1_000;
}
/**
 * The instant `YYYY-MM-DD` `HH:MM[:SS]` names in a zone, or null for a zone `Intl` does not know (a Windows name such
 * as "Pacific Standard Time"). As RFC 5545 reads a local time: one that occurs twice (the hour a change repeats) is the
 * EARLIER instant, and one a change skips is read with the offset in force BEFORE the change. The two candidates are
 * the offsets a day either side, since no zone changes twice in a day.
 */
export function zonedInstant(day: string, clock: string, timeZone: string): number | null {
  const wall = Date.parse(`${day}T${clock.length === 5 ? `${clock}:00` : clock}Z`);
  if (Number.isNaN(wall)) return null;
  try {
    const before = offsetAt(wall - 86_400_000, timeZone);
    const after = offsetAt(wall + 86_400_000, timeZone);
    const real = [wall - before, wall - after].filter((t) => offsetAt(t, timeZone) === wall - t);
    return real.length > 0 ? Math.min(...real) : wall - before;
  } catch {
    // swallowed: an unknown zone names no instant; the caller treats it as unknown.
    return null;
  }
}
