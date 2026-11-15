-- unattributed, found by its text
-- parameters: 11
-- under: set local statement_timeout = 15000; set local jit = off; set local plan_cache_mode = force_custom_plan
-- read by: between two dates
-- plan on Postgres 17: Nested Loop (Hash Join (Seq Scan on event_log, Hash > Index Scan on passage using passage_container_order_idx > Hash Join (Seq Scan on event_log, Hash > Hash Join (Index Scan on event_log using event_log_record_key_idx > Function Scan, Hash > Seq Scan on passage), Seq Scan on event_log > Function Scan)), ProjectSet > Result, Limit > Seq Scan on source_revision)


          select p.event_id, p.container, p.occurred_at::text as at, e.connector, e.workspace, e.record_key,
                 e.body->'presentation' as presentation,
                 (select s.kind from source_revision s where s.event_id = p.event_id limit 1) as kind
            from passage p join event_log e on e.id = p.event_id and e.org_id = p.org_id
           where p.org_id = $1 and p.container in (select unnest($2::text[]))
    and p.occurred_at <= $3
    and (not p.record_has_newer or not exists (
      select 1 from event_log e
       where e.id = p.event_id and e.org_id = $4 and e.record_key is not null
         and (e.has_newer and exists (
      select 1 from event_log r2
       where r2.org_id = e.org_id and r2.connector = e.connector and r2.workspace = e.workspace
         and r2.record_key = e.record_key and (coalesce(r2.version_rank, r2.occurred_at), r2.id)
    > (coalesce(e.version_rank, e.occurred_at), e.id)
         and (
           (e.kind in ('message', 'file') and r2.kind in ('message', 'file'))
           or (e.kind = 'record.change' and r2.kind = 'record.change'
             and r2.connection_id = e.connection_id
             and exists (
               select 1 from event_log m
                where m.connection_id = e.connection_id and m.record_key = e.record_key
                  and m.kind = 'record.change' and m.org_id = e.org_id
                  and exists (select 1 from unnest($5::text[]) v(c) where v.c = m.container offset 0)
                  
                  and jsonb_exists_any(m.body -> 'presentation', $6::text[]))))
         and exists (select 1 from unnest($7::text[]) v(c) where v.c = r2.container offset 0)
         and r2.occurred_at <= $8
         
         and exists (select 1 from passage p2 where p2.event_id = r2.id)))
       -- Per row, never hashed: without offset 0 the planner hashes this subquery over every flagged record and keyed
       -- version in the org, a cost that grows with the store instead of the page.
       offset 0))
    
    and p.event_id = any($9::text[])
    
    
    and p.occurred_at >= $10
    and p.occurred_at < $11
     and p.seq = 0
