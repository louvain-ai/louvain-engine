-- resolve.documentOf, found by its text
-- parameters: 12
-- read by: reading a short document; reading a long document; reading a revised document; reading an earlier version; a reader opening a hidden document; a reader opening a document that does not exist
-- plan on Postgres 17: Limit > Append (Nested Loop (Nested Loop (Hash Join (Seq Scan on event_log, Hash > Seq Scan on source_document), Index Scan on event_log using event_log_pkey), Index Scan on source_revision using source_revision_pkey), Nested Loop (Nested Loop (Hash Join (Seq Scan on source_document, Hash > Seq Scan on source_revision), Seq Scan on event_log), Index Scan on event_log using event_log_pkey))


    (select d.id as "documentId", r.event_id as "recordId"
      from source_revision r join source_document d on d.id = r.source_id
  join event_log e on e.id = r.event_id
  join event_log ce on ce.id = d.current_event_id where d.org_id = $1 and e.org_id = $2 and ce.org_id = $3
    and e.container = any($4::text[]) and ce.container = any($5::text[])
    and true and true and d.id = $6 and r.event_id = d.current_event_id)
    union all
    (select d.id as "documentId", r.event_id as "recordId"
      from source_revision r join source_document d on d.id = r.source_id
  join event_log e on e.id = r.event_id
  join event_log ce on ce.id = d.current_event_id where d.org_id = $7 and e.org_id = $8 and ce.org_id = $9
    and e.container = any($10::text[]) and ce.container = any($11::text[])
    and true and true and r.event_id = $12)
    limit 1
