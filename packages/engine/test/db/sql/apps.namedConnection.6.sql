-- apps.namedConnection, found by its text
-- parameters: 27
-- under: set local statement_timeout = 15000; set local jit = off; set local plan_cache_mode = force_custom_plan
-- read by: the list view over a range nothing matches; a reader's list view, every page; listing: a collection, every page; listing by staff: a collection, every page; listing by staff: inside a hidden collection
-- plan on Postgres 17: Limit > Result (Sort > Hash Join (Seq Scan on event_log, Hash > Hash Join (Seq Scan on event_log, Hash > Hash Join (Seq Scan on source_revision, Hash > Seq Scan on source_document)), Seq Scan on injection_flag), Seq Scan on event_log > Seq Scan on container_parent, Seq Scan on event_log)

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
    where x.event_id = r.event_id and x.org_id = d.org_id) as "instructionMarker", left(r.content, 600) as excerpt
    from source_document d join source_revision r on r.event_id = d.current_event_id
  join event_log e on e.id = r.event_id
  join event_log ce on ce.id = d.current_event_id
  cross join lateral (select d.id, d.series_key, d.current_modified_at as modified_at) lead_row where d.org_id = $4 and e.org_id = $5 and ce.org_id = $6
    and e.container = any($7::text[]) and ce.container = any($8::text[])
    and true and true 
    and d.id = any($9::text[])
    
    and ($10 = '' or r.kind = $11)
    and ($12 = '' or position(lower($13) in lower(coalesce(r.author, ''))) > 0)
    
    
    
    
    and ($14::date is null or d.current_modified_at >= ($15::date::timestamp at time zone $16)) and ($17::date is null or d.current_modified_at < (($18::date + 1)::timestamp at time zone $19)) and ($20 = '' or coalesce(r.presentation->>'service',
  coalesce($21::jsonb ->> d.connector, d.connector)) = $22)
    and ($23 = '' or case when exists (
      select 1 from container_parent cp
      where cp.org_id = "ce".org_id and cp.child = "ce".container and not (cp.parent = any($24::text[]))
    ) then null else "ce".connection_id::text end = $25)
      
    order by d.current_modified_at desc, d.id asc limit $26 offset $27
