/**
 * How much an archive may inflate to, decided from its central directory before a byte is inflated. The caller's
 * byte cap is on the compressed file, the one number a zip bomb keeps small, so each limit is on what the members
 * declare, and the inflater holds every member to its declaration. A refusal is a fact about the file (`too-large`),
 * never an exception that stalls a feed.
 */

/**
 * A member may declare at most 64 MiB; one over 1 MiB at most 200× its compressed size (real Office XML compresses
 * 5–20×, deflate tops out near 1,032×, so 200× is a bomb's shape); the members a reader asks for at most 256 MiB.
 */
export const ZIP_LIMITS = {
  MAX_ENTRY_BYTES: 64 * 1024 * 1024,
  RATIO_FLOOR_BYTES: 1024 * 1024,
  MAX_RATIO: 200,
  MAX_TOTAL_BYTES: 256 * 1024 * 1024,
} as const;

/**
 * A member is inflated only to `maxChars × 24` bytes: markup costs tens of bytes per character of text, and text
 * past that point is text the caller's character cap throws away.
 */
export const MARKUP_BYTES_PER_CHAR = 24;

/** A refusal the caller records as `too-large`; the message is the sentence a person reads. */
export class DecompressionRefused extends Error {}

/** A byte count as whole megabytes, for the sentence a refusal shows. */
export const mib = (bytes: number): string => `${Math.round(bytes / 1_048_576)} MB`;
