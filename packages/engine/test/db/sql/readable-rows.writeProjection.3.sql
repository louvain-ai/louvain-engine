-- readable-rows.writeProjection, found by its text
-- parameters: 3
-- read by: loading the corpus
-- plan on Postgres 17: ModifyTable on readable_container > Function Scan


      insert into readable_container (principal_id, container, org_id)
      select $1, c, $2 from unnest($3::text[]) as c
      on conflict (org_id, principal_id, container) do nothing
