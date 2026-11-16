-- first-passages.sql.firstPassages, found by its text
-- parameters: 5
-- read by: a figure written another way; between two dates; the ranked view, every page; a matched search paged to its end
-- plan on Postgres 17: Unique (Result, Sort > Seq Scan on passage (Seq Scan on event_log, Seq Scan on event_log))


    select distinct on (event_id) id::text, event_id, seq, text, container, author, relayed, occurred_at,
      (select g.occurred_precision from event_log g
        where g.org_id = passage.org_id and g.id = passage.event_id) as occurred_precision,
      -- A document an agent wrote, read whole, keeps the mark its passages carry.
      exists (select 1 from event_log g where g.org_id = passage.org_id and g.id = passage.event_id
            and g.body #>> '{presentation,document,via}' = any($1::text[])) as generated,
      -- Read as reference by the build's one reading, which referenceRead asks too.
      exists (select 1 from event_log g
              where g.org_id = passage.org_id and g.id = passage.event_id
                and coalesce('knowledge'::text, 'reference') <> 'knowledge') as reference
      from passage
     where org_id = $2
       and container = any($3::text[])
       and event_id = any($4::text[])
      and occurred_at <= $5
      
     order by event_id,
      
      seq
