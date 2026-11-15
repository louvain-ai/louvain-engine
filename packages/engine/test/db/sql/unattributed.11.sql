-- unattributed, found by its text
-- parameters: 3
-- read by: loading the corpus
-- plan on Postgres 17: Nested Loop (Seq Scan on source_revision, Seq Scan on source_document)


    select d.id, d.current_modified_at as modified, coalesce(r.presentation->>'service',
  coalesce($1::jsonb ->> d.connector, d.connector)) as app
    from source_revision r join source_document d on d.id = r.source_id and d.current_event_id = r.event_id
    where r.event_id = $2 and d.org_id = $3
