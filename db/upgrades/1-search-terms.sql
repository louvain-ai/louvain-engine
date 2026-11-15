-- SEARCH TERMS: documents and searches pass through the same analyzer (the word-delimiter step, `search_delimited`).
-- Applied by `./engine reindex` to a database made by the release before it, in one transaction that rolls back unless
-- the result has exactly this release's schema. Additive and idempotent: the functions, the `terms` columns, the
-- triggers that fill them, their indexes, and the rows already written filled.

create or replace function search_fold(t text) returns text
language sql immutable parallel safe as $$
  select translate(lower(coalesce(t, '')), 'àáâãäåçèéêëìíîïñòóôõöùúûüýÿ', 'aaaaaaceeeeiiiinooooouuuuyy')
$$;

create or replace function search_delimited(t text) returns text
language sql immutable parallel safe as $$
  select coalesce(string_agg(
    regexp_replace(
      regexp_replace(
        regexp_replace(w, '[-.,_/]', ' ', 'g'),
        '([[:alpha:]])([[:digit:]])', '\1 \2', 'g'),
      '([[:digit:]])([[:alpha:]])', '\1 \2', 'g')
    || ' ' || regexp_replace(w, '[-.,_/]', '', 'g'), ' '), '')
  from (
    select m[1] as w
    from regexp_matches(
      search_fold(t),
      '([[:alnum:]]+(?:[-.,_/][[:alnum:]]+)+|[[:alnum:]]*(?:[[:alpha:]][[:digit:]]|[[:digit:]][[:alpha:]])[[:alnum:]]*)',
      'g') as m
  ) tokens
$$;

create or replace function search_terms(t text) returns tsvector
language sql immutable parallel safe as $$
  select to_tsvector('english', search_fold(t)) || to_tsvector('simple', search_delimited(t))
$$;

-- A SEARCH'S KEYS AND FIGURES, whole: each delimited or mixed token as its catenation ("SUP-1042" -> `sup1042`, "2,400"
-- -> `2400`), never its parts, so a key matches the documents holding that key and not every one sharing a part of it.
create or replace function search_keys(q text) returns tsquery
language sql immutable parallel safe as $$
  select to_tsquery('simple', string_agg(quote_literal(regexp_replace(m[1], '[-.,_/]', '', 'g')), ' | '))
  from regexp_matches(search_fold(q),
    '([[:alnum:]]+(?:[-.,_/][[:alnum:]]+)+|[[:alnum:]]*(?:[[:alpha:]][[:digit:]]|[[:digit:]][[:alpha:]])[[:alnum:]]*)', 'g') as m
$$;

-- A SEARCH THROUGH THE SAME ANALYZER, as a query: the English lexemes of its other words, or any of its keys and figures
-- whole (`search_keys`). Any of them matches. Null when it has none.
create or replace function search_query(q text) returns tsquery
language sql immutable parallel safe as $$
  select case
    when words.found is null then search_keys(q)
    when search_keys(q) is null then words.found
    else words.found || search_keys(q)
  end
  from (
    select to_tsquery('simple', string_agg(quote_literal(lexeme), ' | ')) as found
    from unnest(to_tsvector('english', regexp_replace(search_fold(q),
      '([[:alnum:]]+(?:[-.,_/][[:alnum:]]+)+|[[:alnum:]]*(?:[[:alpha:]][[:digit:]]|[[:digit:]][[:alpha:]])[[:alnum:]]*)', ' ', 'g')))
  ) words
$$;

alter table passage add column if not exists terms tsvector;
alter table source_revision add column if not exists terms tsvector;

create or replace function passage_terms_fill() returns trigger
language plpgsql as $$
begin
  -- The passage's words and its header context, as the keyword passes read them (`search_ctx` beside `search`).
  new.terms := search_terms(new.text) || search_terms(new.context);
  return new;
end
$$;

create or replace function source_revision_terms_fill() returns trigger
language plpgsql as $$
begin
  new.terms := setweight(search_terms(new.title), 'A') || setweight(search_terms(new.content), 'B');
  return new;
end
$$;

create or replace trigger passage_terms_fill
  before insert or update of text, context on passage
  for each row execute function passage_terms_fill();

create or replace trigger source_revision_terms_fill
  before insert or update of title, content on source_revision
  for each row execute function source_revision_terms_fill();

create index if not exists passage_org_terms_idx on passage using gin (org_id, terms);

create index if not exists source_revision_org_terms_idx on source_revision using gin (org_id, terms);

update passage set text = text where terms is null;

update source_revision set content = content where terms is null;
