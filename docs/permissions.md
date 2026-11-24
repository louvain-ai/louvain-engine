# Permissions and threat model

**In short:** every reader has a token of its own and reads only the collections `engine.config.ts` grants it. The
engine's own token, in `.engine/token`, reads everything loaded. Keep the server on `127.0.0.1`, and read any plugin
before you add it. The [security model](security-model.md) states what the fence guarantees, what it does not, and
which test checks each guarantee.

## Readers and grants

A **reader** is a name and a token. Make one, and the engine keeps its token beside its own, in a file only you can
read:

```text
$ ./engine reader add alice
alice reads with the token in .engine/readers/alice: give it to alice as you would a password.
It reads nothing until engine.config.ts grants it a collection: grants: { "alice": ["<collection>"] }
```

A **grant** says which collections a reader may read. Grants are code, in `engine.config.ts`:

```ts
export default defineEngine({
  grants: {
    alice: ["handbook", "desk"],
    bob: ["handbook"],
  },
});
```

Run `./engine up` after you change a grant: it starts the server again on the new file. `./engine reader add` and
`./engine reader remove` restart a running server themselves.

```text
$ ./engine reader list
engine-reader  .engine/token          every collection loaded
alice          .engine/readers/alice  handbook, desk
bob            .engine/readers/bob    handbook
```

Give a reader's token to its agent (`Authorization: Bearer <token>`, as for the engine's own), or sign in to the app
with it. Either way, everything that reader does is fenced to its collections: the search, the document it opens, and
the counts the app's status shows.

- **A grant names a collection**, the name `ingest` gave it (the folder's name unless you passed `--collection`). It
  covers every folder in that collection, including folders loaded after the grant was written.
- **No grant is no read.** A reader with a token and no grant reads nothing, and so does a grant for a collection
  nothing has loaded yet, until it is loaded.
- **The default reader**, `engine-reader`, is the engine's own token and the command line (`./engine search`). It reads
  every collection loaded and takes no grant.
- **Removing a token ends the reader.** `./engine reader remove alice` deletes its file and restarts the server, which
  then refuses that token with `401`, as it refuses any other.
- **A reader's name** is lower-case letters, digits, dashes and underscores, at most 64. A grant that names anything
  else stops the start at the configuration's line, and so does a token file whose name is not a reader's.
- **It is flat, and you can replace it.** Readers and grants are what the engine's own host reads: a plain function over
  your configuration. A deployment with access rules of its own binds a host whose `readableSet` answers them (The
  host, below), and every read is fenced by that answer the same way.

## Who can read what

- **Every read is fenced, one way.** A read calls `fence()` (`packages/engine/src/read/fence.ts`), which resolves
  the reader's **readable set** (the collections they may see) once per call from the resolver its read context
  carries (the host's `readableSet`) and returns a `Reader`. Only `readContextOf` makes a context, so no read can be
  handed a resolver it was not made with. Only `fence()` can make a `Reader`, so no read can build a set of its own.
  Every statement puts the reader in its WHERE clause through one predicate, `fenced()`, before it orders, limits or
  folds. No row outside the set is ranked, counted or returned, and no read writes a collection filter of its own.
- **It fails closed.** An empty set, an unknown reader or a malformed org id reads nothing. A permission store that
  cannot answer is an error, never an empty set.
- **This build's host serves one org.** The default reader's set is every collection loaded, and a named reader's is
  the loaded collections its grant names (`packages/engine/src/host/standalone.ts`).

The engine's database tests read as two readers through the real server, and as readers of part of the corpus: a
hidden collection is never listed, counted or searched, a hidden document never opened, and an identifier only a hidden
document holds is answered as one that does not exist.

### The host

What a deployment decides, the engine reads through one `Host` (`packages/engine-core/src/host.ts`):

| Member | What it decides | When the host has none |
| --- | --- | --- |
| `readableSet` | Who may read what: the collections a reader may read, and any record admitted by id (none here) | Required |
| `endpoints` | How a sidecar that is not a plain HTTP service is reached | Plain HTTP |

Each entry point hands its host to the engine it builds (`createEngine({ host: openHost(store.sql, grants), … })`), and
every read runs on the engine's context, which carries that host's `readableSet` (`fence(context, viewer)`): nothing
binds it, and no read reaches a resolver its context was not made with. A deployment with access rules of its own
binds a host whose `readableSet` answers them, in code; a configuration cannot name one. One ships with the engine:
`@louvain/engine-pg-rebac` reads the set from [pg_rebac](https://github.com/louvain-ai/pg_rebac), SpiceDB's answer
projected into Postgres, and keeps its three answers apart: a set, a reader never asked (looked up once through
rebacd), and unavailable, which fails the read and is never an empty set
([`packages/plugins/engine-pg-rebac`](../packages/plugins/engine-pg-rebac/README.md); the runnable example is
[`examples/pg-rebac`](../examples/pg-rebac/README.md)). A deployment whose work is
owned by a queue hands the queue's work to the engine it builds as a write hook (`WriteHooks.work`,
`packages/engine/src/ingest/work.ts`), and its writes check the claim and commit through it; this build has none, so
its writes commit plainly. The embedder an entry makes for its host (`embedderFor(host)`) is a part of the engine it
builds, and the engine carries it on its context and its writes: a read or a write that embeds asks the engine's own
(`embedderOf`), and nothing binds one per process.

### Retrievers

A retriever plugin never gets the database pool, only a `FencedReading` narrowed to the search's reader and filters,
and its scope as a description to pass to an index of its own. Before fusion (`packages/engine/src/search/pool.ts`),
the engine:

1. keeps a row the reading handed out with its passage, and reads any other record a retriever returns again, as its
   own keyword index's hits are read (`read/records/as-passages.ts`): the version current as of the search, every
   narrowing, the first passage the reader may read, read back by id under the fence;
2. reads every row's record again under the fence, by id, and drops any outside it;
3. counts each drop as `search.retriever_foreign_dropped`.

So every word, date and place on a page is the engine's own: a retriever chooses which records, never what they say.

This is defence in depth, not a sandbox: a retriever runs in the engine's process.

## What the engine defends against

**Hostile files.**

- Only regular files are read; a symbolic link, pipe or device is refused.
- Each reader is held to 32 MB in, 1,000,000 characters out and 60 seconds (`LOUVAIN_FILE_MAX_BYTES`,
  `LOUVAIN_FILE_MAX_CHARS`, `LOUVAIN_FILE_READ_DEADLINE_MS`). A reader that throws or overruns costs that file only.
- `doctext` parses heavy formats in a child process with its own heap limit, a deadline enforced by SIGKILL, and an
  environment with no database address, key or token.
- Text a database cannot store as sent (a lone surrogate, a NUL) is refused with the field named.

**Hostile callers.**

- The tool server listens on `127.0.0.1` only, and every request needs a reader's bearer token, at least 32
  characters, matched in constant time against every reader's token with no early exit. A request reads as the reader
  whose token it carries, and as nobody else.
- `POST /ingest` is off unless its own token is set, and that token may not be any reader's, so an agent's token
  never writes. A request is at most 8 MB and 500 items and never names a file the server reads.
- A tool passes on only the arguments it declares.
- The app signs in with a reader's token, matched the same way, and answers with an httpOnly, `SameSite=Strict`
  cookie signed with a key made from the engine's own token. The cookie carries a random id; which reader it reads as
  stays on the server. It answers only the hosts it is reached at and refuses a write from any other origin. The
  browser keeps neither the token nor a model key, and a restart ends every sign-in.
- Postgres and the sidecars listen on `127.0.0.1` and each needs a secret made for this install; none has a default
  credential, because any local user and any web page can reach a loopback port.
- `.env` is data: `./engine` takes only the names `.env.example` lists and expands nothing.

## What the engine trusts

- **`engine.config.ts` and every plugin it imports.** They run in the engine's process, as you, with the database and
  the tokens.
- **The machine's own user**, who can read the secrets in the `.engine` directory, every reader's token among them.
- **A reranker you configure.** A remote reranker receives each search and the text of the documents it reranks.
- **A model provider you configure.** With `ANTHROPIC_API_KEY` set, the app's Ask sends each question and the text of
  the documents it reads to the model.

## What the engine does not do

- **It does not screen document text.** A document holding instructions to a model is loaded and returned like any
  other; the tool descriptions tell the agent that document text is data. Do not give one agent untrusted documents and
  tools that write or send data elsewhere unless a person confirms each such action.
- **It does not check what an agent writes.** A hit names its document; whether it supports the agent's claim is the
  agent's to check.
- **It cannot stop a reader that blocks.** The bounds run in the engine's process, so a reader that loops without
  yielding holds it. Keep slow work asynchronous, or in a process of its own as `doctext` does.

## Report a hole

1. Follow **`SECURITY.md`** to report privately a way to read past the readable set, reach a service without its
   secret, bypass a token, or escape a reader's bounds.

The engine's own token reading every collection is expected, not a hole; a named reader reading a collection its grant
does not name is one.
