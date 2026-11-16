-- write.flagOlderVersions, found by its text
-- parameters: 2
-- read by: loading the corpus
-- plan on Postgres 17: ModifyTable on passage > Nested Loop (Hash Join (Seq Scan on passage, Hash > Seq Scan on event_log), Seq Scan on event_log)


      update passage p set record_has_newer = true
        from event_log n, event_log o
       where n.id = any($1::text[]) and n.org_id = $2 and n.record_key is not null
         and o.org_id = n.org_id and o.connector = n.connector and o.workspace = n.workspace
         and o.record_key = n.record_key and o.has_newer and (coalesce(n.version_rank, n.occurred_at), n.id)
    > (coalesce(o.version_rank, o.occurred_at), o.id)
         and p.event_id = o.id and p.org_id = o.org_id and not p.record_has_newer
