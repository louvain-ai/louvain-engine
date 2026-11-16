/** The feed and record type every item a source yields is written under. */

/**
 * An item as the event the engine's one accept path takes. The key is the event's record, so an edit is a new
 * revision of the same document; the idempotency key is `<key>#<revision>`, so the same revision sent twice is one.
 */

export const ITEM_RECORD_TYPE = "item";

/** Every source's items are one fixed feed, so dedupe stays per feed and no item names a feed of its own. */
export const ITEM_FEED = "ingest";
