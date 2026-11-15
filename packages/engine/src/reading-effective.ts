import type { PendingQuery, Row } from "postgres";
import type { Queryable } from "./kg/core/sql.js";

/**
 * How a record is read (knowledge, reference or excluded): an expression over an `event_log` alias that the open reads
 * embed, written with the handle of the read it serves. A build whose readings live in its own tables hands its own to
 * its reads (`ReadHooks.reading`); a read handed none reads `plainReading`.
 */
export type ReadingExpression = (sql: Queryable, alias: string) => PendingQuery<Row[]>;

/**
 * The engine's reading: every record is knowledge. Nothing in the engine marks a record as reference or excluded, so
 * this is the honest minimum, not a guess.
 */
export const plainReading: ReadingExpression = (sql, _alias) => sql`'knowledge'::text`;
