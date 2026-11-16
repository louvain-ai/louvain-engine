-- unattributed, found by its text
-- parameters: 2
-- read by: loading the corpus
-- plan on Postgres 17: LockRows > Seq Scan on event_log

select id from event_log where id = $1
    and org_id = $2  for update
