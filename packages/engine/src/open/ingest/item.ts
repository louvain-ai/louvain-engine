/**
 * One item through its collection, stage by stage:
 *
 *   read      its words, from its text or its file (`read.ts`)
 *   decide    unchanged, added, updated, moved or skipped, reading nothing (`decide.ts`)
 *   accept    its new revision through the one accept path (`accept.ts`)
 *   index     the revision made findable (`ingest/index-core.ts`, stage by stage)
 *   retire    what it replaced, withdrawn (`retire.ts`)
 *   say       its line in the run's summary
 */
import { indexOpen } from "../../ingest/index-open.js";
import { stage } from "../../ingest/stage.js";
import { acceptChange, type Taken } from "./accept.js";
import { type Changed, decide } from "./decide.js";
import { type ContentItem, textHash } from "./item-event.js";
import { report, skip, tally } from "./outcome.js";
import { readItem } from "./read.js";
import { retireReplaced } from "./retire.js";
import type { Run, Stored } from "./run-state.js";

export async function take(run: Run, item: ContentItem, stored: Stored): Promise<void> {
  const read = await stage("ingest.read", () => readItem(run, item));
  const change = decide(run, item, read, stored);
  const taken = await acceptChange(run, change);
  await indexTaken(run, taken);
  await retireReplaced(run, taken);
  say(run, taken);
}

/** The index stage for what a change keeps: indexed once, and counted. */
async function indexTaken(run: Run, taken: Taken): Promise<void> {
  if ("id" in taken && taken.index)
    tally(run, await indexOpen(run.state, run.state.orgId, taken.id));
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
