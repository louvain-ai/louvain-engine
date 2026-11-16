# Architecture

**In short:** a command builds one engine from the configuration, runs, and closes it. Ingest writes documents,
passages, vectors and keywords to Postgres; search reads them back through the fence, by meaning and by words, and
fuses the two. Everything a deployment may change is a plugin named in `engine.config.ts`.

## The path of a document

```
files, records ─▶ source ─▶ file reader ─▶ ingest ─▶ Postgres + keyword index
                  folder     documents      passages, vectors, keywords
                  records    text
                  http

agent ─▶ tool server (/mcp) ─▶ search ─▶ vector leg   ─┐
                                         keyword leg  ─┼─▶ fuse ─▶ rerank ─▶ documents
                                         figures leg  ─┘
                                         (each a fenced read)
```

A source lists items; a file reader turns a file's bytes into text; ingest decides what is new, changed or gone and
writes it. A search runs its legs inside the reader's readable set, fuses their ranks, reranks when a reranker is
configured, and returns whole documents with the passages that matched.

## The code map

**`packages/engine-core`**: the contracts every plugin is written against (`plugins/plugin.ts` lists the kinds), the
configuration (`defineEngine`), the plugin registry, and the pure functions of ranking (`fuse.ts`, `decay.ts`). It does
no I/O and imports nothing but `zod` and `node:crypto`; its own test fails on any other import. Everything imports it
by one name, `@louvain/engine-core` (`src/index.ts`): its `package.json` exports nothing else.

**`packages/engine`**: the engine itself, one value built by `createEngine` (`src/engine.ts`) from parts its caller
passes whole: the store, the embedder, the started plugins, the host and the settings, and, for a build that adds to the
open reads and writes, its hooks (`hooks`, none here). Every read runs on its context (`engine.context`: the store and
the handle the read runs on, the host's resolver of who may read what, the hooks) and every write on its writes
(`engine.writes`), so neither who may read what nor what a build adds is bound per process. It opens nothing of its
own: an entry opens its store (`src/store/pool.ts` `openStore`: the pool, its plan and JIT settings, and the bounds every
bounded read keeps) and the engine ends it (`close`). It depends on no plugin: the CLI chooses the defaults, and the two
shipped readers are only its tests' devDependencies. Where its counts, timings and lines go are parts too (`telemetry`,
nowhere unless given; `logger`, its own unless given), carried by its context and writes. A search cursor's key, the
keyword index's settings and group commit (its keyword index's `endpoint`) and the lines it has said once are the
engine's own, not its modules', so two engines in one process do not share them; the few things still kept once per
process are listed in the [security model](security-model.md). Everything is imported by one name, `@louvain/engine` (`src/index.ts`, the only export of the published
package), and nothing it reaches opens a socket, a file or a timer while it loads. What each of these guarantees for who may read
what, what none of them does, and how each is checked is the [security model](security-model.md).
- `src/ingest/`: one ingest for every source (its sources in `src/ingest/sources/`). It adds a new key, leaves an
  unchanged one alone, replaces an updated one and withdraws a removed one.
- `src/read/`: the fenced reads. Every read resolves the reader's readable set once and applies it inside each
  statement it sends. Listing and reading documents, by collection and folder, are `src/read/listing/`.
- `src/search/`: the search as stages: the pool, the fused legs, the rerank, the documents.
- `src/server/`: the tool server: its routes, the MCP tools (`src/server/tools/`) and the HTTP ingest door.
- `src/cli/`: what `./engine` prints and parses; `src/host/`: how an entry builds its engine (the standalone reader,
  the embedder).
- `src/store/`: the pool, its settings and ids, and the clients of the keyword index and the embedder.
- `src/readers/`: the bounds every file reader is held to (`src/readers/bounded.ts`) and their registry.
- `src/text/`: pure text helpers.
- `src/plugins/`: the built-in plugins that live with the engine: the `vector`, `keyword` and `figures` retrievers,
  the `folder` and `records` sources, and the `mcp()` surface.
- `src/config/`: every setting, declared once, with its default and its bounds.

**`packages/cli`**: the commands. `config-file.ts` loads `engine.config.ts` (no file runs the defaults; a file that
throws stops the start), `defaults.ts` lists what runs when a kind is left out, `profile.ts` picks the profile, and
`engine.ts` opens the engine a command runs.

**`packages/plugins`**: one package per plugin, each importing the core and nothing of the engine's (the general
reader also imports doctext):
`reader-documents`, `reader-text`, `reranker-sidecar`, `reranker-cohere`, `source-http`. `templates/` holds what
`./engine plugin new` writes a new one from.

**`packages/doctext`**: a file's bytes to its text. Files are hostile input, so it bounds archive members,
decompressed size, pages and time before it reads.

**`packages/embeddings`**: the embedding client. It embeds through the embedding sidecar, a query lane and a bulk
lane, and states which vector space its vectors are in.

**`packages/netguard`**: the one rule for a fetch made on someone else's say-so: resolve once, refuse a private
address, connect to the address that was checked. The fetch the engine hands a source (`tools.fetch`) goes through
it.

**`apps/app`**: the app at `/app/` (the `app()` surface): Search and Ask in a browser, and the answerers
Ask writes with (`agent`, `scripted`).

**`apps/nlp`**: the Python sidecars: `embed.py` (embeddings), `bm25.py` (the keyword index) and `rerank.py` (the
local reranker). Each takes the install's sidecar token.

**`db/`**: `baseline.sql`, the schema an empty database is loaded with, and `upgrades/`, what `./engine reindex`
applies to a database the release before made.

**`profiles/`**: configurations of their own, each with its own corpus and index. The one the published figure was
produced with ships here ([How the figure was produced](benchmark-method.md)).

## Where each command starts

`./engine` is a bash script (`engine`) that checks the machine, runs Docker Compose and calls one entry per command:

| Command | Entry |
| --- | --- |
| `./engine up` | `packages/cli/src/serve.ts`: the tool server and the app |
| `./engine ingest <source> --<field> …` | `packages/cli/src/ingest.ts` |
| `./engine search "<words>"` | `packages/cli/src/search.ts` |
| `./engine reindex` | `packages/cli/src/reindex.ts`, after the schema upgrade in place |
| `./engine profile [set <name>]` | `engine` itself, over `packages/cli/src/profile.ts` |
| `./engine plugin new <kind> <name>` | `engine` itself, from `packages/plugins/templates/<kind>/` |

## What is deliberately absent

- **No second reader.** This build's host has one reader, who reads every collection loaded. The fence is still
  applied in every statement, so an engine built on a host with another readable set narrows every read without a
  change to them.
- **No queue and no worker.** Ingest runs in the process that took the items (the command, or the server for the
  HTTP door) and says what it changed when it ends.
- **No language model in ingest.** No model reads a document; passages are cut by rule and embedded.
- **No connectors.** A way in is a source: a folder, a records file, the HTTP door, or one you write.
- **No telemetry sent anywhere.** The engine carries no vendor SDK; its timing and counts go nowhere unless its builder
  gives it a sink (`EngineParts.telemetry`), and they never carry a document's text.
