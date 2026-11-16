-- generated.instructionLikeRevisions, found by its text
-- parameters: 4
-- read by: a plain question; a question sharing no word with its answer; an exact code; the keyword mode; words two near-duplicates share; words from inside a long document; a revised document's current words; a revised document's earlier words; a revised document's earlier words alone; a fact deep in a long document, in other words; a figure written another way; an identifier typed joined; a query and the person's question; a search leaving out what was shown; after a date; before a date; between two dates; the ranked view, every page; a matched search paged to its end; the vector leg; the keyword leg; the two legs fused; the vector leg, by meaning; the keyword leg, on a code; the documents, fused; the documents, reranked; long and short documents, reranked; one collection; one collection, the passages; one collection, the documents; as known on a day; a word in no document; the scored stages: a question; the scored stages: a title; the scored stages: a dated search; a reader's search for what only others read; a reader's search for a word only a hidden document holds; a reader's documents, reranked; a reader naming one they read and one they cannot; a reader's ranked view, every page; a reader's vector leg; a reader's keyword leg; search by staff: inside a hidden collection
-- plan on Postgres 17: Append (Seq Scan on injection_flag, Nested Loop (Seq Scan on event_log, Seq Scan on injection_flag))


      select event_id as id, marker from injection_flag
      where org_id = $1::uuid and event_id = any($2::text[])
      union all
      select e.id, left(coalesce(nullif(regexp_replace(coalesce(e.error, ''), '^injection:\s*', ''), ''), 'injection'), 80)
      from event_log e
      where e.org_id = $3::uuid and e.id = any($4::text[]) and e.outcome = 'quarantined'
        and not exists (select 1 from injection_flag x where x.event_id = e.id)
