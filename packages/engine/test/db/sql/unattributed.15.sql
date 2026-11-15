-- unattributed, found by its text
-- parameters: 6
-- under: set local statement_timeout = 15000; set local jit = off; set local plan_cache_mode = force_custom_plan
-- read by: a question sharing no word with its answer; an exact code; the keyword mode; words two near-duplicates share; words from inside a long document; a revised document's current words; a revised document's earlier words; a revised document's earlier words alone; a fact deep in a long document, in other words; a figure written another way; an identifier typed joined; a query and the person's question; a search leaving out what was shown; after a date; before a date; between two dates; the ranked view, every page; a matched search paged to its end; the list view; the list view, every page; the list view over a range nothing matches; one collection; one collection, the list view; as known on a day; the scored stages: a question; the scored stages: a title; the scored stages: a dated search; a reader's search for what only others read; a reader's list view, every page; a reader naming one they read and one they cannot; a reader's ranked view, every page; lookup: a source's path; lookup: a key a title opens with; lookup: a whole title; lookup by staff: a key only finance holds; listing: a collection, every page; listing by staff: a collection, every page; listing by staff: inside a hidden collection; search by staff: inside a hidden collection
-- plan on Postgres 17: Nested Loop (Nested Loop (Nested Loop (Nested Loop (Hash Join (Seq Scan on source_revision, Hash > Seq Scan on source_document), Index Scan on event_log using event_log_pkey), Index Scan on event_log using event_log_pkey), ProjectSet > Result), ProjectSet > Result)


      select d.id, ce.container
      from source_revision r join source_document d on d.id = r.source_id
  join event_log e on e.id = r.event_id
  join event_log ce on ce.id = d.current_event_id
      where d.org_id = $1 and e.org_id = $2 and ce.org_id = $3
    and e.container in (select unnest($4::text[])) and ce.container in (select unnest($5::text[]))
    and true and true and r.event_id = d.current_event_id and d.id = any($6::text[])
