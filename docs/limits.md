# Limits and known defects

**In short:** the table lists every bound and the setting that moves it. A leg or sidecar that misses its bound
costs only that leg, and the page names it in `degraded`.

## Bounds

| What | Bound | Setting |
| --- | --- | --- |
| A file a reader is handed | 32 MB, regular files only | `LOUVAIN_FILE_MAX_BYTES` |
| Text a reader returns | 1,000,000 characters | `LOUVAIN_FILE_MAX_CHARS` |
| Time a reader takes on one file | 60 seconds | `LOUVAIN_FILE_READ_DEADLINE_MS` |
| An item's key | 1,000 characters | |
| An item's text | 2,000,000 characters | |
| An item's title, container, author, app, revision | 1,000, 500, 200, 60 and 200 characters | |
| An item's file path, URL | 4,096 characters each | |
| A collection's name | 100 characters: letters, digits, dashes, underscores | |
| An HTTP ingest request | 8 MB and 500 items; one at a time, another is answered 429 | |
| A token (read or ingest) | at least 32 characters | `LOUVAIN_ENGINE_TOKEN`; the `http()` source's `token` |
| A folder run's removals | more than 10 items and more than half the collection need `--yes` | |
| A collection's ingest lease | 5 minutes, renewed while a run works | |
| A records or request tombstone | 90 days | |
| A tool call's reply | 60 seconds | `settings.server.toolDeadlineMs` in `engine.config.ts` |
| A ranked page | 24 documents, the first 10 in full | |
| A compact hit's excerpt | 200 characters | |
| A list-view page | 1 to 100 documents, 50 by default | |
| `exclude` | 200 ids | |
| Documents that lead as what a search names | 20 | |
| Keys of one search looked up | 3 | |
| `outsideWindow` | 5 documents | |
| A person's question beside a search | 2,000 characters, the rest cut | |
| How deep a leg reads | 3 passages per document asked for | |
| A page of `louvain_read_source` | 40,000 characters | |
| `louvain_lookup_source` | 20 documents that are it, 1 to 50 mentions (20 by default), an identifier of 4,096 characters | |
| A read statement | 15 seconds | |
| A keyword sidecar call | 3 seconds | |
| An embedding call | 30 seconds, 180 on the bulk lane | |
| A rerank call | 4 seconds (30 on the shipped, commented local reranker line) | `timeoutMs` in engine.config.ts, which reads `LOUVAIN_RERANK_TIMEOUT_MS` |

To move a bound, set its setting in `.env` and run `./engine down`, then `./engine up`.

## Limits of this build

- **One reader.** Whoever holds the read token reads every document loaded ([Permissions](permissions.md)).
- **A reader that blocks cannot be stopped.** The bounds run in the engine's process; a reader that loops without
  yielding holds it.
- **The match floor is known for one embedder.** A document matches by meaning only above a floor measured for
  `Xenova/bge-base-en-v1.5` (0.57). With another model, documents match by their words, identifiers and figures alone.
- **A changed embedding model needs a fresh database.** Vectors from different models share no space.
- **Loading has no bulk mode yet.** Documents load in batches, but each passage is added to the meaning index as it is
  written (about 1.2 ms a passage) and each record is accepted on its own (about 4 ms), measured on an Apple M1 Max:
  about 80 records a second with embedding left aside, 5 a second with the CPU embedder ([Configuration](configuration.md)).
  Building the meaning index once after a large first load, and accepting a batch's records together, would load
  faster.

## Known defects

Three defects are recorded as `todo` tests, each stating what will hold once fixed. Run the search ones with
`pnpm --filter @louvain/engine test:db` ([Operations](operations.md)) and the third with
`pnpm --filter @louvain/engine test`; each reports as `todo`, not a failure.

| Defect | Test |
| --- | --- |
| **A superseded revision can show as a hit.** Words only an earlier revision holds can rank the document with that revision's date and excerpt, unmarked. This happens with revisions written as events with no record key; a file revised in a folder and loaded again has its earlier revision withdrawn | `a superseded revision is never a ranked hit`; case `a revised document's earlier words alone` (`packages/engine/test/db/search.cases.ts`) |
| **A fact deep in a long document, asked in other words, falls out of the first ten.** A document ranks by its best passage, so a lone passage that shares no word with the search can rank low | `a fact deep in a long document is in the first ten`; case `a fact deep in a long document, in other words` (`packages/engine/test/db/search.deep.cases.ts`) |
| **An unauthenticated caller can tell which of the app's paths exist.** The sign-in route and the app's public page answer before a token is checked | `tells an unauthenticated caller nothing about which paths exist` (`packages/engine/test/open-surfaces.test.ts`) |
