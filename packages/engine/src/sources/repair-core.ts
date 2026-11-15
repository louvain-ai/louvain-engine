import type { PendingQuery, Row, TransactionSql } from "postgres";
import { rankOf } from "../kg/core/version.js";

/**
 * The series key of the revision a document now points at, as the build's writer keys it (`SourceOrigin.keys`), in SQL
 * over that revision's `presentation`; null where the build groups no series, as its writer then writes none.
 */
export type SeriesKeySql =
  | ((trx: TransactionSql, presentation: PendingQuery<Row[]>) => PendingQuery<Row[]>)
  | null;

/**
 * A document whose current revision was withdrawn points at nothing: `repointDocuments` points it at its newest
 * remaining revision by placement, the order withdrawal judges in, and `dropRevisionless` deletes one left with none.
 * Every withdrawal runs these two, in this order, after its own steps.
 */
export async function repointDocuments(
  trx: TransactionSql,
  orgId: string,
  documents: readonly string[],
  seriesKey: SeriesKeySql,
): Promise<void> {
  await trx`
    update source_document d
    set current_event_id = latest.event_id, current_modified_at = latest.modified_at,
      -- The series follows the current revision, keyed here as the writer keys it.
      series_key = ${seriesKey ? seriesKey(trx, trx`latest.presentation`) : null}
    from (
      select distinct on (r.source_id) r.source_id, r.event_id, r.modified_at, r.presentation
      from source_revision r
      where r.source_id = any(${[...documents]}::text[])
      order by r.source_id, upper(left(r.event_id, 10)) desc, ${rankOf(trx, trx`r.event_id`, trx`r.modified_at`)} desc, r.event_id desc
    ) latest
    where d.id = latest.source_id and d.org_id = ${orgId} and d.current_event_id is null`;
}

/** Delete each of these documents that points at no revision and has none left; the ids deleted. */
export async function dropRevisionless(
  trx: TransactionSql,
  orgId: string,
  documents: readonly string[],
): Promise<string[]> {
  const deleted = await trx<{ id: string }[]>`
    delete from source_document d
    where d.org_id = ${orgId} and d.id = any(${[...documents]}::text[])
      and d.current_event_id is null
      and not exists (select 1 from source_revision r where r.source_id = d.id)
    returning d.id`;
  return deleted.map((d) => d.id);
}
