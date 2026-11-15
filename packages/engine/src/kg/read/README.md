# Read primitives (in the engine)

Everything the engine reads goes through this directory, and every read is fenced first.

## The fence

`fence.ts` is the one way a read is fenced:

- A `ReadContext` is what every read runs on, passed first where a read takes the pool: the engine's store (its pool
  and the bounds every bounded read keeps), the handle the read runs on (the store's pool, or a transaction the caller
  holds), the resolver of who may read what, and the build's read hooks (below). Only `readContextOf` makes one; the
  engine's is `engine.context` (`createEngine`).
- `fence(context, viewer, within?)` resolves a reader (an org and the reader's id) into the collections it may read,
  through the context's resolver, narrowed to `within` when a read names collections. It returns a `Reader`, or null
  when the reader reads nothing.
- `bounded(context, fn)` runs a read in its own transaction under the store's statement timeout and plan settings: on
  the store's pool it is the store's own bounded read (`store.ts`), which times its wait for a connection; inside a
  caller's transaction it runs there as is.
- `Reader` is a type only `fence()` makes (`narrow()` and `readsNothing()` are its own two variants), so a read holds a
  set the fence resolved or none at all.
- `fenced(sql, reader, column)` is the one predicate: every query puts it in its WHERE clause, beside the org, before
  it orders, limits or folds, so nothing outside the fence can be ranked, counted or shown.

Whose set a fence reads is the resolver the read's context was made with: the engine's host's (`createEngine`). The
engine's own is `open-readable-set.ts` over its pool (`openHost(sql)`): the collections the `readable_container` table
holds for that reader in that org, written by `projection-rows.ts` when a folder is loaded. A reader with no rows reads
nothing. Nothing binds it: each entry builds its engine with the host, and every read is handed the engine's context.

## Search

`passages.ts` holds `searchPassages`, which runs the search legs and fuses them:

- `passages-vector.ts`: the vector leg, over the embeddings the sidecar wrote (`question.ts` holds the query vector);
- `keyword-index.ts`: what a build's keyword index answers, holds and asks, a second matcher's reads among them (its
  passes, its title and recency reads, its words test): the open build keeps none; `bm25.ts`: the keyword sidecar's
  client (the keyword leg itself is `plugins/retriever-keyword`);
- `legs.ts`: each leg's scan settings;
- `fuse.ts`: reciprocal-rank fusion; `decay.ts`: a recency weight;
- `passages-filter.ts`: the one predicate every passage read states its fence, as-of and record filters through;
- `documents.ts`: a page regrouped by the record each row came from.

`passages-by-id.ts`, `passages-around.ts` and `passage-windows.ts` read a passage's record and its neighbours,
under the same fence.

## Hooks

A few reads ask a question the engine answers simply and a larger deployment may answer differently: how a record is
read, what a source's detail names, the predicates added after the fence, what the source tools' pages name, what the
keyword index answers and which vector space a workspace is searched in. Each is a hook the read's context carries
(`hooks.ts`, `ReadHooks`), asked through `hooksOf(context)` alone; a context made with none, as the engine's is, reads
the engine's own answer, the same constant every time. `fence()` reads none of them. What only the writes ask (how a
record is cut into passages, what follows a passage write) travels in the write's own value (`../../writes.ts`,
`Writes`, asked through `writeHooksOf`), which the engine hands its writes beside the pool (`Engine.writes`).
