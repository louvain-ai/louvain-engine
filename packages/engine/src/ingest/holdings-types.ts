/** What a collection already holds: each record's latest revision and the older ones still kept. */

/**
 * What a collection already holds, read from what the accept path stored and nothing beside it: an item's events are
 * the feed's rows under its record key, its revision the tail of the idempotency key, its words' hash the stored
 * revision's. Every read seeks the feed's own index: (org, feed, collection, key).
 */

/** A collection of the engine's one org, by its name as stored. */
export type Collection = { orgId: string; name: string };

/** One stored event of an item, as the withdrawal takes it. */
export type HeldEvent = { id: string; connector: string; workspace: string; recordKey: string };

/** A held event with its revision, and the time its source stated for it (null when it stated none). */
export type HeldRevision = HeldEvent & { key: string; revision: string; statedAt: Date | null };

export type Held = {
  /** The newest event by placement: the item as the collection holds it now. */
  latest: HeldRevision & { container: string; indexed: boolean };
  /** Older events still stored: an update cut short before it withdrew them. */
  older: HeldRevision[];
};

/** Every stored event of an item. */
export const everyEvent = (held: Held): HeldRevision[] => [held.latest, ...held.older];
