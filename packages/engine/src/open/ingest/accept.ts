/**
 * The accept stage: an item's new revision through the engine's one accept path (`load-core.ts` `acceptInto`). A
 * revision moved to another folder is withdrawn from the old one and accepted in the new in ONE transaction, since a
 * record lives in one place. A refusal writes nothing and is said as a skip.
 */
import { acceptOpen, OpenAcceptRefused } from "../../ingest/accept-open.js";
import { stage } from "../../ingest/stage.js";
import { forgetKeywords, withdrawWithin } from "../../ingest/withdraw-open.js";
import { acceptInto, project } from "../load-core.js";
import type { Change, Changed, Updated } from "./decide.js";
import { everyEvent } from "./held-types.js";
import { recordRetired } from "./retired.js";
import type { Run } from "./run-state.js";

/** What a change keeps: the revision (`id`) and whether it still needs indexing, or the skip that says why none. */
export async function acceptChange(run: Run, change: Change): Promise<Taken> {
  if (change.kind === "skipped") return { skipped: change.skipped };
  if (change.kind === "unchanged") {
    const { latest } = change.held;
    return { change, id: latest.id, index: !latest.indexed, moved: [] };
  }
  return stage("ingest.accept", () => accept(run, change));
}

/** A change taken: what it keeps and the documents a move left (`moved`), or the skip that says why it keeps none. */
export type Taken =
  | { skipped: { key: string; why: string; reader?: string } }
  | { change: Changed; id: string; index: boolean; moved: string[] };

async function accept(
  run: Run,
  change: Updated | Extract<Change, { kind: "added" }>,
): Promise<Taken> {
  try {
    if (change.kind === "updated" && change.moved) return await relocate(run, change);
    const accepted = await acceptInto(run.state, change.event);
    return { change, id: accepted.eventId, index: true, moved: [] };
  } catch (err) {
    if (!(err instanceof OpenAcceptRefused)) throw err;
    return { skipped: { key: change.item.key, why: err.reason } };
  }
}

/**
 * The old placement withdrawn and the new revision accepted together; its container projected once that commits. The
 * documents the withdrawal moved off their current revision are refreshed once the new one is indexed (`retire.ts`).
 */
async function relocate(run: Run, change: Updated): Promise<Taken> {
  const old = everyEvent(change.held);
  const { sql, orgId } = run.state;
  const { result, withdrawn } = await sql.begin(async (trx) => {
    if (run.sendsChanges) await recordRetired(trx, run.collection, old);
    const withdrawn = await withdrawWithin(trx, orgId, old);
    return { result: await acceptOpen(sql, orgId, change.event, trx), withdrawn };
  });
  run.summary.keywordStale += await forgetKeywords(
    run.state,
    old.map((e) => e.id),
  );
  await project(run.state, result.container);
  return { change, id: result.eventId, index: true, moved: withdrawn.documents };
}
