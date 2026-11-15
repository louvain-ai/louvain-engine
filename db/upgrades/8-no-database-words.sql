-- THE OPEN DATABASE KEEPS NO WORDS OF ITS OWN: the keyword index is the one matcher, and no open read or write names a
-- passage's or a revision's English words any more, so the generated `search` columns, the context's `search_ctx`, their
-- GIN indexes, the title-words index and the extension those indexes needed leave. Applied by `./engine reindex` to a
-- database made by an earlier release, in one transaction that rolls back unless the result has exactly this release's
-- schema. Idempotent: every drop names what it drops and passes over what is already gone. No document, passage or
-- revision is deleted.
drop index if exists passage_org_search_idx;
drop index if exists passage_search_ctx_idx;
drop index if exists passage_search_idx;
drop index if exists source_revision_org_search_idx;
drop index if exists source_revision_org_title_words_idx;
drop index if exists source_revision_search_idx;
alter table passage drop column if exists search;
alter table passage drop column if exists search_ctx;
alter table source_revision drop column if exists search;
-- The extension the `(org_id, search)` indexes needed: no index of the open schema uses it now.
drop extension if exists btree_gin;
