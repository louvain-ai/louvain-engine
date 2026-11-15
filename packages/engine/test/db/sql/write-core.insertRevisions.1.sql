-- write-core.insertRevisions, found by its text
-- parameters: 2
-- read by: loading the corpus
-- plan on Postgres 17: ModifyTable on source_revision > Function Scan > Seq Scan on event_log

insert into source_revision
    (event_id, source_id, title, kind, author, location, url, modified_at, metadata_status, content, content_hash, content_truncated, presentation,
     container)
    select r.event_id, source_id, title, r.kind, author, location, url, modified_at::timestamptz,
      metadata_status, content, content_hash, content_truncated, presentation,
      (select e.container from event_log e where e.id = r.event_id and e.org_id = $1)
    from jsonb_to_recordset($2) as r(event_id text, source_id text, title text,
      kind text, author text, location text, url text, modified_at text, metadata_status text,
      content text, content_hash text, content_truncated boolean, presentation jsonb)
    on conflict (event_id) do nothing
