-- tenant.workspaceIdOf, found by its text
-- parameters: 0
-- read by: loading the corpus; a plain question
-- plan on Postgres 17: Seq Scan on org

select id::text as id from org where slug = 'default'
