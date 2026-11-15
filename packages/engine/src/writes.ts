import type { Sql } from "postgres";
import type { Embedded } from "./embedder.js";
import { openPassageRules, type PassageRules } from "./ingest/passage-rules.js";
import { hooksOf, type ReadHooks } from "./kg/read/hooks.js";
import { plainWork, type WorkHooks } from "./memory/work-seam.js";
import { type PassageWriteHooks, plainPassageWrites } from "./passage-write-seam.js";

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
 * WHAT A WRITE RUNS ON, handed first to every write that asks a hook: the pool it writes through and the build's hooks,
 * as the engine holds them (`Engine.writes`). The hooks are a required member, so a write is never handed a bare pool:
 * one handed none would write the open build's passages without a word.
 */
export type Writes = { readonly sql: Sql; readonly hooks: EngineHooks & Embedded };

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
