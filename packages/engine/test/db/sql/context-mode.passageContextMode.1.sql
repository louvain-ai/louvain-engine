-- context-mode.passageContextMode, found by its text
-- parameters: 1
-- read by: loading the corpus
-- plan on Postgres 17: Seq Scan on org


    select passage_context as mode from org where id = $1
