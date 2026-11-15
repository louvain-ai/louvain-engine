-- read-core.namedConnection, found by its text
-- parameters: 9
-- read by: a plain question; a question sharing no word with its answer; an exact code; the keyword mode; words two near-duplicates share; words from inside a long document; a revised document's current words; a revised document's earlier words; a revised document's earlier words alone; a fact deep in a long document, in other words; a figure written another way; an identifier typed joined; a query and the person's question; a search leaving out what was shown; after a date; before a date; between two dates; the ranked view, every page; a matched search paged to its end; reading a short document; reading a long document; reading a revised document; reading an earlier version; the documents, fused; the documents, reranked; long and short documents, reranked; one collection; one collection, the documents; as known on a day; a word in no document; the scored stages: a question; the scored stages: a title; the scored stages: a dated search; a reader's search for what only others read; a reader's search for a word only a hidden document holds; a reader's documents, reranked; a reader naming one they read and one they cannot; a reader's ranked view, every page; search by staff: inside a hidden collection
-- plan on Postgres 17: Sort > Hash Join (Hash Join (Hash Join (Hash Join (Hash Join (Seq Scan on event_log, Hash > Seq Scan on source_revision), Hash > Seq Scan on source_document), Hash > Seq Scan on event_log), Hash > ProjectSet > Result), Hash > ProjectSet > Result, Seq Scan on event_log > Seq Scan on container_parent, Seq Scan on event_log, Seq Scan on injection_flag)

select d.id, r.event_id as "versionId", coalesce(r.presentation->>'service',
  coalesce($1::jsonb ->> d.connector, d.connector)) as app,
  (select case when exists (
      select 1 from container_parent cp
      where cp.org_id = "x".org_id and cp.child = "x".container and not (cp.parent = any($2::text[]))
    ) then null else "x".connection_id::text end from event_log x where x.id = d.current_event_id) as "connectionId",
  r.title, r.kind, r.author, r.location, r.url, r.modified_at as "sourceUpdatedAt",
  (select case when x.occurred_at = r.modified_at then x.occurred_precision end
    from event_log x where x.id = r.event_id) as "datePrecision",
  r.indexed_at as "indexedAt", r.metadata_status as "metadataStatus",
  d.origin_key as "originKey", d.org_id::text as "orgId",
  null as "occursAt", false as held,
  d.series_key as "seriesKey",
  coalesce(r.presentation #>> '{document,via}' = any($3::text[]), false) as generated,
  r.presentation #>> '{document,via}' as via, r.presentation #>> '{document,agent}' as "generatedAgent",
  r.presentation #>> '{document,onBehalfOf}' as "generatedOnBehalfOf",
  (select x.marker from injection_flag x
    where x.event_id = r.event_id and x.org_id = d.org_id) as "instructionMarker" from source_revision r join source_document d on d.id = r.source_id
  join event_log e on e.id = r.event_id
  join event_log ce on ce.id = d.current_event_id
    where d.org_id = $4 and e.org_id = $5 and ce.org_id = $6
    and e.container in (select unnest($7::text[])) and ce.container in (select unnest($8::text[]))
    and true and true and r.event_id = any($9::text[]) order by r.modified_at desc, r.event_id
