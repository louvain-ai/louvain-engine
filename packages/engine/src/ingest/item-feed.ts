/** The feed and record type every item a source yields is written under. */

/**
 * An item as the event the engine's one accept path takes. The key is the event's record, so an edit is a new
 * revision of the same document; the idempotency key is `<key>#<revision>`, so the same revision sent twice is one.
 */

export const ITEM_RECORD_TYPE = "item";

/** Every source's items are one fixed feed, so dedupe stays per feed and no item names a feed of its own. */
export const ITEM_FEED = "ingest";

/**
 * The collection an item's container is filed under, or null for a container this feed did not file: the inverse of
 * `containerId(ITEM_FEED, collection, folder)`. A collection's name holds no `/`, so it is the segment after the feed's.
 */
export function collectionOf(container: string): string | null {
  const [feed, collection, ...folder] = container.split("/");
  return feed === ITEM_FEED && collection && folder.length > 0 ? collection : null;
}
