-- record.recordToIndex, found by its text
-- parameters: 2
-- read by: loading the corpus
-- plan on Postgres 17: Seq Scan on event_log


    select id, workspace, container, connector, occurred_at, actor_id, body, org_id, actor_relays
    from event_log where id = $1 
      and kind = any($2::text[])
