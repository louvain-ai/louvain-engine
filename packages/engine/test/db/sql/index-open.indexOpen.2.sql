-- index-open.indexOpen, found by its text
-- parameters: 2
-- read by: loading the corpus
-- plan on Postgres 17: ModifyTable on event_log > Seq Scan on event_log


    update event_log set index_status = 'done',
      indexed_at = clock_timestamp(), first_indexed_at = coalesce(first_indexed_at, clock_timestamp())
    where id = $1 and org_id = $2::uuid
