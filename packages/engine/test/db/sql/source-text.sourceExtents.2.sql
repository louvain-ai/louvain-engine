-- source-text.sourceExtents, found by its text
-- parameters: 23
-- under: set local statement_timeout = 15000; set local jit = off; set local plan_cache_mode = force_custom_plan
-- read by: the list view over a range nothing matches; a reader's list view, every page; listing: a collection, every page; listing by staff: a collection, every page; listing by staff: inside a hidden collection
-- plan on Postgres 17: Aggregate > Limit > Sort > Hash Join (Seq Scan on event_log, Hash > Hash Join (Seq Scan on event_log, Hash > Hash Join (Seq Scan on source_revision, Hash > Seq Scan on source_document)))

select count(*)::int as count from (
    select 1 from source_document d join source_revision r on r.event_id = d.current_event_id
  join event_log e on e.id = r.event_id
  join event_log ce on ce.id = d.current_event_id
  cross join lateral (select d.id, d.series_key, d.current_modified_at as modified_at) lead_row where d.org_id = $1 and e.org_id = $2 and ce.org_id = $3
    and e.container = any($4::text[]) and ce.container = any($5::text[])
    and true and true 
    and d.id = any($6::text[])
    
    and ($7 = '' or r.kind = $8)
    and ($9 = '' or position(lower($10) in lower(coalesce(r.author, ''))) > 0)
    
    
    
    
    and ($11::date is null or d.current_modified_at >= ($12::date::timestamp at time zone $13)) and ($14::date is null or d.current_modified_at < (($15::date + 1)::timestamp at time zone $16)) and ($17 = '' or coalesce(r.presentation->>'service',
  coalesce($18::jsonb ->> d.connector, d.connector)) = $19)
    and ($20 = '' or case when exists (
      select 1 from container_parent cp
      where cp.org_id = "ce".org_id and cp.child = "ce".container and not (cp.parent = any($21::text[]))
    ) then null else "ce".connection_id::text end = $22)
      
    order by d.current_modified_at desc, d.id asc limit $23) t
