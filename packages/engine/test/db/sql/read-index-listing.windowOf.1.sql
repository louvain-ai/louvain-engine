-- read-index-listing.windowOf, found by its text
-- parameters: 4
-- read by: after a date; before a date; between two dates; the list view over a range nothing matches; the scored stages: a dated search
-- plan on Postgres 17: Result

select
          ($1::date::timestamp at time zone $2) as from,
          (($3::date + 1)::timestamp at time zone $4) - interval '1 millisecond' as to
