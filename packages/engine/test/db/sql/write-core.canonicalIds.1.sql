-- write-core.canonicalIds, found by its text
-- parameters: 2
-- read by: loading the corpus
-- plan on Postgres 17: Unique > Sort > Hash Join (Function Scan, Hash > Seq Scan on source_document)


    select distinct s.id, s.connector, s.workspace, s.native_id from source_document s
    join jsonb_to_recordset($1) as d(connector text, workspace text, native_id text)
      on s.connector = d.connector and s.workspace = d.workspace and s.native_id = d.native_id
    where s.org_id = $2
