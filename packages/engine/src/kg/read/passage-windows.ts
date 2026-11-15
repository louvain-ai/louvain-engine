import { AsyncLocalStorage } from "node:async_hooks";
import type { Queryable } from "../core/sql.js";

/*
 * A read may take some records only at their windows: the caller names records and the passage ranges to read them
 * at, so a long transcript's unrelated hour does not steer an answer. A scope, as knowledge time is: set once around
 * the work and read by `passageFilter`, the predicate every passage leg takes. It only narrows: a record not named
 * reads whole, a named one loses passages, never gains any. Only passage reads are windowed.
 */

/** Per record (event id): the inclusive `seq` ranges it is read at. */
export type PassageWindows = ReadonlyMap<string, readonly (readonly [number, number])[]>;

const store = new AsyncLocalStorage<{ orgId: string; windows: PassageWindows }>();

export function withPassageWindows<T>(
  orgId: string,
  windows: PassageWindows | undefined,
  fn: () => Promise<T>,
): Promise<T> {
  if (!windows || windows.size === 0) return fn();
  return store.run({ orgId, windows }, fn);
}

/**
 * The predicate for a passage row `p` under the active windows, or nothing: a passage of a windowed record is kept only
 * inside one of its ranges. A residual filter on rows its leg already selected, one scalar per row, never an `or`
 * across indexed predicates. A scope of another org narrows nothing (it is never this read's).
 */
export function windowsPredicate(sql: Queryable, orgId: string) {
  const scope = store.getStore();
  if (!scope || scope.orgId !== orgId) return sql``;
  const ids: string[] = [];
  const los: number[] = [];
  const his: number[] = [];
  for (const [id, ranges] of scope.windows)
    for (const [lo, hi] of ranges) {
      ids.push(id);
      los.push(lo);
      his.push(hi);
    }
  return sql`and coalesce((select bool_or(p.seq between w.lo and w.hi)
      from unnest(${ids}::text[], ${los}::int[], ${his}::int[]) as w(id, lo, hi) where w.id = p.event_id), true)`;
}
