/**
 * The engine's readable set from pg_rebac: who may read what is SpiceDB's answer, projected into Postgres by rebacd
 * and read with `rebac.readable_set`. A host binding, bound in code by the entry that builds the engine:
 * `createEngine({ host: { readableSet: pgRebac(sql, options) }, … })`.
 */

export { PermissionsUnavailable, ReaderNotProjected } from "./refusals.js";
export { type PgRebacOptions, pgRebac } from "./resolver.js";
