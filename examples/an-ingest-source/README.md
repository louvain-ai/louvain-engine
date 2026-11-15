# An ingest source of your own

`changelog.ts` is a whole ingest source: every release in a Markdown changelog becomes one item, keyed by its version
and dated by its heading. It is written against the engine's public contract (`IngestSource` in
`packages/engine-core/src/ingest-sources/contract.ts`) and touches nothing else in the engine. Registered as a plugin
(`IngestSourcePlugin`), the same source also has a name and a schema for its settings, which is how the engine's own
three are written.

```sh
node --import tsx examples/an-ingest-source/changelog.ts CHANGELOG.md | ./engine ingest records --records - --collection changelog
```

Run as a script, it prints its items as JSON Lines, which is what `./engine ingest records --records` reads, so the engine takes
them with no code of yours inside it. Run it again after editing one release's notes and only that release is
updated.

A source names a collection and yields items. Each item needs a `key` and either `text` or a `file` to read. It can
also carry a title, a kind, dates and a link. The engine decides everything else, the same way for every source:

- what is new, changed, moved or gone;
- how a file is read;
- what may be removed, and when.

A source that lists its whole collection (`lists: "all"`) lets the engine remove what it no longer lists. One that lists
only what it sends (`"some"`) removes only the items it marks `removed`.
