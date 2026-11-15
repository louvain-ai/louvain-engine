/**
 * THE HOST: what a deployment decides, in one type. The engine reads, indexes and serves; who may read what, how a work
 * item's effects are committed and how sidecars are reached are the deployment's answers (what a search reads is a
 * plugin, `search/retriever.ts`, never a binding). A deployment hands its host to the engine it builds
 * (`createEngine`), whose reads ask the host's resolver through their context; each member below says what happens
 * when a host has none: the readable set is REQUIRED, because a default would be a wider read; the work transaction
 * and the sidecars fall back to plain ones.
 */

/**
 * WHO MAY READ WHAT. FAIL CLOSED: a store it cannot reach is a throw, never `[]` (a reader of nothing) and never a
 * default (a wider read than the deployment's). A read's context is made with one resolver and never swaps it.
 */
export type ReadableSetResolver = {
  /** The containers this viewer may read. A store it cannot reach is a throw, never an empty set. */
  readableSet(principal: string, orgId: string): Promise<string[]>;
  /** Records admitted to this viewer whatever their container; `[]` where the host admits none. */
  admitted(principal: string, orgId: string): string[];
};

/**
 * HOW A DEPLOYMENT REACHES A SIDECAR IT DOES NOT KEEP AS A PLAIN, ALWAYS-UP HTTP SERVICE. OPTIONAL: unbound, every
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

/**
 * The deployment's binding of every seam. `Transaction`: the handle a work item's effects are written in, the
 * deployment's own; the core never opens one.
 */
export type Host<Transaction = unknown> = {
  /** Who may read what (above). */
  readableSet: ReadableSetResolver;
  /**
   * How a work item's effects are committed and whether it still holds its claim. OPTIONAL: unbound, a plain
   * transaction, never guarded (the open build has no queue to hold a claim).
   */
  work?: {
    check(): void;
    transaction<T>(fn: (trx: Transaction) => Promise<T>): Promise<T>;
    durable(): boolean;
  };
  /** How sidecars that are not plain always-up HTTP services are reached (above). OPTIONAL; bound once. */
  endpoints?: SidecarEndpoints;
};
