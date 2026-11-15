/**
 * The fence: who is reading, resolved once per read into a `Reader` that only `fence()` makes, and the one predicate
 * that puts it inside a query (`fenced`). The one rule it keeps: every read applies the reader's set before any order,
 * limit, rank or fold, and an empty set, an unknown reader or a malformed org reads nothing. Whose set it is comes
 * from the resolver the read's context carries (`ReadContext`); `bounded` runs a read under its store's bounds.
 */
import type { ReadableSetResolver, Viewer } from "@louvain/engine-core";
import type { PendingQuery, Row, TransactionSql } from "postgres";
import { sanitizeId } from "../../db-ids.js";
import { readPreamble, type Store } from "../../store.js";
import { type Queryable, UUID } from "../core/sql.js";
import type { ReadHooks } from "./hooks.js";

/** The brand only this module writes, so a `ReadContext` is never assembled by hand. */
declare const madeAsContext: unique symbol;

/**
 * What a read runs on, passed first wherever a read takes the pool: the engine's store (its pool, and the bounds every
 * bounded read keeps), the handle the read runs on now (the store's pool, or a transaction the caller holds), the
 * resolver `fence()` asks who may read what, and what the build adds to the open reads (`hooks.ts`, asked through
 * `hooksOf` alone; `fence()` never reads it). Made by `readContextOf` alone.
 */
export type ReadContext = {
  readonly store: Store;
  readonly sql: Queryable;
  readonly readable: ReadableSetResolver;
  readonly hooks?: ReadHooks;
  readonly [madeAsContext]: true;
};

/**
 * The one cast that brands a context, from a store and the handle on it (its pool, or a transaction on it), a resolver
 * and the build's hooks: the engine's (`createEngine`), and the application's handle swap of one it holds (`through`).
 * A context assembled from fields chosen elsewhere does not type-check, so no read is handed a resolver it was not made
 * with.
 */
export const readContextOf = (
  on: { readonly store: Store; readonly sql: Queryable },
  readable: ReadableSetResolver,
  hooks?: ReadHooks,
): ReadContext =>
  ({ store: on.store, sql: on.sql, readable, ...(hooks ? { hooks } : {}) }) as ReadContext;

/** The brand only this module writes, so a `Reader` is never assembled anywhere else. */
declare const madeByFence: unique symbol;

/** Who is reading: the org and the containers they may read, resolved by `fence()` and by nothing else. */
export type Reader = {
  readonly orgId: string;
  /** Sorted and distinct. */
  readonly containers: string[];
  /** Records the host admits whatever their container (its `admitted()`); empty admits none. */
  readonly admitted: string[];
  /**
   * The reader's whole set when `containers` was narrowed for one read; absent, it is `containers`. Read only to
   * decide which version of a record is current, never to admit a row.
   */
  readonly readable?: string[];
  readonly [madeByFence]: true;
};

/**
 * The reader, narrowed to `within` when the read names containers, or null: an org id that is not a uuid, a blank
 * principal, an empty set or an empty narrowing reads nothing, and a caller handed null issues no query. A resolver
 * that cannot answer throws: unavailable is never empty.
 */
export async function fence(
  context: ReadContext,
  viewer: Viewer,
  within?: readonly string[],
): Promise<Reader | null> {
  if (!UUID.test(viewer.orgId) || viewer.principal.trim() === "") return null;
  const containers = [
    ...new Set(await context.readable.readableSet(sanitizeId(viewer.principal), viewer.orgId)),
  ].sort();
  if (containers.length === 0) return null;
  const admitted = context.readable.admitted(viewer.principal, viewer.orgId);
  const reader = made({ orgId: viewer.orgId, containers, admitted });
  return within === undefined ? reader : narrow(reader, within);
}

/**
 * `reader` narrowed to the containers of `within` it holds, or null when none. The narrowing names containers, so it
 * also drops every admitted record: a read scoped to named containers never reaches a record admitted by id.
 */
export function narrow(reader: Reader, within: readonly string[]): Reader | null {
  const containers = reader.containers.filter((c) => within.includes(c));
  if (containers.length === 0) return null;
  const readable = reader.readable ?? reader.containers;
  return made({ orgId: reader.orgId, containers, admitted: [], readable });
}

/** The reader that reads nothing, for a read that must hold a reader where `fence()` found none. */
export const readsNothing = (orgId: string): Reader =>
  made({ orgId, containers: [], admitted: [] });

/** The one cast that brands a `Reader`, so every reader is made in this module. */
const made = (r: Omit<Reader, typeof madeByFence>): Reader => r as Reader;

/**
 * Two spellings of one set, admitting the same rows. `any` lets the planner estimate each element, which costs planning
 * time on a large set; `unnest` hides the elements behind a set hashed once, which plans faster where something else
 * bounds the rows and worse where the set's selectivity should choose the plan. A query takes `unnest` only with a plan
 * measurement behind it.
 */
export type ContainerSetShape = "any" | "unnest";

/**
 * The one predicate: `column` is one of the reader's containers, or, given its `record` column, the record is one the
 * host admitted. `unnest` (the default) is the set the planner hashes once, `any` the one it estimates element by
 * element. Never a join on the projection: the resolved set may be narrower than the projection's rows.
 */
export function fenced(
  sql: Queryable,
  reader: Reader,
  column: PendingQuery<Row[]>,
  opts: { record?: PendingQuery<Row[]>; shape?: ContainerSetShape } = {},
) {
  const inSet =
    opts.shape === "any"
      ? sql`${column} = any(${reader.containers}::text[])`
      : sql`${column} in (select unnest(${reader.containers}::text[]))`;
  if (opts.record === undefined || reader.admitted.length === 0) return inSet;
  return sql`(${inSet} or ${opts.record} = any(${reader.admitted}::text[]))`;
}

type Trx = TransactionSql;

/**
 * A bounded read on the context's handle, the caller's settings last. On the store's pool it is the store's own
 * (`Store.boundedRead`: its read timeout and plan settings, and its wait for a connection timed). Inside a transaction
 * the read runs in it as is: a `set local` there would outlive this read and change the caller's own queries. On any
 * other pool, its own transaction under the store's bounds.
 */
export async function bounded<T>(
  context: ReadContext,
  fn: (q: Queryable) => Promise<T>,
  settings: readonly string[] = [],
): Promise<T> {
  const { store, sql } = context;
  if (sql === store.sql) return store.boundedRead(fn, settings);
  if (isTransaction(sql)) return fn(sql);
  return (await sql.begin(async (trx: Trx) => {
    await trx.unsafe(readPreamble(store.bounds, settings));
    return fn(trx);
  })) as T;
}

const isTransaction = (q: Queryable): q is Trx =>
  typeof (q as { savepoint?: unknown }).savepoint === "function";
