import { LRUCache } from "lru-cache";
import type { Queryable } from "./sql.js";

/**
 * A workspace's passage-context mode, `off | header | shadow | on`: whether passages carry a header that situates
 * them, and whether the read side ranks by it. `off` writes nothing; `header` writes the deterministic header and the
 * lexical passes read it; `shadow` and `on` would add a model-written context, written and then read, and the setter
 * refuses them, since that step is not built. `header` is the default and `off` is its switch. The vector leg ranks by
 * the bare vector alone: a context moves the lexical passes only.
 */

export type PassageContextMode = "off" | "header" | "shadow" | "on";

const PASSAGE_CONTEXT_MODES: readonly PassageContextMode[] = ["off", "header", "shadow", "on"];

/** A workspace that never chose: `header`; `off` is the switch. */
export const DEFAULT_PASSAGE_CONTEXT: PassageContextMode = "header";

export const isPassageContextMode = (v: unknown): v is PassageContextMode =>
  typeof v === "string" && (PASSAGE_CONTEXT_MODES as readonly string[]).includes(v);

/** Whether the read side ranks by the contextual columns. `shadow` writes and NEVER reads: that is what it is. */
export const readsPassageContext = (mode: PassageContextMode): boolean =>
  mode === "header" || mode === "on";

/** Whether the write side fills them. */
export const writesPassageContext = (mode: PassageContextMode): boolean => mode !== "off";

export class PassageContextNotBuilt extends Error {
  constructor(mode: PassageContextMode) {
    super(`passage_context ${mode} needs a model-written context, which is not built`);
    this.name = "PassageContextNotBuilt";
  }
}

/**
 * Per org, re-read on a short cadence and dropped at once in this process on a write here. A stale read costs a few
 * seconds of the old mode in a process that did not make the write: the reads it switches are both correct reads of
 * the same fenced rows, so neither can widen what anyone sees.
 */
const TTL_MS = 15_000;
const cache = new LRUCache<string, { mode: PassageContextMode }>({ max: 10_000, ttl: TTL_MS });

function invalidatePassageContext(orgId?: string): void {
  if (orgId === undefined) cache.clear();
  else cache.delete(orgId);
}

/** The workspace's stored choice, or the code default. Never an error for a missing org: that reads nothing. */
export async function passageContextMode(
  sql: Queryable,
  orgId: string,
): Promise<PassageContextMode> {
  const hit = cache.get(orgId);
  if (hit) return hit.mode;
  const [row] = await sql<{ mode: string | null }[]>`
    select passage_context as mode from org where id = ${orgId}`;
  const mode = isPassageContextMode(row?.mode) ? row.mode : DEFAULT_PASSAGE_CONTEXT;
  cache.set(orgId, { mode });
  return mode;
}

/**
 * Set a workspace's mode. A mode this phase cannot run (`shadow`, `on`: no model writes a context yet) is refused, never
 * stored to sit inert.
 */
export async function setPassageContextMode(
  sql: Queryable,
  orgId: string,
  mode: PassageContextMode,
): Promise<void> {
  if (mode !== "off" && mode !== "header") throw new PassageContextNotBuilt(mode);
  await sql`update org set passage_context = ${mode} where id = ${orgId}`;
  invalidatePassageContext(orgId);
}
