import type { TransactionSql } from "postgres";
import { readPreamble } from "../store/pool.js";
import type { Queryable } from "../store/sql.js";
import type { ReadContext } from "./fence.js";

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
