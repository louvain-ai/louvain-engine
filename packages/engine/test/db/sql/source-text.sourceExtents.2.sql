-- source-text.sourceExtents, found by its text
-- parameters: 4
-- under: set local statement_timeout = 15000; set local jit = off; set local plan_cache_mode = force_custom_plan
-- read by: reading a short document; reading a long document; reading a revised document; reading an earlier version
-- plan on Postgres 17: Hash Join (Seq Scan on source_revision, Hash > Seq Scan on event_log)


      select e.id, length(e.body->>'text') as chars, e.body #>> '{presentation,document,format}' as format,
             coalesce(r.presentation->'document'->>'truncated', 'false') = 'true' as ingest
      from event_log e left join source_revision r on r.event_id = e.id
      where e.org_id = $1 and e.container = any($2::text[])
        and e.id = any($3::text[]) and e.occurred_at <= $4
        and true
