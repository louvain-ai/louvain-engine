# Plugins

**In short:** a plugin adds a file reader, a source, a retriever, a reranker, a surface or the app's answerer. You name
readers, sources, surfaces, the reranker and the answerer in `engine.config.ts`; retrievers are added in code. Plugins run in the engine's process with its database and tokens, so
read one before you add it.

| Kind | Ships | Chosen in |
| --- | --- | --- |
| `fileReader` | `documents`, `text` | `engine.config.ts`, `readers` |
| `retriever` | `vector`, `keyword`, `figures` | `packages/cli/src/defaults.ts` |
| `surface` | `mcp` (the tools at `/mcp`), `app` (Search and Ask at `/app/`) | `engine.config.ts`, `surfaces` |
| `reranker` | `sidecar`, `cohere` (none runs by default) | `engine.config.ts`, `reranker` |
| `source` | `folder`, `records`; `http` (the HTTP door, off by default) | `engine.config.ts`, `sources` |
| `answerer` | `agent`, `scripted` (the shipped `engine.config.ts` names `agent`) | `engine.config.ts`, `answerer` |

The kinds are the keys of `Contracts` in `packages/engine-core/src/plugins/plugin.ts`. The readers, the rerankers and
the HTTP door are packages under `packages/plugins/` (`reader-documents`, `reader-text`, `reranker-sidecar`,
`reranker-cohere`, `source-http`); the folder and records sources, the retrievers and `mcp` live in
`packages/engine/src/plugins/`; `app` and the answerers are the app's, `packages/engine-app`. Each has a README.

## Start one

```sh
./engine plugin new reader csv        # or: reranker <name>, source <name>
```

It writes a package named for the kind and the name (here `reader-csv`, under `packages/plugins`) from the kind's
template: the source, a test that passes as written, and a README that walks every line. A reader starts as a copy of
`reader-text`, a source as a copy of `folder()`, and a reranker as one that keeps the order it was given. It prints the
command that links the package (`pnpm add -w @louvain/reader-csv@workspace:*`) and the two lines to add to
`engine.config.ts`, and never edits that file.

## Add a reranker

1. Open **`engine.config.ts`** and uncomment its reranker lines (the local `sidecar`), or name
   **`cohere({ model: "rerank-v3.5" })`** with your key in `COHERE_API_KEY`.
2. Run **`./engine up`**. For the local model it builds and starts the reranker's sidecar.

| Plugin | Settings | Notes |
| --- | --- | --- |
| `sidecar` | `url`, `model` (`BAAI/bge-reranker-v2-m3`), `timeoutMs` (4000), `blend` (the model's own: 1), `token` (the sidecars' token, from the environment) | The local sidecar (`apps/nlp/rerank.py`). A sidecar running another model is a failure |
| `cohere` | `model` (`rerank-v3.5`), `url` (`https://api.cohere.com`), `timeoutMs` (4000), `apiKey` (from `COHERE_API_KEY`) | Cohere's Rerank API, or a gateway with its shape by full URL. No key stops the start |

One reranker runs at most; `reranker: null` runs none. [Configuration](configuration.md) has what the
local model costs.

### The contract

```ts
export type Reranker = {
  readonly model: string;                    // the model behind the scores
  readonly cutoffs?: { readonly matched: number };  // at or above, a document matches
  readonly blend?: number;                   // how much of the order is the reranker's, 0 to 1
  rerank(ask: { query: string; texts: readonly string[] }): Promise<
    { ok: true; scores: readonly number[] } | { ok: false; failure: string }
  >;
};
```

Return one score from 0 to 1 per text, in the order asked, or a failure in a sentence. The score shows as
`match.relevance`; at or above `cutoffs.matched` a document matches. A failure, a missing score or one outside 0 to 1
keeps the legs' order and adds `rerank:documents` to `degraded`.

## Add an answerer

The app's Ask writes with the one answerer `engine.config.ts` names in `answerer` ([The app](app.md)). Two ship:
`agent({ model })`, the tool loop over a model such as `anthropic({ model })` (its key in `ANTHROPIC_API_KEY`), and
`scripted()`, which needs no model. `answerer: null` names none, and Ask then says it has no answerer. One of your own:

```ts
// engine.config.ts
import { defineEngine, definePlugin } from "@louvain/engine-core";

const quoted = definePlugin({
  kind: "answerer",
  name: "quoted",
  create: () => ({
    async *answer({ question, tools }) {
      const search = tools.find((t) => t.name === "search_documents");
      const [first] = (await search?.run({ query: question }))?.shown ?? [];
      if (!first) return yield { type: "no-answer", why: "sources-silent" };
      yield { type: "cite", ref: first.ref };
      yield { type: "text", text: `${first.title} has it [${first.ref}].` };
      yield { type: "done" };
    },
  }),
});

export default defineEngine({ answerer: quoted() });
```

### The answerer contract

```ts
// packages/engine-core/src/ask/answerer.ts
export type Answerer = { answer(ask: AnswerRequest): AsyncIterable<AnswerEvent> };

export type AnswerRequest = {
  readonly question: string;
  readonly history: readonly { readonly question: string; readonly answer: string }[];
  readonly tools: readonly BoundTool[];
  readonly signal: AbortSignal;
};

export type AnswerEvent =
  | { readonly type: "activity"; readonly label: string }
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "restart" }
  | { readonly type: "cite"; readonly ref: string }
  | { readonly type: "no-answer"; readonly why: "sources-silent" | "refused" | "limit" }
  | { readonly type: "done"; readonly usage?: { readonly inputTokens: number; readonly outputTokens: number } };
```

- The engine binds the tools for each answer, `search_documents` and `read_document`. A citation reaches the page
  only for a document a tool showed, by the ref it was shown with, and the lookups and the time are the engine's:
  no answerer changes them.
- An answerer not usable as configured returns `{ notReady: "<setting>" }` from `create`. The engine still starts,
  the answerer waits, and Ask says which setting it needs. It never throws for a missing key: `ingest` and `search`
  start the same plugins.

## Add a file reader

A `.recipe` file is a title line, a serves line, ingredient lines and a method:

```text
title: Lentil soup
serves: 4
- 200 g red lentils
- 1 onion
- 1 litre stock
Soften the onion, add the lentils and stock, simmer for 25 minutes.
```

Without a reader, the engine skips it:

```text
$ ./engine ingest folder --folder kitchen
ingesting kitchen into "kitchen"
  lentil-soup.recipe: skipped, unsupported type
  untitled.recipe: skipped, unsupported type
"kitchen": 0 added, 0 updated, 0 removed, 0 unchanged; 0 new passages
skipped 2: 2 unsupported type
```

1. Write the reader in **`engine.config.ts`** and list it in `readers`, with the shipped readers after it to keep them:

```ts
// engine.config.ts
import { defineEngine, definePlugin } from "@louvain/engine-core";
import { documents } from "@louvain/reader-documents";
import { text } from "@louvain/reader-text";

/** A .recipe file: a "title:" line, a "serves:" line, "- " ingredient lines, then the method, read as prose. */
const recipe = definePlugin({
  kind: "fileReader",
  name: "recipe",
  create: () => ({
    name: "recipe",
    claims: { extensions: ["recipe"] },
    read: (bytes) => {
      const lines = new TextDecoder().decode(bytes).split("\n");
      const field = (name: string) =>
        lines.find((l) => l.startsWith(`${name}:`))?.slice(name.length + 1).trim();
      const title = field("title");
      if (!title) return { refused: "no title: line" };
      const ingredients = lines.filter((l) => l.startsWith("- ")).map((l) => l.slice(2).trim());
      const method = lines.filter((l) => !/^(title:|serves:|- )/.test(l)).join("\n").trim();
      return {
        text: [`# ${title}`, `Serves ${field("serves") ?? "?"}.`, `Ingredients: ${ingredients.join(", ")}.`, method].join(
          "\n\n",
        ),
      };
    },
  }),
});

export default defineEngine({ readers: [recipe(), documents(), text()] });
```

2. Run **`./engine ingest folder --folder kitchen`** again, then search.

```text
$ ./engine ingest folder --folder kitchen
ingesting kitchen into "kitchen"
  lentil-soup.recipe: added (recipe)
  untitled.recipe: skipped, no title: line (recipe)
"kitchen": 1 added, 0 updated, 0 removed, 0 unchanged; 1 new passage
skipped 1: 1 no title: line
keyword index: 1 indexed
$ ./engine search "red lentils"
1. lentil-soup · 2026-11-14 · ca5c66962c34
```

A refusal is reported for its one file, with the reader that refused it. Restart the tool server (`./engine down`, then
`./engine up`) so it reads the new configuration too.

### The contract

```ts
export type FileReading = { text: string; pages?: number } | { refused: string };

export type FileReader = {
  name: string;
  claims: {
    extensions: readonly string[];           // lower case, without the dot: ["pdf"]
    rank?: "specific" | "fallback";          // "specific" by default
  };
  read: (bytes: Uint8Array, fileName: string) => FileReading | Promise<FileReading>;
};
```

- A reader gets a file's bytes and name, never a path. The engine opens only regular files and enforces the byte cap,
  the character cap and the deadline around it; a reader that throws costs only that file.
- The most specific claim wins: `documents` claims its extensions as `fallback`, so your `pdf` reader takes PDFs over.
  Two readers claiming one extension at the same rank stop the start.

### Give it settings

1. Declare **`settings`** as a zod schema. The factory parses its argument with it:

```ts
import { z } from "zod";

const recipe = definePlugin({
  kind: "fileReader",
  name: "recipe",
  settings: z.object({ servesLabel: z.string().default("Serves") }),
  create: ({ servesLabel }) => ({
    name: "recipe",
    claims: { extensions: ["recipe"] },
    read: (bytes) => {
      // … as above, writing `${servesLabel} ${serves}.`
    },
  }),
});

export default defineEngine({ readers: [recipe(), documents(), text()] });
```

With every setting defaulted, `recipe()` takes them all. A wrong setting stops the start at its line:

```text
$ ./engine ingest folder --folder kitchen   # with recipe({ servesLabel: 4 })
engine.config.ts:40 could not be loaded: the fileReader "recipe" refuses its settings:
✖ Invalid input: expected string, received number
  → at servesLabel. The engine does not start on its defaults in place of a configuration that failed
```

## Add a source

A source is how a system of yours becomes a collection. Copy `packages/plugins/source-http/src/index.ts`: a
source is one factory whose `request` is the schema of what a run asks for and whose `open` returns the listing:

```ts
import { definePlugin, itemOf, source } from "@louvain/engine-core";
import { z } from "zod";

/** A wiki's pages, read over its API. */
export const wiki = definePlugin({
  kind: "source",
  name: "wiki",
  settings: z.object({ url: z.url() }),
  create: ({ url }) =>
    source({
      request: z.object({ collection: z.string().describe("the collection the pages fill") }),
      open: ({ collection }, { fetch }) => {
        let whole = false;
        return {
          collection,
          origin: url,
          lists: "all",
          items: async function* () {
            const signal = AbortSignal.timeout(30_000);
            const got = await fetch(`${url}/pages`, { accept: "application/json", signal });
            if (!got.ok) {
              yield { at: url, problem: got.reason };
              return;
            }
            const pages: { id: string; title: string; body: string }[] = JSON.parse(
              new TextDecoder().decode(got.bytes),
            );
            for (const [i, page] of pages.entries())
              yield itemOf({ key: page.id, title: page.title, text: page.body }, `page ${i + 1}`);
            whole = true;
          },
          // A listing that failed is not whole, so nothing is removed on its account.
          complete: () => whole,
        };
      },
    }),
});
```

Name it in `engine.config.ts` beside the defaults, `sources: [folder(), records(), wiki({ url: "https://wiki.example" })]`,
and run it by name, its request's fields as flags: `./engine ingest wiki --collection pages`. `./engine ingest wiki
--help` lists them, each with its `.describe()`, and a wrong one is refused in zod's words, as for the sources that
ship.

- **`lists`**: `all` when the source lists everything it holds, so a key it no longer lists is removed; `some` when it
  sends only what changed and removes only what it marks `removed`.
- **`fetch`** is the only network a source is handed: HTTPS to a public address, no header but `accept`, the body read
  under a bound. A source never writes, never decides what is removed and never reads a file's bytes; the engine
  checks every item again, whoever wrote the source.
- **`door`**: a source that takes items over the server's `POST /ingest` returns `door: { token }` beside `open`, as
  `http` does. The server has one door.

## Write your own

Every plugin is made by `definePlugin`. `create` runs once when the engine starts and may be async; `close`, if given,
runs when the engine closes:

```ts
export type Plugin<K extends keyof Contracts> = {
  readonly kind: K;
  readonly name: string;
  create(): Contracts[K] | Promise<Contracts[K]>;
  close?(started: Contracts[K]): void | Promise<void>;
};
```

### A retriever

A retriever is one way a search finds candidates. This one adds a leg for each phrase in double quotes.

1. Write it in a new folder of **`packages/engine/src/plugins/`**, as its first line says:

```ts
// packages/engine/src/plugins/retriever-quoted/index.ts
import { definePlugin } from "@louvain/engine-core";

/**
 * A retriever for quoted phrases: for each "phrase in quotes" in a search, the passages that hold its words, as a
 * leg of its own. A search with no quotes reads nothing here.
 */
export const quotedRetriever = definePlugin({
  kind: "retriever",
  name: "quoted",
  create: () => ({
    candidates: async (ask, read) => {
      const phrases = [...ask.query.matchAll(/"([^"]+)"/g)].map((m) => m[1] ?? "");
      const legs = [];
      const degraded: string[] = [];
      for (const phrase of phrases) {
        const page = await read.passages(phrase, { mode: "keyword", limit: ask.limit });
        legs.push({ leg: `quoted:${phrase}`, rows: page.hits });
        degraded.push(...page.degraded);
      }
      return { legs, degraded };
    },
  }),
});
```

2. Export it from the engine's one door, **`packages/engine/src/index.ts`**, where every other plugin is: the package
   exports nothing else, so a name it does not list cannot be imported.

```ts
export { quotedRetriever } from "./plugins/retriever-quoted/index.js";
```

3. Add it to the defaults in **`packages/cli/src/defaults.ts`**:

```ts
import { quotedRetriever } from "@louvain/engine";
// …
  retriever: [vectorRetriever(), keywordRetriever(), figuresRetriever(), quotedRetriever()],
```

4. Run **`./engine up`**. It rebuilds and restarts the tool server.

```text
$ ./engine up
Building the workspace packages...
Starting the engine's services (the first run builds their images)...
Reranker: off (engine.config.ts names none).
Schema: already loaded.
Tool server: started again; it was running from before the build, settings or secrets changed.
Tools: http://127.0.0.1:8080/mcp
App:   http://127.0.0.1:8080/app/
Token: .engine/token
Ready.
$ ./engine search '"break clause" office'
1. lease-renewal · 2026-11-15 · 3758476098d5
```

### The retriever contract

```ts
export type Retriever = {
  candidates(ask: RetrieverAsk, read: FencedReading): Promise<Retrieved>;
  /** Optional: reads again once the first legs are fused, from the page they made. */
  after?(ask: RetrieverAsk, read: FencedReading, page: readonly Candidate[]): Promise<Retrieved>;
};

export type RetrieverAsk = {
  readonly query: string;
  readonly limit: number;
  readonly mode: "hybrid" | "keyword";
  readonly bounded: boolean;
};

export type Candidate = { readonly recordId: string };

export type FencedReading = {
  /** What the reading is narrowed to, for a retriever that asks an index of its own (its filter clauses). */
  readonly scope: ReadingScope;
  /** By meaning and by words, fused (`hybrid`), or one alone (`vector`, `keyword`); `digits`: passages stating a figure. */
  passages(
    query: string,
    opts: {
      readonly mode: RetrieverAsk["mode"] | "vector";
      readonly limit: number;
      readonly digits?: boolean;
      /** A keyword hit shown by its best-matching passage; `false`, by its first. Absent, the best. */
      readonly bestPassage?: boolean;
    },
  ): Promise<{ readonly hits: readonly Candidate[]; readonly degraded: readonly string[] }>;
};

export type ReadingScope = {
  readonly orgId: string;
  readonly containers: readonly string[]; // what the reader may read, narrowed to the search's collections
  readonly asOf?: string;
  readonly filters: Readonly<RecordFilters>; // sender, participants, window, connectors, apps, genre
};

export type Retrieved = {
  readonly legs: readonly { readonly leg: string; readonly rows: readonly Candidate[] }[];
  readonly degraded: readonly string[];
};
```

- A retriever never gets the database. It reads through `FencedReading`, already narrowed to the search's reader and
  filters, and returns legs, each in its own rank order.
- A retriever with an index of its own asks it with `read.scope` as filter clauses (the org, the containers, the as-of,
  the narrowings) and returns the records it found, `{ recordId: "…" }`, in its own order.
- The engine reads every record a retriever returns again, as it reads its own keyword index's hits: under the reader's
  fence, in the version current as of the search, inside every narrowing, each shown by the engine's own passage. A row
  the reading handed out keeps its passage. Anything else the reader cannot read is dropped and counted
  (`search.retriever_foreign_dropped`); nothing a retriever says reaches the page but which records, in which order.
- The legs of every retriever are fused by reciprocal rank. A leg that cannot answer reports it in `degraded`
  (`passages:<mode>`) and returns no rows.
- A plugin takes what it needs in its own settings, given where it is named and handed to `create`. The keyword
  retriever's `bestPassage` (`keywordRetriever({ bestPassage: false })`) shows a keyword hit by its first passage
  instead of its best-matching one, and it asks the reading for that.

### A surface

A surface serves the engine to something outside it: `mcp` serves its tools at `/mcp`, `app` serves Search and Ask at
`/app/`. It is a list of routes. A read route is handed a `Reading`, bound to the reader the server authenticated:

```ts
// packages/engine-core/src/plugins/surface.ts
export type Reading = {
  readonly reader: string;
  readonly answerer: One<"answerer"> | null;
  tools(): readonly ListedTool[];
  tool(name: string, args: Record<string, unknown>): Promise<{ readonly [field: string]: unknown }>;
  counts(): Promise<{ documents: number; collections: { name: string; documents: number }[] }>;
};
```

- A surface serves the engine's tools and never decides them. `tools()` is the list as the engine's settings make it
  (each tool's name, description and argument schema), and `tool` parses a call by those same schemas. So a setting
  that changes a tool's arguments, such as `retrieval.searchQuestion`, changes what every surface serves, at once.
- `mcp` answers `tools/list` with `tools()` and `tools/call` with `tool`; a surface of your own does the same, so a
  client sees exactly the tools a call accepts.

