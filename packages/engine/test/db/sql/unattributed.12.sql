-- unattributed, found by its text
-- parameters: 3
-- read by: loading the corpus
-- plan on Postgres 17: Seq Scan on event_log (Hash Join (Seq Scan on source_document, Hash > Seq Scan on source_revision), Seq Scan on source_revision)

select keyword_indexed_at, connector, (select coalesce(r.presentation->>'service',
  coalesce($1::jsonb ->> d.connector, d.connector)) from source_revision r
    join source_document d on d.id = r.source_id where r.event_id = event_log.id) as app,
    (select r.title from source_revision r where r.event_id = event_log.id) as title
    from event_log where id = $2 and org_id = $3 
