-- apps.namedConnection, found by its text
-- parameters: 15
-- under: set local statement_timeout = 15000; set local jit = off; set local plan_cache_mode = force_custom_plan
-- read by: the list view over a range nothing matches; a reader's list view, every page; listing: a collection, every page; listing by staff: a collection, every page; listing by staff: inside a hidden collection
-- plan on Postgres 17: Sort > Aggregate > Sort > Subquery Scan > Limit > Result (Sort > Hash Join (Seq Scan on event_log, Hash > Hash Join (Seq Scan on event_log, Hash > Hash Join (Seq Scan on source_revision, Hash > Seq Scan on source_document))), Seq Scan on container_parent)

select app, "connectionId", count(*)::int as count from (
    select coalesce(r.presentation->>'service',
  coalesce($1::jsonb ->> d.connector, d.connector)) as app, case when exists (
      select 1 from container_parent cp
      where cp.org_id = "ce".org_id and cp.child = "ce".container and not (cp.parent = any($2::text[]))
    ) then null else "ce".connection_id::text end as "connectionId"
    from source_document d join source_revision r on r.event_id = d.current_event_id
  join event_log e on e.id = r.event_id
  join event_log ce on ce.id = d.current_event_id
  cross join lateral (select d.id, d.series_key, d.current_modified_at as modified_at) lead_row where d.org_id = $3 and e.org_id = $4 and ce.org_id = $5
    and e.container = any($6::text[]) and ce.container = any($7::text[])
    and true and true 
    and d.id = any($8::text[])
    
    
    
    
    
    
    
    and ($9::date is null or d.current_modified_at >= ($10::date::timestamp at time zone $11)) and ($12::date is null or d.current_modified_at < (($13::date + 1)::timestamp at time zone $14)) 
    order by d.current_modified_at desc, d.id asc limit $15) t
    group by app, "connectionId" order by count(*) desc, app, "connectionId"
