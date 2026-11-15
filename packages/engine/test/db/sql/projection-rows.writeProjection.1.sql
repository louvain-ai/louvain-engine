-- projection-rows.writeProjection, found by its text
-- parameters: 2
-- read by: loading the corpus
-- plan on Postgres 17: ModifyTable on readable_container > Seq Scan on readable_container


    delete from readable_container
    where principal_id = $1 and org_id = $2
