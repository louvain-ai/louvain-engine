-- nearest-in-window.sql.nearestInWindow, found by its text
-- parameters: 11
-- under: set local statement_timeout = 15000; set local jit = off; set local plan_cache_mode = force_custom_plan; set local hnsw.iterative_scan = relaxed_order; set local hnsw.ef_search = 120
-- read by: after a date; the scored stages: a dated search
-- plan on Postgres 17: Sort > Hash Join (Seq Scan on passage, Hash > Subquery Scan > Limit > Sort > Nested Loop (Bitmap Heap Scan on passage (Bitmap Index Scan using passage_occurred_idx, Hash Join (Seq Scan on event_log, Hash > Hash Join (Index Scan on event_log using event_log_record_key_idx > Function Scan, Hash > Seq Scan on passage), Seq Scan on event_log > Function Scan)), Materialize > ProjectSet > Result))


      select p.id::text as id, p.event_id, p.seq, p.text, p.container, p.author, p.occurred_at, 1 - w.distance as score from (
        select id, distance from (
          select p.id, p."embedding" <=> $1::vector as distance
            from passage p
           where p.org_id = $2 and p.container in (select unnest($3::text[]))
    and p.occurred_at <= $4
    and (not p.record_has_newer or not exists (
      select 1 from event_log e
       where e.id = p.event_id and e.org_id = $5 and e.record_key is not null
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
                  and exists (select 1 from unnest($6::text[]) v(c) where v.c = m.container offset 0)
                  
                  and jsonb_exists_any(m.body -> 'presentation', $7::text[]))))
         and exists (select 1 from unnest($8::text[]) v(c) where v.c = r2.container offset 0)
         and r2.occurred_at <= $9
         
         and exists (select 1 from passage p2 where p2.event_id = r2.id)))
       -- Per row, never hashed: without offset 0 the planner hashes this subquery over every flagged record and keyed
       -- version in the org, a cost that grows with the store instead of the page.
       offset 0))
    
    
    
    
    and p.occurred_at >= $10
    
     and p."embedding" is not null
          offset 0) c
         order by distance, id
         limit $11) w
       join passage p on p.id = w.id
       order by w.distance, w.id
