-- keyword.markOrWithdraw, found by its text
-- parameters: 2
-- read by: loading the corpus
-- plan on Postgres 17: Seq Scan on event_log


      select 1 from event_log where id = $1 and org_id = $2 
