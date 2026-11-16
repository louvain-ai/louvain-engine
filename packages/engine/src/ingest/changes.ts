/**
 * What a finished whole listing does to its collection: each item it left out is removed, and a removal whose words
 * came back under a new key is a move. Each addition held back as a possible move is said once the listing is settled.
 */
import { absentItems } from "./absent.js";
import { remove, retire } from "./item-retire.js";
import { report } from "./outcome.js";
import type { Run } from "./run-state.js";

/** A finished whole listing: what it left out is removed, and each addition held back as a possible move is said. */
export async function settleListing(run: Run, removeMany: boolean): Promise<string | null> {
  const held = await removeAbsent(run, removeMany);
  for (const added of run.moves?.unclaimed() ?? []) report(run, added);
  return held;
}

/** What a finished whole listing left out is gone, or the reason nothing was removed. */
async function removeAbsent(run: Run, removeMany: boolean): Promise<string | null> {
  const listing = {
    keys: run.listed ?? new Set<string>(),
    complete: run.source.complete(),
    removeMany,
  };
  const verdict = await absentItems(run.state.sql, run.collection, listing);
  if ("held" in verdict) return verdict.held;
  for await (const absent of verdict.gone) {
    const moved = run.moves?.claim(absent.textHash);
    if (!moved) {
      await remove(run, absent.key, absent.events);
      continue;
    }
    await retire(run, absent.events);
    report(run, { ...moved, change: "moved", from: absent.key });
  }
  return null;
}
