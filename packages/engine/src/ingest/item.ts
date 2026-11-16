/**
 * One item through its collection, stage by stage:
 *
 *   read      its words, from its text or its file (`read.ts`)
 *   decide    unchanged, added, updated, moved or skipped, reading nothing (`item-decide.ts`)
 *   accept    its new revision through the one accept path (`accept.ts`)
 *   index     the revision made findable, with the rest of its batch (`ingest/index-record.ts`, stage by stage)
 *   retire    what it replaced, withdrawn (`item-retire.ts`)
 *   say       its line in the run's summary
 */
import { indexOpen } from "./indexer.js";
import { acceptChange, type Taken } from "./item-accept.js";
import { type Changed, decide } from "./item-decide.js";
import { type ContentItem, textHash } from "./item-event.js";
import { readItem } from "./item-read.js";
import { retireReplaced } from "./item-retire.js";
import { report, skip, tally } from "./outcome.js";
import type { Run, Stored } from "./run-state.js";
import { stage } from "./stage.js";

/** An item up to its index stage: read, decided and accepted. Its batch indexes it (`indexTaken`), then `finish`. */
export async function take(run: Run, item: ContentItem, stored: Stored): Promise<Taken> {
  const read = await stage("ingest.read", () => readItem(run, item));
  return acceptChange(run, decide(run, item, read, stored));
}

/** The index stage for what a batch's changes keep: indexed together, in order, each counted. */
export async function indexTaken(run: Run, taken: readonly Taken[]): Promise<void> {
  const ids = taken.flatMap((t) => ("id" in t && t.index ? [t.id] : []));
  if (ids.length === 0) return;
  for (const result of await indexOpen(run.state, run.state.orgId, ids)) tally(run, result);
}

/** An indexed item's last stages: what it replaced withdrawn, and its line. */
export async function finish(run: Run, taken: Taken): Promise<void> {
  await retireReplaced(run, taken);
  say(run, taken);
}

/** The item's line, or the skip that says why it made no change. */
function say(run: Run, taken: Taken): void {
  if ("skipped" in taken) skip(run, taken.skipped);
  else if (!waitsAsMove(run, taken.change)) report(run, lineOf(taken.change));
}

const lineOf = (change: Changed) => ({
  key: change.item.key,
  change: change.kind,
  ...(change.version.reader ? { reader: change.version.reader } : {}),
});

/** An addition of words the collection held waits, in case the listing shows it moved there. */
function waitsAsMove(run: Run, change: Changed): boolean {
  if (change.kind !== "added" || !run.moves) return false;
  return run.moves.hold(textHash(change.version.text), { ...lineOf(change), change: "added" });
}
