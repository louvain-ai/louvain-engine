-- THE TABLES THE OPEN FILTERS NO LONGER READ: stars (`is:starred`), record labels (the participant and genre filters)
-- and identifier sources (a narrowing), which only an application's bound predicates read now, and the append-only
-- trigger function only the labels used. Applied by `./engine reindex` to a database made by an earlier release, in one
-- transaction that rolls back unless the result has exactly this release's schema. Idempotent: every drop names what
-- it drops and passes over what is already gone. No row of a table the engine keeps is changed.

-- The tables, together, so nothing between them needs an order; their indexes, keys and triggers go with them.
drop table if exists star, kg_record_label, kg_identifier_source;

drop function if exists kg_refuse_update_but_in_force();
