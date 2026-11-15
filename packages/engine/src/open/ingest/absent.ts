import type { Sql } from "postgres";
import { heldCount, heldExcept } from "./held.js";
import type { Collection, HeldEvent } from "./held-types.js";

/**
 * What a whole listing may remove. A key it left out is gone from the source, and that is believed only when the
 * listing finished complete and named something, and, unless the person confirmed, removes at most the limit.
 */

/** A run removes more than this many items, and more than half its collection, only when confirmed. */
const REMOVAL_LIMIT = 10;

export type Absent = { key: string; events: HeldEvent[]; textHash: string | null };

export async function absentItems(
  sql: Sql,
  collection: Collection,
  listing: { keys: ReadonlySet<string>; complete: boolean; removeMany: boolean },
): Promise<{ held: string } | { gone: AsyncIterable<Absent> }> {
  if (!listing.complete) return { held: "the listing was incomplete" };
  if (listing.keys.size === 0) return { held: "the source listed nothing" };
  let gone = 0;
  for await (const _ of heldExcept(sql, collection, listing.keys)) gone += 1;
  const total = await heldCount(sql, collection);
  if (!listing.removeMany && gone > Math.max(REMOVAL_LIMIT, total / 2))
    return {
      held: `${gone} of ${total} items are no longer in the source (run again with --yes to remove them)`,
    };
  return { gone: heldExcept(sql, collection, listing.keys) };
}
