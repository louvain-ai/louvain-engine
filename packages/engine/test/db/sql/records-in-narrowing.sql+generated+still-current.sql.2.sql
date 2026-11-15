-- records-in-narrowing.sql+generated+still-current.sql, found by its text
-- parameters: 3
-- under: set local statement_timeout = 15000; set local jit = off; set local plan_cache_mode = force_custom_plan
-- read by: before a date
-- plan on Postgres 17: Seq Scan on event_log


      select e.id from event_log e
       where e.org_id = $1 and e.id = any($2::text[])
        and e.occurred_at < $3
