import type { PendingQuery, Row } from "postgres";
import type { Queryable } from "../../store/sql.js";
import { laterVersion } from "../../store/version.js";

/** When a version is read (`validAt`, `knownAt`), and the `presentation` keys that declare a record whole. */
export type VersionAt = {
  validAt: string | PendingQuery<Row[]>;
  knownAt: string | null;
  whole: readonly string[];
};

/**
 * One version rule: its collection test (`here`), when it reads (`at`), the record it judges (`e`, `e` by default) and
 * the columns a row of it selects (`columns`, `1` by default).
 */
type VersionRule<At = VersionAt> = {
  here: (column: PendingQuery<Row[]>) => PendingQuery<Row[]>;
  at: At;
  e?: PendingQuery<Row[]>;
  columns?: PendingQuery<Row[]>;
};

/**
 * The version rule with its collection test given (`here`): `newerVersionRead` passes "a collection the viewer reads",
 * and the vector drop (`ingest/superseded-vectors.ts`) passes "the old version's own collection". The writer that drops
 * a version's vectors and the reader that retires it share this one fragment, so the order, the time test (a newer
 * version stamped in the future retires nothing yet), the declaration test and the passages test cannot drift.
 */
export function newerVersionHeld(sql: Queryable, rule: Omit<VersionRule, "columns">) {
  const e = rule.e ?? sql`e`;
  return sql`(${e}.has_newer and exists (
      ${newerVersions(sql, { ...rule, e })}))`;
}

/** The newer versions that retire `e` under `here` and `at` (`newerVersionHeld`'s rows), as `select <columns> …`. */
export function newerVersions(sql: Queryable, rule: VersionRule) {
  const { here, at, e = sql`e`, columns = sql`1` } = rule;
  return sql`select ${columns} from event_log r2
       where r2.org_id = ${e}.org_id and r2.connector = ${e}.connector and r2.workspace = ${e}.workspace
         and r2.record_key = ${e}.record_key and ${laterVersion(sql, sql`r2`, e)}
         and (
           (${e}.kind in ('message', 'file') and r2.kind in ('message', 'file'))
           or (${e}.kind = 'record.change' and r2.kind = 'record.change'
             and r2.connection_id = ${e}.connection_id
             and exists (
               ${declaringVersions(sql, { here, at, e })})))
         and ${here(sql`r2.container`)}
         and r2.occurred_at <= ${at.validAt}
         ${at.knownAt === null ? sql`` : sql`and r2.observed_at <= ${at.knownAt}`}
         and exists (select 1 from passage p2 where p2.event_id = r2.id)`;
}

/** The versions of `e`'s record that declare it re-rendered whole (`at.whole`), under `here` and by `at.knownAt`. */
export function declaringVersions(
  sql: Queryable,
  rule: VersionRule<Pick<VersionAt, "knownAt" | "whole">>,
) {
  const { here, at, e = sql`e`, columns = sql`1` } = rule;
  return sql`select ${columns} from event_log m
                where m.connection_id = ${e}.connection_id and m.record_key = ${e}.record_key
                  and m.kind = 'record.change' and m.org_id = ${e}.org_id
                  and ${here(sql`m.container`)}
                  ${at.knownAt === null ? sql`` : sql`and m.observed_at <= ${at.knownAt}`}
                  and jsonb_exists_any(m.body -> 'presentation', ${[...at.whole]}::text[])`;
}
