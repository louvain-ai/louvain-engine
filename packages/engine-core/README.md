# @louvain/engine-core

The engine's core: the contracts and types every layer above shares, and the pure functions of ranking and excerpting
(`fuse`, `decay`, `excerpt`). It does no I/O and holds no process state. Its source imports nothing outside the package
but `node:crypto` and one small library with no dependencies of its own: `zod` (the contracts' schemas);
`test/core-imports.test.ts` fails when a file imports anything else.

`@louvain/engine-core` is its one door, and `package.json` exports nothing else: `src/index.ts` re-exports every
module (the plugin kinds and their contracts, the configuration and its registry, the Host, who reads, and the pure
functions). The package declares `"sideEffects": false`, so a bundler keeps only the modules whose names are used.

The contracts the engine reads (the ingest event and its kinds, a source's row, evidence and answer shapes) live here,
and an application built on the engine re-exports them rather than defining its own, so one definition serves both. The
text helpers (HTML stripping, decoding character references) are the file readers' own: `@louvain/doctext/text`.

`ingest/source.ts` and `ingest/item.ts` are the contract every way into the engine is written against: an ingest
source names a collection and yields items, each with a key and either text or a file to read. What the engine then
accepts of an item is the engine's (`packages/engine/src/open/ingest/check-item.ts`). `readers/contract.ts` is the
contract a file reader is written against.

`host.ts` is the one type a deployment binds: every seam (who may read what, how a record is shown, how a paid call is
metered, how a work item's effects are committed), each with what happens when nothing is bound.

```sh
pnpm --filter @louvain/engine-core test
```
