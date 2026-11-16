import { envSetting } from "../config/env-setting.js";

/** Postgres `query_canceled` — what `statement_timeout` raises. */
export const isStatementTimeout = (err: unknown): boolean =>
  (err as { code?: unknown } | null)?.code === "57014";

/**
 * The vector legs run under their own scan settings.
 *
 * Every vector leg is `where org_id and container = any(…) order by embedding
 * <=> q limit N`, and pgvector's HNSW scan applies that fence AFTER walking
 * the graph: with the default `ef_search` of 40 it collects 40 candidates,
 * filters them, and returns whatever survives — FEWER rows than the limit,
 * often well under half on a tenant that is a small share of the table. Not
 * slow — incomplete, and silently so: the missing rows are never ranked.
 *
 * `iterative_scan = relaxed_order` (pgvector 0.8) keeps walking until the
 * limit is met, and `ef_search` is raised so the common case needs one pass.
 * Relaxed rather than strict order because fusion is by RANK: a row a few
 * places out of distance order costs nothing measurable, and strict ordering
 * costs a second sort.
 *
 * NOT `enable_bitmapscan = off`. For a tenant that is a small share of the
 * table the exact scan of its own rows IS the right plan: the index would
 * walk past every other tenant's vectors to find this one's few. The planner
 * chooses correctly when its statistics are fresh, so a large tenant lands on
 * `*_embedding_idx` and every shape returns the full limit.
 *
 * Scoped with `set local` inside each leg's own transaction, so the lexical
 * legs and everything else on the pool see the server's defaults.
 */
export const HNSW_EF_SEARCH = Math.max(24, envSetting("LOUVAIN_HNSW_EF_SEARCH", 120, { min: 1 }));
export const VECTOR_LEG_SETTINGS: readonly string[] = [
  "set local hnsw.iterative_scan = relaxed_order",
  `set local hnsw.ef_search = ${HNSW_EF_SEARCH}`,
];
