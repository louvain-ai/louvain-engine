-- unattributed, found by its text
-- parameters: 3
-- read by: a plain question; a question sharing no word with its answer; an exact code; the keyword mode; words two near-duplicates share; words from inside a long document; a revised document's current words; a revised document's earlier words; a revised document's earlier words alone; a fact deep in a long document, in other words; a figure written another way; an identifier typed joined; a query and the person's question; a search leaving out what was shown; after a date; before a date; between two dates; the ranked view, every page; a matched search paged to its end; the documents, fused; the documents, reranked; long and short documents, reranked; one collection; one collection, the documents; as known on a day; a word in no document; the scored stages: a question; the scored stages: a title; the scored stages: a dated search; a reader's search for what only others read; a reader's search for a word only a hidden document holds; a reader's documents, reranked; a reader naming one they read and one they cannot; a reader's ranked view, every page; search by staff: inside a hidden collection
-- plan on Postgres 17: Hash Join (Seq Scan on event_log, Hash > ProjectSet > Result)


    select id from event_log
     where org_id = $1 and id = any($2::text[])
       and container in (select unnest($3::text[]))
