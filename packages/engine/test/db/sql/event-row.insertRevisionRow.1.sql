-- event-row.insertRevisionRow, found by its text
-- parameters: 19
-- read by: loading the corpus
-- plan on Postgres 17: ModifyTable on event_log > Result


      insert into event_log
        (id, idempotency_key, connector, workspace, container, kind,
         occurred_at, occurred_precision, observed_at, actor_id, actor_email, actor_display_name, actor_relays, body,
         visibility, org_id, record_key, parent_ids, index_status)
      values
        ($1, $2, $3, $4,
         $5, $6, $7, $8, $9,
         $10, $11,
         $12,
         $13,
         $14,
         $15, $16, $17,
         $18,
         $19)
      on conflict do nothing
      returning id
