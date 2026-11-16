-- unattributed, found by its text
-- parameters: 5
-- under: set local statement_timeout = 15000; set local jit = off; set local plan_cache_mode = force_custom_plan
-- read by: reading a short document; reading a long document; reading a revised document; reading an earlier version
-- plan on Postgres 17: Limit > Sort > Nested Loop (Nested Loop (Nested Loop (Hash Join (Seq Scan on source_revision, Hash > Seq Scan on event_log), ProjectSet > Result), Index Scan on event_log using event_log_actor_email_idx), ProjectSet > Result)


        select s.id, r.title, s.occurred_at as date
        from event_log e
        join event_log s on s.org_id = e.org_id and s.container = e.container and s.kind = 'message'
          and s.id <> e.id and coalesce(
  case when jsonb_typeof(s.body #> '{presentation,email,threadId}') = 'string'
       then nullif(s.body #>> '{presentation,email,threadId}', '') end,
  case when jsonb_typeof(s.body #> '{presentation,thread,id}') = 'string'
       then nullif(s.body #>> '{presentation,thread,id}', '') end) = coalesce(
  case when jsonb_typeof(e.body #> '{presentation,email,threadId}') = 'string'
       then nullif(e.body #>> '{presentation,email,threadId}', '') end,
  case when jsonb_typeof(e.body #> '{presentation,thread,id}') = 'string'
       then nullif(e.body #>> '{presentation,thread,id}', '') end)
        left join source_revision r on r.event_id = s.id
        where e.org_id = $1 and e.id = $2 and e.kind = 'message' and coalesce(
  case when jsonb_typeof(e.body #> '{presentation,email,threadId}') = 'string'
       then nullif(e.body #>> '{presentation,email,threadId}', '') end,
  case when jsonb_typeof(e.body #> '{presentation,thread,id}') = 'string'
       then nullif(e.body #>> '{presentation,thread,id}', '') end) is not null
          and e.container in (select unnest($3::text[])) and true
          and s.container in (select unnest($4::text[])) and true
        order by s.occurred_at, s.id
        limit $5
