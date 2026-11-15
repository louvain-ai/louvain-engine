-- load-core.openLoadState, found by its text
-- parameters: 2
-- read by: loading the corpus
-- plan on Postgres 17: Seq Scan on readable_container


        -- fence-ok: the loader's own projection rows, read back to rewrite them whole; it reads no record
        select container from readable_container where org_id = $1 and principal_id = $2
