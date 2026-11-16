-- indexer.indexOpen, found by its text
-- parameters: 2
-- read by: loading the corpus
-- plan on Postgres 17: Seq Scan on event_log


    select id from event_log where id = any($1::text[]) and org_id = $2::uuid
