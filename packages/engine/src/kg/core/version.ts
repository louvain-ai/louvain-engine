import type { PendingQuery, Row } from "postgres";
import type { Queryable } from "./sql.js";

/**
 * WHICH OF TWO VERSIONS OF ONE RECORD IS THE NEWER, WRITTEN ONCE: the later RANK, then the later id.
 * A version's rank is the time its source stated (`occurred_at`), unless the time was one WE chose (a calendar's series
 * time or start, `saidAt`): then the rank the accept trigger stored when it arrived (`version_rank`), just above what
 * its record held, so the source's own later stamp is never beaten by our guess. `newer` and `older` are aliases of
 * `event_log` rows of the same record, each exposing `version_rank`. Every read and write that orders versions asks
 * this (`kg/read/passages-filter.ts` `newerVersionRead`, `memory/store.ts` `flagOlderVersions`, and a deployment's own),
 * so the order cannot drift between them; the accept trigger is SQL and states the same order, and must change with it.
 */
export const laterVersion = (
  q: Queryable,
  newer: PendingQuery<Row[]>,
  older: PendingQuery<Row[]>,
): PendingQuery<Row[]> =>
  q`(coalesce(${newer}.version_rank, ${newer}.occurred_at), ${newer}.id)
    > (coalesce(${older}.version_rank, ${older}.occurred_at), ${older}.id)`;

/**
 * The same rank for a revision named by its event (`eventId`): the accept trigger's stored rank where its time was one
 * WE chose, else `stated`, its own time. For the document pointer and every re-point of it (a source writer,
 * relocation, repair), which hold a revision rather than an `event_log` row. Event ids are unique: one key probe.
 */
export const rankOf = (
  q: Queryable,
  eventId: PendingQuery<Row[]>,
  stated: PendingQuery<Row[]>,
): PendingQuery<Row[]> =>
  q`coalesce((select v.version_rank from event_log v where v.id = ${eventId}), ${stated})`;
