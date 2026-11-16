import type { PendingQuery, Row } from "postgres";
import type { Queryable } from "../store/sql.js";
import type { Reader } from "./fence.js";

/**
 * Two spellings of one set, admitting the same rows. `any` lets the planner estimate each element, which costs planning
 * time on a large set; `unnest` hides the elements behind a set hashed once, which plans faster where something else
 * bounds the rows and worse where the set's selectivity should choose the plan. A query takes `unnest` only with a plan
 * measurement behind it.
 */
export type ContainerSetShape = "any" | "unnest";

/** A fenced column, with its record's id column (`record`) and the set's spelling (`shape`) where they are given. */
type FencedColumn = {
  column: PendingQuery<Row[]>;
  record?: PendingQuery<Row[]>;
  shape?: ContainerSetShape;
};

/**
 * The one predicate: `column` is one of the reader's containers, or, given its `record` column, the record is one the
 * host admitted. `unnest` (the default) is the set the planner hashes once, `any` the one it estimates element by
 * element. Never a join on the projection: the resolved set may be narrower than the projection's rows.
 */
export function fenced(sql: Queryable, reader: Reader, on: PendingQuery<Row[]> | FencedColumn) {
  const { column, ...opts }: FencedColumn = "column" in on ? on : { column: on };
  const inSet =
    opts.shape === "any"
      ? sql`${column} = any(${reader.containers}::text[])`
      : sql`${column} in (select unnest(${reader.containers}::text[]))`;
  if (opts.record === undefined || reader.admitted.length === 0) return inSet;
  return sql`(${inSet} or ${opts.record} = any(${reader.admitted}::text[]))`;
}
