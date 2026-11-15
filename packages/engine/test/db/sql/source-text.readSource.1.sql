-- source-text.readSource, found by its text
-- parameters: 4
-- under: set local statement_timeout = 15000; set local jit = off; set local plan_cache_mode = force_custom_plan
-- read by: reading a short document; reading a long document; reading a revised document; reading an earlier version
-- plan on Postgres 17: Nested Loop (Seq Scan on event_log, Seq Scan on source_revision, Limit > Sort > Seq Scan on passage)


      select e.body->>'text' as text, e.body #>> '{presentation,document,format}' as format,
             coalesce(r.presentation->'document'->>'truncated', 'false') = 'true' as ingest,
             (select p.id::text from passage p
               where p.org_id = e.org_id and p.event_id = e.id and p.container = e.container
               order by p.seq limit 1) as passage_id
      from event_log e left join source_revision r on r.event_id = e.id
      where e.org_id = $1 and e.id = $2
        and e.container = any($3) and e.occurred_at <= $4
        and true
