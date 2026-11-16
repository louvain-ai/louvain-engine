-- passages.chunksToWrite, found by its text
-- parameters: 2
-- read by: loading the corpus
-- plan on Postgres 17: Seq Scan on passage

select seq, text from passage
    where event_id = $1 and org_id = $2 
