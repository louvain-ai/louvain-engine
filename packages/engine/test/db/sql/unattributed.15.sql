-- unattributed, found by its text
-- parameters: 6
-- under: set local statement_timeout = 15000; set local jit = off; set local plan_cache_mode = force_custom_plan
-- read by: reading a short document; reading a long document; reading a revised document; reading an earlier version
-- plan on Postgres 17: Nested Loop (Seq Scan on event_log, ProjectSet > Result, Nested Loop (Hash Join (Seq Scan on source_document, Hash > Seq Scan on source_revision), Index Scan on event_log using event_log_pkey, ProjectSet > Result, Nested Loop (Hash Join (Seq Scan on event_log, Hash > Seq Scan on source_revision), ProjectSet > Result)), Seq Scan on injection_flag)


        select e.id, e.container, e.connector, e.kind, e.occurred_at, e.occurred_precision, e.actor_id,
               coalesce((
    select case
      when ce.id is not null and ce.container in (select unnest($1::text[])) and true
        then d.current_event_id = e.id
      else not exists (
        select 1 from source_revision r2 join event_log e2 on e2.id = r2.event_id
        where r2.source_id = d.id and e2.org_id = e.org_id and r2.event_id <> e.id
          and e2.container in (select unnest($2::text[])) and true
          and (r2.modified_at > r.modified_at
            or (r2.modified_at = r.modified_at and r2.event_id > r.event_id)))
    end
    from source_revision r
    join source_document d on d.id = r.source_id and d.org_id = e.org_id
    left join event_log ce on ce.id = d.current_event_id and ce.org_id = e.org_id
    where r.event_id = e.id
  ), false) as current,
               (select x.marker from injection_flag x
                 where x.event_id = e.id and x.org_id = e.org_id) as instruction_marker
        from event_log e
        where e.org_id = $3 and e.id = $4
          and e.container in (select unnest($5::text[])) and e.occurred_at <= $6
          
          and true
