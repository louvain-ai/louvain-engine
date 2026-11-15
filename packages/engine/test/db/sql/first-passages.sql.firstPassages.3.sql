-- first-passages.sql.firstPassages, found by its text
-- parameters: 7
-- read by: a plain question; a question sharing no word with its answer; an exact code; the keyword mode; words two near-duplicates share; words from inside a long document; a revised document's current words; a revised document's earlier words; a revised document's earlier words alone; a fact deep in a long document, in other words; an identifier typed joined; a query and the person's question; a search leaving out what was shown; after a date; before a date; the keyword leg; the two legs fused; the keyword leg, on a code; the documents, fused; the documents, reranked; long and short documents, reranked; one collection; one collection, the passages; one collection, the documents; as known on a day; the scored stages: a question; the scored stages: a title; the scored stages: a dated search; a reader's search for what only others read; a reader's documents, reranked; a reader naming one they read and one they cannot; a reader's ranked view, every page; a reader's keyword leg; search by staff: inside a hidden collection
-- plan on Postgres 17: Unique (Result, Sort > Seq Scan on passage (Seq Scan on event_log, Seq Scan on event_log, Function Scan))


    select distinct on (event_id) id::text, event_id, seq, text, container, author, relayed, occurred_at,
      (select g.occurred_precision from event_log g
        where g.org_id = passage.org_id and g.id = passage.event_id) as occurred_precision,
      -- A document an agent wrote, read whole, keeps the mark its passages carry.
      exists (select 1 from event_log g where g.org_id = passage.org_id and g.id = passage.event_id
            and g.body #>> '{presentation,document,via}' = any($1::text[])) as generated,
      -- Read as reference by the build's one reading, which referenceRead asks too.
      exists (select 1 from event_log g
              where g.org_id = passage.org_id and g.id = passage.event_id
                and coalesce('knowledge'::text, 'reference') <> 'knowledge') as reference
      from passage
     where org_id = $2 and event_id = any($3::text[])
       and container = any($4)
      and occurred_at <= $5
      
     order by event_id,
      coalesce(strpos(regexp_replace(text, '\s+', ' ', 'g'), (select regexp_replace(f.fragment, '\s+', ' ', 'g')
      from unnest($6::text[], $7::text[]) as f(event_id, fragment) where f.event_id = passage.event_id)) > 0,
      false) desc,
      seq
