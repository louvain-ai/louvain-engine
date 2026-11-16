/** What an event's row stores beside the event itself: how precise its time is. */
import type { Revision } from "./revision.js";

/**
 * How much of `occurredAt` the source knows, as the row stores it: NULL for an instant — what
 * every existing row and every connector that declares nothing means — else `day`, `month`, `year` or `unknown`.
 * Every insert writes it: one event's row (`insertRevisionRow`) and a build's own.
 */
export function occurredPrecisionOf(ev: Pick<Revision, "occurredPrecision">): string | null {
  return ev.occurredPrecision === undefined || ev.occurredPrecision === "instant"
    ? null
    : ev.occurredPrecision;
}
