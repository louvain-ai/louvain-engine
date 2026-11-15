import type { Sql, TransactionSql } from "postgres";

/**
 * The indexer's work, as a bound seam: writing a record's passages and their contexts checks between slices that the
 * work is still this process's, and writes each slice in a transaction that re-checks the claim. A queue binds its own
 * check and transaction when it loads. Unbound is plain, not an error: work is owned only inside the module that binds
 * the hooks, so a process that never loaded a queue owns nothing, and for it a plain transaction on the writer's own
 * pool is exactly right.
 */
export type WorkHooks = {
  /** Throws when the running work was taken away (a lost claim, a stop). */
  check(): void;
  /** A transaction for the work's effects, guarded by its claim where it has one. */
  transaction<T>(fn: (trx: TransactionSql) => Promise<T>): Promise<T>;
  /**
   * Whether this work is the record's DURABLE index owner (a claimed index job), which must rethrow a best-effort
   * miss (a keyword entry, a passage context) so the claim retries it; anyone else counts the miss and goes on.
   */
  durable(): boolean;
};

/** The bound hooks, or none: no owned work, nothing to check, a plain transaction. */
let bound: WorkHooks | null = null;

/** Fix the hooks for this process (the queue's, on load). The same again is a no-op; different ones throw. */
export function bindWork(hooks: WorkHooks): void {
  if (bound === hooks) return;
  if (bound !== null)
    throw new Error("different work hooks are already bound: the queue binds its own, once");
  bound = hooks;
}

/** Throws when the running work was taken away. */
export const checkWork = (): void => bound?.check();

/** A transaction for the work's effects: the bound one, else a plain one on the pool the writer writes through. */
export function workTransaction<T>(sql: Sql, fn: (trx: TransactionSql) => Promise<T>): Promise<T> {
  return bound ? bound.transaction(fn) : (sql.begin(fn) as Promise<T>);
}

/** Whether a best-effort miss must be rethrown for the claim to retry. */
export const durableWork = (): boolean => bound?.durable() ?? false;
