-- record.headerRecordOf, found by its text
-- parameters: 2
-- read by: loading the corpus
-- plan on Postgres 17: Nested Loop (Seq Scan on source_revision, Seq Scan on event_log)

select r.kind, r.title, r.author, r.location from source_revision r
      join event_log e on e.id = r.event_id and e.org_id = $1
     where r.event_id = $2
