# source-records

A records file: one JSON item a line (the item's fields are on the ingest page), from a file or from standard input
(`-`). It is read a line at a time and a line past its bound is refused while it is read, so no file or line is held
whole. A line that is not an item is reported by its number and the rest go on. It removes only the keys it marks
`{"key": …, "removed": true}`.

    ./engine ingest records --records tickets.jsonl
    my-export | ./engine ingest records --records - --collection tickets

It is one of the two sources the engine runs when engine.config.ts names none. Its tests are the engine's ingest
tests.
