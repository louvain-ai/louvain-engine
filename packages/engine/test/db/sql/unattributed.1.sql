-- unattributed, found by its text
-- parameters: 10
-- under: set local statement_timeout = 15000; set local jit = off; set local plan_cache_mode = force_custom_plan
-- read by: before a date
-- plan on Postgres 17: Aggregate > Limit > Nested Loop (Bitmap Heap Scan on passage (Bitmap Index Scan using passage_occurred_idx, Hash Join (Seq Scan on event_log, Hash > Hash Join (Index Scan on event_log using event_log_record_key_idx > Function Scan, Hash > Seq Scan on passage), Seq Scan on event_log > Function Scan)), Materialize > ProjectSet > Result)


        select count(*)::int as n from (
          select 1 from passage p
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
    
    
    
    
    
    and p.occurred_at < $9
     and p."embedding" is not null
           limit $10) w
