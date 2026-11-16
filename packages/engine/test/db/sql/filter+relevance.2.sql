-- filter+relevance, found by its text
-- parameters: 4
-- read by: a plain question; a question sharing no word with its answer; words two near-duplicates share; words from inside a long document; a revised document's current words; a fact deep in a long document, in other words; a query and the person's question; a search leaving out what was shown; after a date; before a date; between two dates; the ranked view, every page; a matched search paged to its end; one collection; as known on a day; a word in no document; the scored stages: a question; the scored stages: a title; the scored stages: a dated search; a reader's search for what only others read; a reader's search for a word only a hidden document holds; a reader naming one they read and one they cannot; a reader's ranked view, every page; search by staff: inside a hidden collection
-- plan on Postgres 17: Aggregate > Hash Join (Seq Scan on passage, Hash > ProjectSet > Result)


    select p.event_id as id,
      max(1 - ("p"."embedding" <=> $1::vector))::float8 as meaning
    from passage p
    where p.org_id = $2 and p.event_id = any($3::text[])
      and p.container in (select unnest($4::text[]))
    group by p.event_id
