-- write.insertRows, found by its text
-- parameters: 15
-- read by: loading the corpus
-- plan on Postgres 17: ModifyTable on passage (Seq Scan on event_log, Function Scan)


    insert into passage (org_id, event_id, workspace, container, author, seq, text, embedding, occurred_at,
                         relayed, context, context_key,   record_has_newer)
    select $1::uuid, $2, $3, $4, $5,
           u.seq, u.text, u.vec::vector, $6::timestamptz, $7,
           u.context, u.key, 
           
           (select has_newer from event_log where id = $8 and org_id = $9)
      from unnest($10::int[], $11::text[],
                  $12::text[], $13::text[],
                  $14::text[], $15::text[])
        as u(seq, text, vec, context, key, vec_ctx)
    on conflict (event_id, seq) do update set 
      
      text = excluded.text, embedding = excluded.embedding, context = excluded.context, context_key = excluded.context_key
    where passage.text is distinct from excluded.text returning id::text as id
