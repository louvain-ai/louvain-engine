-- SEARCH TERMS, NUMBERS: a key's numbers compared as numbers (leading zeros dropped) and a search's key matched as its
-- catenation or the phrase of its parts. Applied after `1-search-terms.sql` by `./engine reindex`, in the same
-- transaction; every row's `terms` refilled, since the forms changed.

create or replace function search_delimited(t text) returns text
language sql immutable parallel safe as $$
  select coalesce(string_agg(numbered || ' ' || regexp_replace(w, '[-.,_/]', '', 'g') || ' ' || replace(numbered, ' ', ''), ' '), '')
  from (
    select w, regexp_replace(
        regexp_replace(
          regexp_replace(
            regexp_replace(w, '[-.,_/]', ' ', 'g'),
            '([[:alpha:]])([[:digit:]])', '\1 \2', 'g'),
          '([[:digit:]])([[:alpha:]])', '\1 \2', 'g'),
        '(^| )0+([0-9])', '\1\2', 'g') as numbered
    from (
      select m[1] as w
      from regexp_matches(search_fold(t),
        '([[:alnum:]]+(?:[-.,_/][[:alnum:]]+)+|[[:alnum:]]*(?:[[:alpha:]][[:digit:]]|[[:digit:]][[:alpha:]])[[:alnum:]]*)', 'g') as m
    ) tokens
  ) split
$$;

create or replace function search_keys(q text) returns tsquery
language sql immutable parallel safe as $$
  select to_tsquery('simple', string_agg(form, ' | '))
  from (
    select case
      when cardinality(parts) > 1 then
        '(' || quote_literal(array_to_string(parts, '')) || ' | '
          || (select string_agg(quote_literal(p), ' <-> ' order by i) from unnest(parts) with ordinality u(p, i))
          || ')'
      else quote_literal(array_to_string(parts, ''))
    end as form
    from (
      select regexp_split_to_array(trim(regexp_replace(
          regexp_replace(
            regexp_replace(
              regexp_replace(m[1], '[-.,_/]', ' ', 'g'),
              '([[:alpha:]])([[:digit:]])', '\1 \2', 'g'),
            '([[:digit:]])([[:alpha:]])', '\1 \2', 'g'),
          '(^| )0+([0-9])', '\1\2', 'g')), ' +') as parts
      from regexp_matches(search_fold(q),
        '([[:alnum:]]+(?:[-.,_/][[:alnum:]]+)+|[[:alnum:]]*(?:[[:alpha:]][[:digit:]]|[[:digit:]][[:alpha:]])[[:alnum:]]*)', 'g') as m
    ) tokens
  ) forms
$$;

update passage set text = text;

update source_revision set content = content;
