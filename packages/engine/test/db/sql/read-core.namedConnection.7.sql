-- read-core.namedConnection, found by its text
-- parameters: 3
-- read by: a plain question; a question sharing no word with its answer; an exact code; the keyword mode; words two near-duplicates share; words from inside a long document; a revised document's current words; a revised document's earlier words; a revised document's earlier words alone; a fact deep in a long document, in other words; a figure written another way; an identifier typed joined; a query and the person's question; a search leaving out what was shown; after a date; before a date; between two dates; the ranked view, every page; a matched search paged to its end; the list view; the list view, every page; one collection; one collection, the list view; as known on a day; the scored stages: a question; the scored stages: a title; the scored stages: a dated search; a reader's search for what only others read; a reader naming one they read and one they cannot; a reader's ranked view, every page; search by staff: inside a hidden collection
-- plan on Postgres 17: Unique > Sort > Hash Join (Seq Scan on event_log, Hash > ProjectSet > Result, Seq Scan on container_parent)


    select distinct on (e.container) e.container, case when exists (
      select 1 from container_parent cp
      where cp.org_id = "e".org_id and cp.child = "e".container and not (cp.parent = any($1::text[]))
    ) then null else "e".connection_id::text end as "connectionId"
    from event_log e where e.org_id = $2 and e.container in (select unnest($3::text[]))
    order by e.container, e.id
