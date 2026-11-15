-- write-core.upsertDocuments, found by its text
-- parameters: 1
-- read by: loading the corpus
-- plan on Postgres 17: ModifyTable on source_document (Subquery Scan > Unique > Sort > Function Scan > Seq Scan on event_log, Seq Scan on event_log, Seq Scan on source_revision, Seq Scan on event_log, Seq Scan on event_log, Seq Scan on source_revision, Seq Scan on event_log, Seq Scan on event_log, Seq Scan on source_revision, Seq Scan on event_log, Seq Scan on event_log, Seq Scan on source_revision, Seq Scan on event_log, Seq Scan on event_log, Seq Scan on source_revision, Seq Scan on event_log, Seq Scan on event_log, Seq Scan on source_revision, Seq Scan on event_log, Seq Scan on event_log, Seq Scan on source_revision, Seq Scan on event_log)

insert into source_document (id, org_id, connector, workspace, native_id, origin_key, series_key, current_event_id, current_modified_at)
    select distinct on (org_id, connector, workspace, native_id)
      id, org_id::uuid, connector, workspace, native_id, origin_key, series_key, current_event_id, current_modified_at::timestamptz
    from jsonb_to_recordset($1) as d(id text, org_id text, connector text,
      workspace text, native_id text, origin_key text, series_key text, current_event_id text, current_modified_at text)
    order by org_id, connector, workspace, native_id, coalesce((select v.version_rank from event_log v where v.id = d.current_event_id), current_modified_at::timestamptz) desc, current_event_id desc
    on conflict (org_id, connector, workspace, native_id) do update set
      current_event_id = case when source_document.current_event_id is null or coalesce((select v.version_rank from event_log v where v.id = source_document.current_event_id), coalesce((select r.modified_at from source_revision r where r.event_id = source_document.current_event_id), source_document.current_modified_at)) < coalesce((select v.version_rank from event_log v where v.id = excluded.current_event_id), excluded.current_modified_at)
          or (coalesce((select v.version_rank from event_log v where v.id = source_document.current_event_id), coalesce((select r.modified_at from source_revision r where r.event_id = source_document.current_event_id), source_document.current_modified_at)) = coalesce((select v.version_rank from event_log v where v.id = excluded.current_event_id), excluded.current_modified_at)
            and source_document.current_event_id is not null
            and source_document.current_event_id < excluded.current_event_id)
        then excluded.current_event_id else source_document.current_event_id end,
      series_key = case when source_document.current_event_id is null or coalesce((select v.version_rank from event_log v where v.id = source_document.current_event_id), coalesce((select r.modified_at from source_revision r where r.event_id = source_document.current_event_id), source_document.current_modified_at)) < coalesce((select v.version_rank from event_log v where v.id = excluded.current_event_id), excluded.current_modified_at)
          or (coalesce((select v.version_rank from event_log v where v.id = source_document.current_event_id), coalesce((select r.modified_at from source_revision r where r.event_id = source_document.current_event_id), source_document.current_modified_at)) = coalesce((select v.version_rank from event_log v where v.id = excluded.current_event_id), excluded.current_modified_at) -- sql-shape: the conflicting row only, as current_event_id's case above
            and source_document.current_event_id is not null
            and source_document.current_event_id < excluded.current_event_id)
        then excluded.series_key else source_document.series_key end,
      -- A document a replacement kept for this revision takes the revision's time, not the withdrawn one's.
      current_modified_at = case when source_document.current_event_id is null or coalesce((select v.version_rank from event_log v where v.id = source_document.current_event_id), coalesce((select r.modified_at from source_revision r where r.event_id = source_document.current_event_id), source_document.current_modified_at)) < coalesce((select v.version_rank from event_log v where v.id = excluded.current_event_id), excluded.current_modified_at) then excluded.current_modified_at
        else greatest(source_document.current_modified_at, excluded.current_modified_at) end,
      origin_key = coalesce(source_document.origin_key, excluded.origin_key),
      -- A document a replacement kept for this revision has one again.
      revisionless_since = null
    where source_document.current_event_id is null or coalesce((select v.version_rank from event_log v where v.id = source_document.current_event_id), coalesce((select r.modified_at from source_revision r where r.event_id = source_document.current_event_id), source_document.current_modified_at)) < coalesce((select v.version_rank from event_log v where v.id = excluded.current_event_id), excluded.current_modified_at)
      or (coalesce((select v.version_rank from event_log v where v.id = source_document.current_event_id), coalesce((select r.modified_at from source_revision r where r.event_id = source_document.current_event_id), source_document.current_modified_at)) = coalesce((select v.version_rank from event_log v where v.id = excluded.current_event_id), excluded.current_modified_at)
        and source_document.current_event_id is not null
        and source_document.current_event_id < excluded.current_event_id)
      or (source_document.origin_key is null and excluded.origin_key is not null)
