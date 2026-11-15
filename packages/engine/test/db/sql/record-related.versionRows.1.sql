-- record-related.versionRows, found by its text
-- parameters: 8
-- under: set local statement_timeout = 15000; set local jit = off; set local plan_cache_mode = force_custom_plan
-- read by: reading a short document; reading a long document; reading a revised document; reading an earlier version
-- plan on Postgres 17: Limit > Sort > Nested Loop (Nested Loop (Nested Loop (Nested Loop (Nested Loop (Nested Loop (Hash Join (Seq Scan on source_document, Hash > Seq Scan on source_revision), Seq Scan on event_log), ProjectSet > Result), Seq Scan on source_document), Index Scan on source_revision using source_revision_item_idx), Index Scan on event_log using event_log_pkey), ProjectSet > Result)


        with own as (
          select d.id as document_id, d.origin_key
          from event_log e
          join source_revision r on r.event_id = e.id
          join source_document d on d.id = r.source_id and d.org_id = e.org_id
          where e.org_id = $1 and e.id = $2
            and e.container in (select unnest($3::text[])) and true
        )
        select v.event_id as id, v.title, v.modified_at as date,
               v.source_id = own.document_id as same_document, v.event_id = $4 as is_self
        from own
        join source_document d on d.org_id = $5
          and (d.id = own.document_id or (own.origin_key is not null and d.origin_key = own.origin_key))
        join source_revision v on v.source_id = d.id
        join event_log ve on ve.id = v.event_id and ve.org_id = $6
        where ve.container in (select unnest($7::text[])) and true
        order by v.modified_at desc, v.event_id desc
        limit $8
