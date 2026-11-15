-- projection-rows.writeProjection, found by its text
-- parameters: 2
-- read by: loading the corpus
-- plan on Postgres 17: ModifyTable on readable_container_empty > Seq Scan on readable_container_empty


      delete from readable_container_empty where org_id = $1 and principal_id = $2
