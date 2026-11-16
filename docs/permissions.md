# Permissions and threat model

**In short:** this build has one reader: whoever holds the token in `.engine/token` reads every document loaded. Keep
the server on `127.0.0.1`, and read any plugin before you add it. The [security model](security-model.md) states what the fence guarantees, what it
does not, and how each guarantee is checked.

## Who can read what

- **Every read is fenced, one way.** A read calls `fence()` (`packages/engine/src/kg/read/fence.ts`), which resolves
  the reader's **readable set** (the collections they may see) once per call from the resolver its read context
  carries (the host's `readableSet`) and returns a `Reader`. Only `readContextOf` makes a context, so no read can be
  handed a resolver it was not made with. Only `fence()` can make a `Reader`, so no read can build a set of its own.
  Every statement puts the reader in its WHERE clause through one predicate, `fenced()`, before it orders, limits or
  folds. No row outside the set is ranked, counted or returned, and no search stage builds a WHERE clause of its own.
- **It fails closed.** An empty set, an unknown reader or a malformed org id reads nothing. A permission store that
  cannot answer is an error, never an empty set.
- **This build's host serves one reader in one org**, whose set is every collection loaded. A build with more
  readers binds a host whose set differs per reader; the fence and its checks are the same code.

The engine's database tests read as a reader of part of the corpus: a hidden collection is never listed or searched, a
hidden document never opened, and an identifier only a hidden document holds is answered as one that does not exist.

### The host

What a deployment decides, the engine reads through one `Host` (`packages/engine-core/src/host.ts`):

| Member | What it decides | When the host has none |
| --- | --- | --- |
| `readableSet` | Who may read what: the collections a reader may read, and any record admitted by id (none here) | Required |
| `endpoints` | How a sidecar that is not a plain HTTP service is reached | Plain HTTP |

Each entry point hands its host to the engine it builds (`createEngine({ host: openHost(store.sql), … })`), and every
read runs on the engine's context, which carries that host's `readableSet` (`fence(context, viewer)`): nothing binds
it, and no read reaches a resolver its context was not made with. A deployment whose work is owned by a queue hands
the queue's work to the engine it builds as a write hook (`WriteHooks.work`, `packages/engine/src/memory/work-seam.ts`),
and its writes check the claim and commit through it; this build has none, so its writes commit plainly. The
embedder an entry makes for its host (`embedderFor(host)`) is a part of the engine it builds, and the engine carries it
on its context and its writes: a read or a write that embeds asks the engine's own (`embedderOf`), and nothing binds
one per process.

### Retrievers

A retriever plugin never gets the database pool, only a `FencedReading` narrowed to the search's reader and filters,
and its scope as a description to pass to an index of its own. Before fusion (`packages/engine/src/search/pool.ts`),
the engine:

1. keeps a row the reading handed out with its passage, and reads any other record a retriever returns again, as its
   own keyword index's hits are read (`kg/read/records-as-passages.ts`): the version current as of the search, every
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

- The tool server listens on `127.0.0.1` only, and every request needs a bearer token of at least 32 characters,
  compared in constant time.
- `POST /ingest` is off unless its own token is set, and that token may not be the read token, so an agent's token
  never writes. A request is at most 8 MB and 500 items and never names a file the server reads.
- A tool passes on only the arguments it declares.
- The app signs in with the same token, compared in constant time, and answers with an httpOnly, `SameSite=Strict`
  cookie signed with a key made from the token. It answers only the hosts it is reached at and refuses a write from any
  other origin. The browser keeps neither the token nor a model key, and a restart ends every sign-in.
- Postgres and the sidecars listen on `127.0.0.1` and each needs a secret made for this install; none has a default
  credential, because any local user and any web page can reach a loopback port.
- `.env` is data: `./engine` takes only the names `.env.example` lists and expands nothing.

## What the engine trusts

- **`engine.config.ts` and every plugin it imports.** They run in the engine's process, as you, with the database and
  the tokens.
- **The machine's own user**, who can read the secrets in the `.engine` directory.
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

One token reading everything is this build's expected behaviour, not a hole.
