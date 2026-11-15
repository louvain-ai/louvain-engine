/**
 * An iCalendar file as the events a person would read in it: each VEVENT a short block (what, when in its own zone,
 * where, who, whether it repeats). `ical.js` owns folding, escaping and recurrence, and its parse is synchronous, so
 * it is bounded twice: the bytes, lines, one unfolded line and a line's parameters are checked first in one linear
 * pass (`calendar-limits.ts`), then the parse runs in a reader process killed at its deadline. A file the library
 * cannot parse at all is read as the text it is.
 */

import {
  MAX_CALENDAR_BYTES,
  MAX_CALENDAR_EVENTS,
  MAX_CALENDAR_LINE,
  MAX_CALENDAR_LINES,
  MAX_CALENDAR_PARAMETERS,
} from "./calendar-limits.js";
import { inWorker, siblingModule } from "./worker.js";
import { WorkerDeadline, WorkerFailed, WorkerOutOfMemory } from "./worker-errors.js";

export class CalendarRefused extends Error {}
export class CalendarDeadline extends Error {
  constructor() {
    super("Reading the calendar took too long");
  }
}

/** The caps, over the raw text, before the library parses it. Linear, one pass. */
function checkBounds(text: string): void {
  let lines = 0;
  let length = 0;
  let parameters = 0;
  // Within one content line: past its first unquoted `:` is the value, where a `;` is text, not a parameter.
  let inValue = false;
  let quoted = false;
  const endLine = () => {
    if (length > MAX_CALENDAR_LINE)
      throw new CalendarRefused("The calendar holds a line too long to be a calendar's");
    lines++;
    if (lines > MAX_CALENDAR_LINES)
      throw new CalendarRefused(
        `The calendar holds more than ${MAX_CALENDAR_LINES.toLocaleString("en")} lines`,
      );
    length = 0;
    parameters = 0;
    inValue = false;
    quoted = false;
  };
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c === 10) {
      // A line break followed by a space or tab is a fold: the same content line goes on.
      const next = text.charCodeAt(i + 1);
      if (next !== 32 && next !== 9) endLine();
      continue;
    }
    length++;
    if (inValue) continue;
    if (c === 34) quoted = !quoted;
    else if (!quoted && c === 58) inValue = true;
    else if (!quoted && c === 59 && ++parameters > MAX_CALENDAR_PARAMETERS)
      throw new CalendarRefused("The calendar holds a line of more parameters than a calendar's");
  }
  endLine();
}

export async function calendarText(
  bytes: Uint8Array,
  decode: (b: Uint8Array) => string,
  deadline: number,
): Promise<{ text: string; meta: Record<string, unknown> }> {
  if (bytes.byteLength > MAX_CALENDAR_BYTES)
    throw new CalendarRefused(
      `The calendar is ${Math.round(bytes.byteLength / 1_048_576)} MB; a calendar is read up to ${MAX_CALENDAR_BYTES / 1_048_576} MB`,
    );
  const source = decode(bytes);
  checkBounds(source);
  try {
    return await inWorker(
      siblingModule("calendar-worker", import.meta.url),
      { source, maxEvents: MAX_CALENDAR_EVENTS, deadline },
      { deadline: deadline },
    );
  } catch (error) {
    if (error instanceof WorkerDeadline) throw new CalendarDeadline();
    if (error instanceof WorkerOutOfMemory) throw new CalendarRefused(error.message);
    if (error instanceof WorkerFailed && error.unparsable)
      return { text: source, meta: { readAs: "text" } };
    // Its own check between events ran out of time; anything else that stopped the reader is a damaged read.
    if (error instanceof WorkerFailed && error.message === "deadline") throw new CalendarDeadline();
    throw error;
  }
}
