/** What a calendar may hold before `ical.js` sees it, each checked in one linear pass over the bytes. */

/** A calendar larger than this is not a calendar a person wrote: a feed export of years. Bytes. */
export const MAX_CALENDAR_BYTES = 8 * 1024 * 1024;

/** Content lines (a folded line counts once). */
export const MAX_CALENDAR_LINES = 100_000;

/** One property after unfolding: a description is a few kilobytes; a megabyte line is built to hurt a parser. */
export const MAX_CALENDAR_LINE = 256 * 1024;

/**
 * Parameters on one line (`;` before its value): an ATTENDEE line has a handful. The library finds each one's end by
 * scanning to the value, so its cost is the file's size times this; 64 keeps the worst case well inside the deadline.
 */
export const MAX_CALENDAR_PARAMETERS = 64;

export const MAX_CALENDAR_EVENTS = 1_000;
