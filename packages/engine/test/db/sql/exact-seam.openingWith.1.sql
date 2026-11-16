-- exact-seam.openingWith, found by its text
-- parameters: 2
-- read by: an exact code; a figure written another way; an identifier typed joined; a query and the person's question; a search leaving out what was shown; after a date; before a date; between two dates; the ranked view, every page; a matched search paged to its end; one collection; the scored stages: a question; a reader's search for what only others read; a reader naming one they read and one they cannot; a reader's ranked view, every page; lookup: a key a title opens with; lookup by staff: a key only finance holds
-- plan on Postgres 17: Hash Join (Seq Scan on source_revision, Hash > Seq Scan on source_document)


    select d.id, r.title from source_document d join source_revision r on r.event_id = d.current_event_id
    where d.org_id = $1 and d.id = any($2::text[])
