/**
 * The host: who may read what and how sidecars are reached, a deployment's answers in one type (what a search reads is
 * a plugin, `search/retriever.ts`). A deployment hands it to the engine it builds (`createEngine`), whose reads ask its
 * resolver through their context. The readable set is REQUIRED, because a default would be a wider read; the sidecars
 * fall back to plain ones.
 */

/**
 * Who may read what. Fail closed: a store it cannot reach is a throw, never `[]` (a reader of nothing) and never a
 * default (a wider read than the deployment's). A read's context is made with one resolver and never swaps it.
 */
export type ReadableSetResolver = {
  /** The containers this viewer may read. A store it cannot reach is a throw, never an empty set. */
  readableSet(principal: string, orgId: string): Promise<string[]>;
  /** Records admitted to this viewer whatever their container; `[]` where the host admits none. */
  admitted(principal: string, orgId: string): string[];
};

/**
 * How a deployment reaches a sidecar it does not keep as a plain, always-up HTTP service. Optional: unbound, every
 * sidecar is one, which is what the engine's own Compose file runs: probed for readiness, sent ordinary HTTP, used at
 * the address it was given.
 */
export type SidecarEndpoints = {
  /** Whether a sidecar at this address stops when idle and starts on the next request: readiness does not probe it. */
  wakesOnRequest(url: string): boolean;
  /**
   * A bulk embedding endpoint that takes jobs rather than HTTP requests: the call that runs one job and returns its
   * output, or null for an ordinary sidecar. Such a lane is never probed; a cold start is "later", not an outage.
   */
  bulkTransport(
    endpoint: string,
  ): ((input: Record<string, unknown>) => Promise<Record<string, unknown>>) | null;
  /** The address one query is sent to, for a name that stands for several machines; the name itself otherwise. */
  queryEndpoint(endpoint: string): Promise<string>;
};

/** What a deployment decides for the engine it builds. */
export type Host = {
  /** Who may read what (above). */
  readableSet: ReadableSetResolver;
  /** How sidecars that are not plain always-up HTTP services are reached (above). OPTIONAL; bound once. */
  endpoints?: SidecarEndpoints;
};
