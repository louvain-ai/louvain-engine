-- indexer.indexOpen, found by its text
-- parameters: 2
-- read by: loading the corpus
-- plan on Postgres 17: Seq Scan on event_log > Aggregate > Seq Scan on passage


    select keyword_indexed_at,
      (select count(*)::int from passage p where p.event_id = e.id and p.org_id = e.org_id) as passages
    from event_log e where id = $1 and org_id = $2::uuid
