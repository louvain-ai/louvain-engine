/**
 * What one item does to its collection, decided from what was read and what is held, reading nothing: unchanged,
 * added, updated in place or moved to another folder, or skipped with the reason a person reads. A source that sends
 * changes never takes a replay or a revision older than the one held.
 */

import type { Held } from "./holdings-types.js";
import { type ContentItem, itemRevision, revisionProblem } from "./item-event.js";
import type { Read } from "./item-read.js";
import { replays } from "./retired.js";
import type { Revision } from "./revision.js";
import type { Run, Stored, Version } from "./run-state.js";

export function decide(run: Run, item: ContentItem, read: Read, stored: Stored): Change {
  const { held } = stored;
  if ("skipped" in read) return skipped(item.key, read.skipped, read.reader);
  if (held && held.latest.revision === read.revision && held.latest.container === read.place)
    return { kind: "unchanged", item, version: read, held };
  const stale = run.sendsChanges ? staleness(item, read, stored) : null;
  if (stale) return skipped(item.key, stale);
  const event = revisionFor(run, item, read);
  if ("problem" in event) return skipped(item.key, event.problem);
  if (!held) return { kind: "added", item, version: read, event: event.revision };
  const moved = held.latest.container !== read.place;
  return { kind: "updated", item, version: read, held, event: event.revision, moved };
}

/** One item's change, or the skip that says why it made none. */
export type Change =
  | { kind: "skipped"; skipped: { key: string; why: string; reader?: string } }
  | { kind: "unchanged"; item: ContentItem; version: Version; held: Held }
  | { kind: "added"; item: ContentItem; version: Version; event: Revision }
  | Updated;

/** A change that keeps a revision. */
export type Changed = Exclude<Change, { kind: "skipped" }>;

/** A held item's new revision: in place, or `moved` to another folder of the collection. */
export type Updated = {
  kind: "updated";
  item: ContentItem;
  version: Version;
  held: Held;
  event: Revision;
  moved: boolean;
};

const skipped = (key: string, why: string, reader?: string): Change => ({
  kind: "skipped",
  skipped: { key, why, ...(reader ? { reader } : {}) },
});

/** Why an arrival from a source that sends changes is stale, or null: a replay, or older than what is held. */
function staleness(item: ContentItem, version: Version, { held, retired }: Stored): string | null {
  const at = item.updated ?? item.date;
  const stated = at ? new Date(at) : null;
  if (replays(version.revision, stated, retired))
    return "stale: a revision already replaced or removed (a later `updated` restores it)";
  const holds = held?.latest.statedAt;
  if (stated && holds && stated < holds) return "stale: older than the revision held";
  return null;
}

/** The item's revision, or what cannot be stored of it, before anything held is touched. */
function revisionFor(run: Run, item: ContentItem, version: Version) {
  // A file without a stated date is dated by its modification time, after its revision: one only touched is unchanged.
  const dated = !item.date && version.mtime ? { ...item, date: version.mtime.toISOString() } : item;
  const revision = itemRevision(run.collection.name, dated, { ...version, at: run.now() });
  const problem = revisionProblem(revision);
  return problem ? { problem: `${problem.at}: ${problem.why}` } : { revision };
}
