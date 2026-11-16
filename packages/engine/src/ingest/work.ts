import type { Sql, TransactionSql } from "postgres";

/**
 * The indexer's work, as a write hook (`writes.ts` `WriteHooks.work`): writing a record's passages and their contexts
 * checks between slices that the work is still its owner's, and writes each slice in a transaction that re-checks the
 * claim. A build whose work is owned by a queue hands its engine the queue's hooks; the open build has no queue, so its
 * writes own nothing (`plainWork`).
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

/** No owned work: nothing to check, a plain transaction on the pool the writer writes through, nothing durable. */
export const plainWork = (sql: Sql): WorkHooks => ({
  check: () => {},
  transaction: <T>(fn: (trx: TransactionSql) => Promise<T>) => sql.begin(fn) as Promise<T>,
  durable: () => false,
});
