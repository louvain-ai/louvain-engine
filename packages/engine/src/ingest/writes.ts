import type { Sql, TransactionSql } from "postgres";
import type { Logged, Told } from "../host/given.js";
import { hooksOf, type ReadHooks } from "../read/hooks.js";
import type { Embedded } from "../store/embedder.js";
import { openPassageRules, type PassageRules } from "./passage-rules.js";
import { type PassageWriteHooks, plainPassageWrites } from "./passage-writes.js";
import { plainWork, type WorkHooks } from "./work.js";

/**
 * What a build adds to the open writes and no read asks: how its records become passages, and what it does after a
 * passage is written. What a write asks that a read asks too (a record's app, the keyword index) is a `ReadHooks`.
 */
type WriteHooks = {
  /** How a record is cut, headed and kept (`passage-rules.ts`). */
  readonly passageRules?: PassageRules;
  /** What follows a passage write (`passage-write-seam.ts`). */
  readonly passageWrites?: PassageWriteHooks;
  /** Whose work a write is, and the transaction its effects are written in (`work-seam.ts`). */
  readonly work?: WorkHooks;
};

/** What a build adds to the open engine: what its reads ask and what only its writes ask. The open build passes none. */
export type EngineHooks = ReadHooks & WriteHooks;

/**
 * What a write runs on, handed first to every write that asks a hook: the pool it writes through and the build's hooks,
 * as the engine holds them (`Engine.writes`). The hooks are a required member, so a write is never handed a bare pool:
 * one handed none would write the open build's passages without a word.
 */
export type Writes = { readonly sql: Sql; readonly hooks: EngineHooks & Embedded & Told & Logged };

/**
 * One batch's writes, committed once: every statement runs in `trx`, and every transaction a write opens is a
 * savepoint of it, so a batch of records is one commit, not one per record and slice. A failure rolls the batch back
 * whole; the indexer then takes its records again one at a time (`index-record.ts`). The work's check and ownership
 * stay its own: the batch's transaction is the work's (`WorkHooks.transaction`).
 */
export function inOneTransaction<T>(
  writes: Writes,
  run: (batch: Writes) => Promise<T>,
): Promise<T> {
  const { work } = writeHooksOf(writes);
  return work.transaction((trx: TransactionSql) =>
    run({
      sql: trx as unknown as Sql,
      hooks: {
        ...writes.hooks,
        work: {
          check: () => work.check(),
          durable: () => work.durable(),
          transaction: <R>(fn: (t: TransactionSql) => Promise<R>) =>
            trx.savepoint(fn) as Promise<R>,
        },
      },
    }),
  );
}

/** Each hook of a write: its build's, else the open build's own (a read's through `hooksOf`, and these two). */
export function writeHooksOf(writes: Writes): Required<EngineHooks> {
  const { hooks } = writes;
  return {
    ...hooksOf(writes),
    passageRules: hooks.passageRules ?? openPassageRules,
    passageWrites: hooks.passageWrites ?? plainPassageWrites,
    work: hooks.work ?? plainWork(writes.sql),
  };
}
