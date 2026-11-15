-- SEARCH TERMS, SHINGLES: a document's key indexed as every contiguous run of its parts joined, and a search's key
-- asked as its joined form alone, never as the phrase of its parts (which met prose). Applied after the earlier
-- upgrade files by `./engine reindex`, in the same transaction; every row's `terms` refilled, since the forms changed.

create or replace function search_delimited(t text) returns text
language sql immutable parallel safe as $$
  select coalesce(string_agg(
      array_to_string(parts, ' ')
      || ' ' || regexp_replace(w, '[-.,_/]', '', 'g')
      || coalesce(' ' || (
           select string_agg(array_to_string(parts[i:j], ''), ' ' order by j - i, i)
           from generate_series(1, cardinality(parts)) i, generate_series(i + 1, cardinality(parts)) j
           where cardinality(parts) <= 8 and j - i < cardinality(parts) - 1
             and parts[i] ~ '^[[:alpha:]]'), '')
      || ' ' || array_to_string(parts, ''), ' '), '')
  from (
    select w, regexp_split_to_array(trim(regexp_replace(
        regexp_replace(
          regexp_replace(
            regexp_replace(w, '[-.,_/]', ' ', 'g'),
            '([[:alpha:]])([[:digit:]])', '\1 \2', 'g'),
          '([[:digit:]])([[:alpha:]])', '\1 \2', 'g'),
        '(^| )0+([0-9])', '\1\2', 'g')), ' +') as parts
    from (
      select m[1] as w
      from regexp_matches(search_fold(t),
        '([[:alnum:]]+(?:[-.,_/][[:alnum:]]+)+|[[:alnum:]]*(?:[[:alpha:]][[:digit:]]|[[:digit:]][[:alpha:]])[[:alnum:]]*)', 'g') as m
    ) tokens
  ) split
$$;

create or replace function search_keys(q text) returns tsquery
language sql immutable parallel safe as $$
  select to_tsquery('simple', string_agg(quote_literal(array_to_string(parts, '')), ' | '))
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
$$;

update passage set text = text;
update source_revision set content = content;
