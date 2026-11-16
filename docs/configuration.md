# Configuration

**In short:** addresses, ports and keys go in `.env` (the shell's value wins); which plugins run, and how the engine
behaves, go in `engine.config.ts`. Run `./engine up` after changing either. A profile is a second `engine.config.ts`
with a corpus and index of its own ([Profiles](#profiles)).

## Change a setting

1. Open **`.env`**. `./engine up` wrote it from `.env.example` on its first run.
2. Set the setting, or uncomment its line. A value is taken as written: one pair of outer quotes is removed and nothing
   is expanded.
3. Run **`./engine down`**, then **`./engine up`**.

`.env` takes only the names `.env.example` lists. Any other name with a value, such as `NODE_OPTIONS`, stops every
command that reads the settings, by name.

### Settings `.env` may hold

| Setting | Default | What it does |
| --- | --- | --- |
| `LOUVAIN_PG_HOST_PORT` | 5434 | Postgres's port on 127.0.0.1 |
| `LOUVAIN_EMBEDDINGS_HOST_PORT` | 8091 | The embedding sidecar's port |
| `LOUVAIN_BM25_HOST_PORT` | 8095 | The keyword sidecar's port |
| `LOUVAIN_ENGINE_PORT` | 8080 | The tool server's port (a whole number from 1 to 65535; anything else refuses the start) |
| `LOUVAIN_EMBEDDINGS_BULK_HOST_PORT` | 8092 | The bulk embedding lane's port (Compose profile `bulk`) |
| `LOUVAIN_EMBEDDINGS_BULK_URL` | unset: loading embeds on the query lane | The bulk lane's address |
| `DATABASE_URL` | built by `./engine` from the Postgres port and `.engine/db-password` | The database. One you set is yours: `./engine` never changes its password |
| `LOUVAIN_EMBEDDINGS_URL` | built from the embedding port | The embedding sidecar |
| `LOUVAIN_BM25_URL` | built from the keyword port | The keyword sidecar. Unset outside `./engine`, keyword search is Postgres's own full-text search |
| `LOUVAIN_SIDECAR_TOKEN` | a random token in `.engine/sidecar-token` | The bearer every sidecar request carries |
| `LOUVAIN_EMBEDDINGS_CONCURRENCY` | 1 | Batches the embedding sidecar runs at once |
| `LOUVAIN_EMBEDDINGS_MAX_QUEUE` | 64 | Batches it holds waiting |
| `LOUVAIN_ENGINE_TOKEN` | a random token the server writes to `.engine/token` | The tool server's read token, at least 32 characters |
| `LOUVAIN_ENGINE_INGEST_TOKEN` | unset | The HTTP door's token, at least 32 characters and not the read token. It opens `POST /ingest` only when `engine.config.ts` hands it to `http()` |
| `LOUVAIN_FILE_MAX_BYTES` | 33554432 (32 MB) | The largest file a reader is handed |
| `LOUVAIN_FILE_MAX_CHARS` | 1000000 | The most text a reader may return |
| `LOUVAIN_FILE_READ_DEADLINE_MS` | 60000 | How long a reader may take on one file |
| `LOUVAIN_AGENT_SEARCH_CHUNK_BONUS` | 0: a document ranks by its best passage | 1 sums its passages instead |
| `LOUVAIN_SEARCH_RELEVANCE` | on | `off` returns one ranked list: no `match`, `looselyRelated`, `matched` or exact tier, and excerpts on one line |
| `LOUVAIN_RERANK_HOST_PORT` | 8096 | The local reranker sidecar's port, when engine.config.ts runs it |
| `LOUVAIN_RERANK_URL` | built from the port by `./engine` | The local reranker's address, which engine.config.ts's `sidecar` line reads |
| `LOUVAIN_RERANK_TIMEOUT_MS` | 4000 (at least 500) | How long a search waits for the reranker, where engine.config.ts's line reads it; past it the page keeps the fused order and says so |
| `COHERE_API_KEY` | none | Cohere's reranker key, when engine.config.ts names `cohere` |
| `LOUVAIN_ENGINE_PUBLIC_ORIGIN` | unset: the app answers loopback on its own port only | The address people reach the app at, behind a TLS proxy you run |
| `ANTHROPIC_API_KEY` | none: Ask is not ready | The model key engine.config.ts's `anthropic` model answers with; it stays on the server |
| `LOUVAIN_APP_ASK_ROUNDS` | 6 (1 to 10) | Model turns one answer may take |
| `LOUVAIN_APP_ASK_TOKENS` | 100000 (20000 to 400000) | Tokens one answer may spend across its turns |

### Settings, in `engine.config.ts`

How a search reads and ranks, and what the tool server serves, is set under `settings` in `engine.config.ts`, never in
`.env`. A setting left out keeps its default; a value out of range stops the start, naming it; at the start each command
prints the settings that depart from their defaults (`settings: rerank.window 10 (default 30)`).

```ts
export default defineEngine({
  settings: { retrieval: { searchQuestion: false }, rerank: { window: 10 } },
});
```

| Setting | Default | What it does |
| --- | --- | --- |
| `retrieval.searchQuestion` | `true` | The search tool takes `question`, the person's question, and searches it beside the query; `false` removes the argument, and a call that sends it is refused by name |
| `rerank.window` | 30 | How many documents go to the reranker |
| `rerank.feed` | `"passage"` | `"document"` sends each document's whole text instead of its best passage |
| `rerank.passageChars` | 3000 (at least 200) | Characters of a passage sent |
| `rerank.documentChars` | 16000 (at least 200) | Characters of a document sent under `"document"` |
| `rerank.blend` | 0.5 | The reranker's weight in a reciprocal-rank blend with the fused order, from 0 to 1; 1 takes the reranker's order alone. A reranker that states its own blend uses that (the shipped local model: 1) |
| `server.toolDeadlineMs` | 60000 (at least 1000) | How long a tool call's reply may take; work already under way runs on |

The settings are a value of the engine a command builds, fixed when it starts: a search reads its engine's, and nothing
re-reads them while it runs. How a keyword hit is shown is the keyword retriever's own setting (`bestPassage`,
[Plugins](plugins.md)), not one of these.

The engine reads further settings that tune it for a particular deployment. Each is declared, with why it is internal,
in `packages/engine/src/config/environment.ts`; they are not offered here.

## Choose the plugins

1. Open **`engine.config.ts`** at the repository's root. The shipped one runs the default readers, no reranker, and
   the agent as Ask's answerer:

```ts
// engine.config.ts
import { agent, anthropic } from "@louvain/engine-app";
import { defineEngine } from "@louvain/engine-core";

export default defineEngine({
  answerer: agent({ model: anthropic({ model: "claude-sonnet-5-5" }) }),
});
```

2. Change a field. `defineEngine` takes six:
   - **`readers`**: the file readers, in order. A list replaces the defaults, so list `documents()` and `text()` to keep
     them. `readers: []` reads no file. Each shipped reader takes `extensions`, which narrows what it claims:
     `text({ extensions: ["txt"] })` leaves Markdown to another reader.
   - **`sources`**: the ways items come in, `folder()` and `records()` by default. `http({ token })` opens the HTTP
     door ([Ingest](ingest.md)); a list replaces the defaults, so list the other two to keep them.
   - **`surfaces`**: what the tool server serves, `mcp()` (the tools at `/mcp`) and `app()` (Search and Ask at
     `/app/`, [The app](app.md)) by default. `surfaces: [mcp()]` serves the tools alone; `surfaces: []` serves nothing
     but the ingest door.
   - **`reranker`**: one reranker, or `null` for none (the default).
   - **`answerer`**: the one answerer the app's Ask writes with, or `null` for none (the default when the field is left
     out): `agent({ model })` over a model such as `anthropic({ model })`, `scripted()`, which needs no model, or one of
     your own ([Plugins](plugins.md)). With none, Ask says it has no answerer ([The app](app.md)).
   - **`settings`**: how the engine searches and serves, key by key (above).
3. Run **`./engine down`**, then **`./engine up`**. `ingest`, `search`, `reindex` and the tool server each read the
   file once, at start. With no `engine.config.ts` the defaults run.

The retrievers (`vector`, `keyword`, `figures`) are not a field. [Plugins](plugins.md) has a complete reader written in
engine.config.ts.

### What stops the start

A configuration that fails stops the start with one sentence and exit status 2; the defaults never run in its place.

| Cause | What the engine says |
| --- | --- |
| The file throws | `engine.config.ts:2 could not be loaded: not finished. The engine does not start on its defaults in place of a configuration that failed` |
| A field that does not exist | `engine.config.ts:2 could not be loaded: a configuration has no "retrievers"; it names readers, reranker, sources, surfaces, answerer, settings. …` |
| A setting that does not exist, or out of range | `engine.config.ts settings.rerank.blend: Too big: expected number to be <=1` |
| A plugin named twice | `engine.config.ts:3 could not be loaded: the configuration's readers names "text" twice. …` |
| A setting a plugin refuses | `engine.config.ts:40 could not be loaded: the fileReader "recipe" refuses its settings: ✖ Invalid input: expected string, received number → at servesLabel. …` |
| No default export from `defineEngine` | `engine.config.ts must export defineEngine({ … }) as its default` |
| A plugin that fails to start | `the fileReader "<name>" failed to start: <reason>` |
| Two readers claim one extension at the same rank | `two file readers claim .<ext> at the same rank (<a>, <b>): keep only one of them in engine.config.ts's readers` |
| A reader's `extensions` names one it does not read | `the fileReader "text" refuses its settings: ✖ Invalid option: expected one of "txt"\|"md"\|"markdown" → at extensions[0]` |

## Profiles

A profile is a folder under `profiles/` holding an `engine.config.ts`: a configuration of its own, with a corpus and
an index of its own. The configuration a published figure was scored with is one ([How this figure was
produced](benchmark-method.md)).

1. Run **`./engine down`**: the profile in use is stopped before another is set.
2. Run **`./engine profile set <name>`**. Every command then runs that profile's `engine.config.ts`, and says so.
3. Run **`./engine up`**. The profile starts a stack of its own (its own Compose project, so its own database and
   keyword index) and keeps its state, its token among it, under `.engine/profiles/<name>/`.

```text
$ ./engine profile set pilot
Profile: pilot. Every command runs it; ./engine up starts its own stack.
$ ./engine profile
pilot (profiles/pilot/engine.config.ts)
```

- **Settings**: a profile's `settings` go over the root `engine.config.ts`'s, key by key; its plugins replace the
  defaults kind by kind, as the root's do.
- **`./engine profile set default`** returns to the root `engine.config.ts`, with the install's own state and stack,
  as before any profile was set.
- **One stack at a time**: profiles share this machine's ports, so `./engine up` refuses while another profile's stack
  runs, and names the commands that stop it.

## The reranker

### Turn on the local reranker

1. In **`engine.config.ts`**, uncomment the reranker lines it ships with:

```ts
import { sidecar } from "@louvain/reranker-sidecar";
// …
  reranker: sidecar({
    url: process.env.LOUVAIN_RERANK_URL ?? "http://localhost:8096",
    timeoutMs: Number(process.env.LOUVAIN_RERANK_TIMEOUT_MS ?? 30_000),
  }),
```

2. On a machine without a GPU, set **`settings: { rerank: { window: 10 } }`** beside it, so a search fits the
   30-second wait.
3. Run **`./engine up`**. The first build downloads the model's weights from Hugging Face once (2.3 GB).

```text
$ ./engine up
settings: rerank.window 10 (default 30)
…
Reranker: building BAAI/bge-reranker-v2-m3, as engine.config.ts names it. The first build downloads its weights from Hugging Face
once (2.3 GB for the shipped model) so it can rank on this machine; to skip it, comment out the reranker line.
Reranker: BAAI/bge-reranker-v2-m3, on port 37096.
…
```

Each hit then carries `match.relevance`, the reranker's score from 0 to 1. At or above 0.5 a document matches
(`match.by: "relevance"`); a low score hides nothing. On the sample corpus, the lease question's hits read:

```json
[["lease-renewal",{"words":true,"meaning":0.86,"relevance":0.999,"ranks":{"words":1,"meaning":1},"by":"words"}],
 ["facilities-agreement",{"words":true,"meaning":0.67,"relevance":0.986,"ranks":{"words":2,"meaning":2},"by":"words"}],
 ["hiring-plan",{"words":true,"meaning":0.47,"relevance":0.005,"ranks":{"words":3,"meaning":3},"by":"words"}]]
```

A machine that cannot build or run it is told so in one sentence, and the engine runs without it.

### What it costs

It is off by default because of its cost. Measured on 380 mixed files, with fifteen paraphrased questions and fifteen
keyword searches, the answer's place:

| | Paraphrase: first / top 3 / mean reciprocal rank | Keyword: first / top 3 / mean reciprocal rank |
| --- | --- | --- |
| No reranker | 4 / 4 / 0.367 | 13 / 14 / 0.904 |
| `bge-reranker-v2-m3` | 9 / 12 / 0.700 | 13 / 15 / 0.933 |

It puts a paraphrased answer first more than twice as often. It costs a 2.3 GB download, about 900 MB of memory, and
on four CPU cores 11 to 17 seconds to score ten passages. With a GPU (the sidecar uses Metal or CUDA when run outside a
container) that wait is gone. At the default 30 passages a CPU misses the 30-second wait and each search comes back
unreranked, saying so.

### Use Cohere instead

1. In **`engine.config.ts`**, set **`reranker: cohere({ model: "rerank-v3.5" })`**.
2. Set **`COHERE_API_KEY`** in `.env`.
3. Run **`./engine down`**, then **`./engine up`**.

Every search then sends the search and the text of up to `rerank.window` documents to Cohere, on your key. With
no key the configuration does not load (`the reranker "cohere" refuses its settings: ✖ a key is needed: set
COHERE_API_KEY, or pass apiKey`). If Cohere refuses, each search keeps the legs' order and says
`degraded: ["rerank:documents"]`.

## Change the embedding model

1. Set the build arguments in **`services/embed/Dockerfile`** (`EMBEDDING_MODEL`, `EMBEDDING_POOLING`, `EMBEDDING_DIM`,
   `EMBEDDING_MATRYOSHKA`, and the archive and checksum arguments). The default is `Xenova/bge-base-en-v1.5`.
2. Run **`./engine down --volumes`**, then **`./engine up`**, and load your documents again. Vectors from different
   models cannot be compared.

## How fast documents are embedded

The default embedder runs on the machine's CPU, using every core, and that sets how fast documents load: the rest of
indexing takes a small share of the time. It embeds about 7 passages a second at best, measured on an Apple M1 Max:
3 a second one at a time, 6 in requests of 16, 7 in requests of 32 or 64. So the engine sends it 32 passages a request
(`LOUVAIN_EMBEDDINGS_REQUEST_BATCH`, at most 256), and loading a large collection is a
matter of hours, not minutes. To load faster, serve an embedder on a GPU at the same address (`LOUVAIN_EMBEDDINGS_URL`):
the engine embeds through any service that answers the same requests.
