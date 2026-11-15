/** What a reading may spend when the caller names no limit; the character cap stops a real document long before. */

export const DEFAULT_MAX_BYTES = 32 * 1024 * 1024;

export const DEFAULT_MAX_CHARS = 1_000_000;

/** Pages of a PDF read when the caller names no cap; the character cap stops a real document long before. */
export const DEFAULT_MAX_PAGES = 1_000;

export const DEFAULT_DEADLINE_MS = 30_000;
