-- records-in-narrowing.sql+generated+still-current.sql, found by its text
-- parameters: 6
-- under: set local statement_timeout = 15000; set local jit = off; set local plan_cache_mode = force_custom_plan
-- read by: a plain question; a question sharing no word with its answer; an exact code; the keyword mode; words two near-duplicates share; words from inside a long document; a revised document's current words; a revised document's earlier words; a revised document's earlier words alone; a fact deep in a long document, in other words; a figure written another way; an identifier typed joined; a query and the person's question; a search leaving out what was shown; after a date; before a date; between two dates; the ranked view, every page; a matched search paged to its end; the keyword leg; the two legs fused; the keyword leg, on a code; the documents, fused; the documents, reranked; long and short documents, reranked; one collection; one collection, the passages; one collection, the documents; as known on a day; the scored stages: a question; the scored stages: a title; the scored stages: a dated search; a reader's search for what only others read; a reader's documents, reranked; a reader naming one they read and one they cannot; a reader's ranked view, every page; a reader's keyword leg; search by staff: inside a hidden collection
-- plan on Postgres 17: Index Scan on event_log using event_log_pkey > Nested Loop (Index Scan on event_log using event_log_record_key_idx > Function Scan, Index Scan on event_log using event_log_record_key_idx > Function Scan, Seq Scan on passage)


      select e.id from event_log e
       where e.org_id = $1 and e.id = any($2::text[])
         and not (e.record_key is not null and (e.has_newer and exists (
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
                  and exists (select 1 from unnest($3::text[]) v(c) where v.c = m.container offset 0)
                  
                  and jsonb_exists_any(m.body -> 'presentation', $4::text[]))))
         and exists (select 1 from unnest($5::text[]) v(c) where v.c = r2.container offset 0)
         and r2.occurred_at <= $6
         
         and exists (select 1 from passage p2 where p2.event_id = r2.id))))
