-- search.reachOf, found by its text
-- parameters: 3
-- under: set local statement_timeout = 15000; set local jit = off; set local plan_cache_mode = force_custom_plan
-- read by: a plain question; a question sharing no word with its answer; an exact code; the keyword mode; words two near-duplicates share; words from inside a long document; a revised document's current words; a revised document's earlier words; a revised document's earlier words alone; a fact deep in a long document, in other words; a figure written another way; an identifier typed joined; a query and the person's question; a search leaving out what was shown; after a date; before a date; between two dates; the ranked view, every page; a matched search paged to its end; the list view; the list view, every page; the list view over a range nothing matches; one collection; one collection, the list view; as known on a day; a word in no document; the scored stages: a question; the scored stages: a title; the scored stages: a dated search; a reader's search for what only others read; a reader's search for a word only a hidden document holds; a reader's list view, every page; a reader naming one they read and one they cannot; a reader's keyword search for a hidden word; a reader's ranked view, every page; lookup: a source's path; lookup: a key a title opens with; lookup: an identifier nothing is; lookup: a whole title; lookup: a URL nothing is at; lookup: the longest identifier taken; lookup by staff: a key only finance holds; lookup by staff: a key only the board holds; lookup by staff: an identifier nothing is; lookup by finance: a key only the board holds; lookup by finance: an identifier nothing is; listing: a collection, every page; listing by staff: a collection, every page; listing by staff: inside a hidden collection; search by staff: inside a hidden collection
-- plan on Postgres 17: Aggregate > Limit > Seq Scan on event_log


      select count(*)::int as events from (
        select 1 from event_log
        where org_id = $1 and container = any($2::text[])
        limit $3) t
