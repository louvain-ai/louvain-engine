-- read-core.namedConnection, found by its text
-- parameters: 19
-- under: set local statement_timeout = 15000; set local jit = off; set local plan_cache_mode = force_custom_plan
-- read by: a plain question; a question sharing no word with its answer; an exact code; the keyword mode; words two near-duplicates share; words from inside a long document; a revised document's current words; a revised document's earlier words; a revised document's earlier words alone; a fact deep in a long document, in other words; a figure written another way; a query and the person's question; a search leaving out what was shown; after a date; before a date; between two dates; the ranked view, every page; a matched search paged to its end; one collection; a word in no document; the scored stages: a question; the scored stages: a title; the scored stages: a dated search; a reader's search for what only others read; a reader's search for a word only a hidden document holds; a reader naming one they read and one they cannot; a reader's keyword search for a hidden word; a reader's ranked view, every page; lookup: a source's path; lookup: an identifier nothing is; lookup: a whole title; lookup: the longest identifier taken; lookup by staff: a key only finance holds; lookup by staff: a key only the board holds; lookup by staff: an identifier nothing is; lookup by finance: a key only the board holds; lookup by finance: an identifier nothing is; search by staff: inside a hidden collection
-- plan on Postgres 17: Limit > Result (Sort > Nested Loop (Nested Loop (Nested Loop (Hash Join (Seq Scan on source_document, Hash > Unique > Sort > Append (Nested Loop (Seq Scan on source_document, Function Scan), Hash Join (Seq Scan on source_document, Hash > Seq Scan on source_revision))), Index Scan on source_revision using source_revision_item_idx), Index Scan on event_log using event_log_pkey), Index Scan on event_log using event_log_pkey, Seq Scan on injection_flag), Seq Scan on event_log > Seq Scan on container_parent, Seq Scan on event_log)


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
    where x.event_id = r.event_id and x.org_id = d.org_id) as "instructionMarker", d.native_id as "nativeId"
      from source_revision r join source_document d on d.id = r.source_id
  join event_log e on e.id = r.event_id
  join event_log ce on ce.id = d.current_event_id
      where d.org_id = $4 and e.org_id = $5 and ce.org_id = $6
    and e.container = any($7::text[]) and ce.container = any($8::text[])
    and true and true and r.event_id = d.current_event_id and d.id in (select d.id from source_document d
    join unnest($9::text[], $10::text[]) as feed(connector, workspace)
      on d.connector = feed.connector and d.workspace = feed.workspace
    where d.org_id = $11 and d.native_id = $12 union select d.id from source_revision r join source_document d on d.current_event_id = r.event_id
    where r.org_id = $13 and d.org_id = $14
      -- sql-shape: source_revision_org_title_key_idx's own expression, read as an index equality
      and lower(left(r.title, $15)) = any(array[lower(left($16, $17))])
      -- sql-shape: the whole title, re-checked on the rows that indexed key returned
      and lower(r.title) = any(array[lower($18)]))
      order by d.current_modified_at desc, d.id
      limit $19
