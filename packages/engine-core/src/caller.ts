/** Who is reading: every open read is fenced to what this reader may see in its organisation. */
export type Viewer = { orgId: string; principal: string };

/** The default reader: who the engine's own token, and its command line, read as. It reads every collection loaded. */
export const DEFAULT_READER = "engine-reader";

/**
 * When a read is asked about: a plain instant, or `validAt` (what had happened by then) and `knownAt` (what had been
 * seen by then). Absent, the read is of things as they stand.
 */
export type AsOf = string | { validAt?: string; knownAt?: string };
