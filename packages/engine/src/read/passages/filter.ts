import type { Queryable } from "../../store/sql.js";
import { bounded } from "../bounded.js";
import type { ReadContext, Reader } from "../fence.js";
import { fenced } from "../fenced.js";
import { documentPredicates, hasDocumentFilters } from "../filters.js";
import { hooksOf } from "../hooks.js";
import { instantOf } from "../instant.js";
import type { AddedFilters } from "../listing/filter-seam.js";
import { currentRevisions } from "./still-current.sql.js";
import type { PassageFilters } from "./types.js";
import { newerVersionHeld, type VersionAt } from "./versions.js";
import { windowsPredicate } from "./windows.js";

/**
 * The version rule for a passage, on its record `e` (joined by the caller): a version is not found once a newer
 * version of the same record (same feed and record key) has been read into passages in a collection the viewer reads,
 * by the as-of. A message or file, or a record change its source declares re-rendered whole, reads as its newest such
 * version; any other change is a delta and keeps its history. A newer version the viewer cannot read retires nothing.
 * Gated on `has_newer`, so an unedited record costs a boolean. The legs, the keyword hits and the neighbours ask this.
 */
export function newerVersionRead(sql: Queryable, fence: Reader, at: VersionAt) {
  // The viewer's whole readable set, never a search's narrowed one: a version they read retires an older one anywhere.
  const readable = fence.readable ?? fence.containers;
  return newerVersionHeld(sql, {
    // Each version's collection is tested on its own row (`offset 0`): the planner never drives the join from the set.
    here: (column) =>
      sql`exists (select 1 from unnest(${readable}::text[]) v(c) where v.c = ${column} offset 0)`,
    at,
  });
}

/**
 * The passage's record is its current version for this viewer (`newerVersionRead`), as a predicate on `p`. Gated on
 * the passage's own copy of the hint (`passage.record_has_newer`): an unflagged passage, nearly every one, never
 * reaches `event_log`, which a range's count and exact read would otherwise do for every candidate before any limit.
 */
function currentForViewer(sql: Queryable, fence: Reader, at: VersionAt) {
  return sql`(not p.record_has_newer or not exists (
      select 1 from event_log e
       where e.id = p.event_id and e.org_id = ${fence.orgId} and e.record_key is not null
         and ${newerVersionRead(sql, fence, at)}
       -- Per row, never hashed: without offset 0 the planner hashes this subquery over every flagged record and keyed
       -- version in the org, a cost that grows with the store instead of the page.
       offset 0))`;
}

/**
 * Of `ids`, those still their record's current version for this viewer: the BM25 leg's hits, which no Postgres
 * leg filtered. A bounded read like the legs (`bounded`: its statement timeout, plan cache mode and `jit = off`).
 */
export async function stillCurrent(
  context: ReadContext,
  {
    fence,
    ids: eventIds,
    asOf,
  }: { fence: Reader; ids: readonly string[]; asOf: PassageFilters["asOf"] },
): Promise<Set<string>> {
  if (eventIds.length === 0) return new Set();
  const at = { ...instantOf(asOf, "passages.search"), whole: hooksOf(context).filters.wholeKeys };
  const rows = await bounded(context, (q) =>
    currentRevisions(q, { orgId: fence.orgId, eventIds, newer: newerVersionRead(q, fence, at) }),
  );
  return new Set(rows.map((r) => r.id));
}

/**
 * The record predicates for a passage leg: the window on the passage's own time, the rest on its record, the build's
 * filters among them (`added`).
 */
export function passageFilter(
  sql: Queryable,
  { fence, filters: f, added }: { fence: Reader; filters: PassageFilters; added: AddedFilters },
) {
  // `containers` is already applied to `fence.containers` by the caller; it must not fall through to the
  // record predicates, which would look for an `event_log` column of that name.
  const { window, asOf, recordIds, since, until, digits, containers: _containers, ...onRecord } = f;
  const { validAt: at, knownAt } = instantOf(asOf, "passages.search");
  const from = window?.from ?? since;
  const to = window?.to ?? until;
  return sql`p.org_id = ${fence.orgId} and ${fenced(sql, fence, { column: sql`p.container`, record: sql`p.event_id` })}
    and p.occurred_at <= ${at}
    and ${currentForViewer(sql, fence, { validAt: at, knownAt, whole: added.wholeKeys })}
    ${
      // Knowledge time: only what the source had been seen to say by then (the record's `observed_at`), never the
      // passage's own `recorded_at`, which a re-read renews. Built only when asked.
      knownAt === null
        ? sql``
        : sql`and exists (select 1 from event_log k
            where k.id = p.event_id and k.org_id = ${fence.orgId} and k.observed_at <= ${knownAt})`
    }
    ${recordIds === undefined ? sql`` : sql`and p.event_id = any(${recordIds}::text[])`}
    ${windowsPredicate(sql, fence.orgId)}
    ${digits === true ? sql`and p.text ~ '[0-9]'` : sql``}
    ${from === undefined ? sql`` : sql`and p.occurred_at >= ${from}`}
    ${to === undefined ? sql`` : sql`and p.occurred_at < ${to}`}
    ${
      hasDocumentFilters(onRecord)
        ? sql`and exists (select 1 from event_log e
            where e.id = p.event_id and e.org_id = ${fence.orgId}
            ${documentPredicates(sql, { added, orgId: fence.orgId, filters: onRecord })})`
        : sql``
    }`;
}
