/**
 * The calendar parse in a process of its own (`calendar.ts` runs it through `inWorker`, which kills it at the deadline
 * and caps its heap). Its input is bounded before it is sent here; this only parses and reads.
 */
import ICAL from "ical.js";
import { type Ical, readCalendar } from "./calendar-read.js";
import { serveReader } from "./worker.js";

serveReader(
  ({ source, maxEvents, deadline }: { source: string; maxEvents: number; deadline: number }) =>
    readCalendar(ICAL as unknown as Ical, source, { maxEvents, deadline }),
  // Not a calendar the library can parse at all, as against a reader that ran out of time.
  (error) => !(error instanceof Error && error.message === "deadline"),
);
