import ICAL from "ical.js";
import { MAX_CALENDAR_EVENTS } from "../src/calendar-limits.js";
import { type Ical, readCalendar } from "../src/calendar-read.js";

export type CalendarArithmetic = {
  /** Occurrences a recurrence produced (`RecurIterator.next`): expanding a rule. */
  occurrences: number;
  /** Durations added to a time (`Time.addDuration`): computing an end. */
  durationsAdded: number;
  /** Months a time is walked through (`Time.daysInMonth`, once per step of `Time.adjust`). */
  months: number;
};

/**
 * What a calendar read computed, counted and not timed. The same `readCalendar` the reader process runs, here in
 * this process with `ical.js`'s date arithmetic counted while it reads. A recurrence expanded is occurrences; an end
 * computed from a duration is a duration added and then a walk of months (a duration of absurd length hangs there).
 * Deterministic, so "said, never computed" is a count compared with an ordinary event's, never a ratio of milliseconds
 * a loaded runner stretches.
 */
export function calendarArithmetic(file: Uint8Array | string): CalendarArithmetic {
  const source = typeof file === "string" ? file : new TextDecoder().decode(file);
  const counts: CalendarArithmetic = { occurrences: 0, durationsAdded: 0, months: 0 };
  const iterator = ICAL.RecurIterator.prototype;
  const time = ICAL.Time.prototype;
  const { next } = iterator;
  const { addDuration } = time;
  const { daysInMonth } = ICAL.Time;
  iterator.next = function (
    this: InstanceType<typeof ICAL.RecurIterator>,
    ...args: Parameters<typeof next>
  ) {
    counts.occurrences++;
    return next.apply(this, args);
  };
  time.addDuration = function (
    this: InstanceType<typeof ICAL.Time>,
    ...args: Parameters<typeof addDuration>
  ) {
    counts.durationsAdded++;
    return addDuration.apply(this, args);
  };
  ICAL.Time.daysInMonth = (...args: Parameters<typeof daysInMonth>) => {
    counts.months++;
    return daysInMonth(...args);
  };
  try {
    readCalendar(ICAL as unknown as Ical, source, {
      maxEvents: MAX_CALENDAR_EVENTS,
      deadline: Number.POSITIVE_INFINITY,
    });
  } finally {
    iterator.next = next;
    time.addDuration = addDuration;
    ICAL.Time.daysInMonth = daysInMonth;
  }
  return counts;
}
