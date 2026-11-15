-- source-text.sourceExtents, found by its text
-- parameters: 7
-- read by: reading an earlier version
-- plan on Postgres 17: Nested Loop (Nested Loop (Hash Join (Seq Scan on event_log, Hash > Seq Scan on source_document), Seq Scan on source_revision), Seq Scan on event_log)


    select d.id as "documentId", r.event_id as "recordId"
    from source_revision r join source_document d on d.id = r.source_id
  join event_log e on e.id = r.event_id
  join event_log ce on ce.id = d.current_event_id where d.org_id = $1 and e.org_id = $2 and ce.org_id = $3
    and e.container = any($4::text[]) and ce.container = any($5::text[])
    and true and true and d.id = $6 and r.event_id = $7
