-- filter+relevance, found by its text
-- parameters: 3
-- read by: an exact code; the keyword mode; a revised document's earlier words; a revised document's earlier words alone; a figure written another way; an identifier typed joined
-- plan on Postgres 17: Group > Sort > Nested Loop (Seq Scan on passage, ProjectSet > Result)


    select p.event_id as id,
      null::float8 as meaning
    from passage p
    where p.org_id = $1 and p.event_id = any($2::text[])
      and p.container in (select unnest($3::text[]))
    group by p.event_id
