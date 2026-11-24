/**
 * The two ways pg_rebac declines to answer, each its own error so a caller can tell them apart. Neither is ever an
 * empty set: an empty set means the reader was asked and may read nothing, and these mean nobody knows yet.
 */

/** The permission store cannot be trusted now (RB503): stale, over its cap, or SpiceDB could not be asked. */
export class PermissionsUnavailable extends Error {}

/** The reader was never asked (RB404), and no lookup made it known: no daemon is named, or it still did not know. */
export class ReaderNotProjected extends Error {}
