-- keyword.writeKeywordEntry, found by its text
-- parameters: 2
-- read by: loading the corpus
-- plan on Postgres 17: ModifyTable on event_log > Seq Scan on event_log

update event_log set keyword_indexed_at = now()
        where id = $1 and org_id = $2 
