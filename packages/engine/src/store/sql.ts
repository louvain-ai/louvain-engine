import type { Sql, TransactionSql } from "postgres";
/** A pool or an open transaction: the core's reads run inside a commit's transaction as well as outside one. */
export type Queryable = Sql | TransactionSql;

/** Ids the database would refuse to cast are no id at all: a read given one returns nothing (fail closed). */
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
