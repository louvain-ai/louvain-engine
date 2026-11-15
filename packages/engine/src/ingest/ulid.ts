import { randomBytes } from "node:crypto";

/**
 * A ULID the ingest contract accepts: 26 characters of Crockford base32, the ten leading ones the event's placement. A
 * withdrawal reaches every event of its record placed no later than its own millisecond, so a replacement mints the
 * withdrawal first and the new content strictly later. The entropy is `crypto`'s, because an event id is also a row
 * key.
 */
export function ulid(now = Date.now()): string {
  const bytes = randomBytes(16);
  let rand = "";
  for (let i = 0; i < 16; i++) rand += CROCKFORD[(bytes[i] as number) % 32];
  return encodeTime(now) + rand;
}

/** The base32 alphabet a ULID is written in. */
export const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function encodeTime(ms: number): string {
  let out = "";
  let t = ms;
  for (let i = 0; i < 10; i++) {
    out = CROCKFORD[t % 32] + out;
    t = Math.floor(t / 32);
  }
  return out;
}
