/**
 * The retire stage: what a change replaced, withdrawn through the engine's one withdrawal. For a source that sends
 * changes, each retired revision is kept as a tombstone, so a replay of it is refused rather than taken.
 */

import {
  everyRevision,
  type Held,
  type HeldRevision,
  type HeldRevisionRef,
} from "./holdings-types.js";
import type { Taken } from "./item-accept.js";
import { textHash } from "./item-event.js";
import { legacyOf } from "./legacy.js";
import { report, skip } from "./outcome.js";
import { noteRetired } from "./retired.js";
import type { Run } from "./run-state.js";
import { stage } from "./stage.js";
import { refreshDocuments, withdrawOpen } from "./withdraw.js";

/** What a kept change replaced: an unchanged item's older revisions, an updated one's others, and nothing else. */
export async function retireReplaced(run: Run, taken: Taken): Promise<void> {
  if ("skipped" in taken) return;
  const replaced = replacedBy(taken);
  if (replaced.length > 0) await stage("ingest.retire", () => retire(run, replaced));
  // After the new revision's own index, so the document's entry ends as its current revision's, whichever that is.
  run.summary.keywordStale += await refreshDocuments(run.state, run.state.orgId, taken.moved);
  const { change } = taken;
  if (change.kind === "added" && run.adopting)
    await adopt(run, { key: change.item.key, hash: textHash(change.version.text) });
}

/** A removed item: every event of it withdrawn and said, or a skip when the collection never held it. */
export async function removeItem(run: Run, key: string, held: Held | undefined): Promise<void> {
  if (!held) return skip(run, { key, why: "not held" });
  await remove(run, key, everyRevision(held));
}

/** An item gone: every event of it withdrawn, and said. */
export async function remove(
  run: Run,
  key: string,
  events: readonly HeldRevisionRef[],
): Promise<void> {
  await retire(run, events);
  report(run, { key, change: "removed" });
}

/** Withdraws events; for a source that sends changes, each that names its revision is kept as a tombstone. */
export async function retire(
  run: Run,
  events: readonly (HeldRevisionRef | HeldRevision)[],
): Promise<void> {
  if (events.length === 0) return;
  const revisions = events.filter((e): e is HeldRevision => "revision" in e);
  if (run.sendsChanges && revisions.length > 0)
    await run.state.sql.begin((trx) => noteRetired(trx, run.collection, revisions));
  const { keywordMissed } = await withdrawOpen(run.state, run.state.orgId, events);
  run.summary.keywordStale += keywordMissed;
}

/** The events a kept change leaves behind: none for an addition or a move, which withdrew its old place itself. */
function replacedBy({ change, id }: Extract<Taken, { change: unknown }>): HeldRevision[] {
  if (change.kind === "unchanged") return change.held.older;
  if (change.kind === "updated" && !change.moved)
    return everyRevision(change.held).filter((e) => e.id !== id);
  return [];
}

/** The path-keyed copy of this path and these words is withdrawn, now that the collection holds its own. */
async function adopt(run: Run, same: { key: string; hash: string }): Promise<void> {
  const earlier = await legacyOf(run.state.sql, run.state.orgId, same.key, same.hash);
  if (earlier.length === 0) return;
  await retire(run, earlier);
  run.summary.adopted += 1;
}
