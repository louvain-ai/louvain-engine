# Security model

This page is for anyone deciding whether to trust the engine with documents that not every reader may see. Each part
says what holds, what does not, and which test in this repository checks it.
[Permissions](permissions.md) covers the practical side: readers and grants, the host, hostile files and what the
engine trusts.

## The shape of a read

A read is made for a viewer: an organisation and a reader id. Which documents that viewer may read is the **host's**
answer, not the engine's. The host answers with a **readable set**: the collections the viewer may read, plus any
records admitted by id. The engine enforces the host's answer on every read. This build's host answers from
`engine.config.ts`: the default reader, whom the engine's own token reads as, reads every collection loaded; a named
reader reads the loaded collections its grant names; any other reader reads nothing.

## What the fence guarantees

- **One answer per call.** `fence()` asks the host once each time it is called, through the resolver the read's
  context was made with, and returns a `Reader`: the organisation, its collections and its admitted records. A search
  calls it for each of its stages, so the host is asked more than once per search, and a host whose answer changes
  between those calls can give its stages different sets. Nothing outside the fence's own module makes a `Reader`.
- **It fails closed.** An organisation id that is not a UUID, a blank reader id, an empty set, or a narrowing that keeps
  nothing reads nothing: the fence returns no `Reader`, or one with no collections, and no row comes back. A host that
  cannot answer throws. An error is never read as
  an empty set, and never as a full one.
- **A narrowing never widens.** A read scoped to named collections keeps only those the reader already holds. It also
  drops every record admitted by id, so a scoped read never reaches one.
- **One predicate.** A read filters by the `Reader` through one predicate, in the statement itself: the row's
  collection is one of the reader's, or its record is one the host admitted. The filter sits in the statement's
  `WHERE` clause, so a row outside the set is never ranked, counted, limited into a page or returned.
- **A hidden document does not exist to the reader.** Its collection is never listed or searched and it is never
  opened. An identifier that only it holds is answered as one that does not exist, and a word only it holds is never
  offered as a spelling correction.

## What the fence does not guarantee

- **It is not a sandbox.** `engine.config.ts` and every plugin it imports run in the engine's process, as you, with the
  database and the tokens. A plugin can read anything the process can.
- **It does not hide ranking statistics within a workspace.** The keyword index keeps one index per workspace, and
  weighs a word by how many of that workspace's documents contain it, readable or not, and by their average length. A
  document in the same workspace that the reader cannot see can therefore change the order of the reader's results and
  which fragment a snippet shows; another workspace's documents never can. It never adds a document, a word or a count
  of its own to them.
- **It makes no claim about timing.** How long a read takes may depend on documents the reader cannot see.
- **It does not keep text from the sidecars.** The embedding sidecar receives every passage and every search. The
  keyword index holds the text of every document, for every reader. A reranker receives each search and the text of
  each document it reranks. The fence is applied to what comes back from them, so they must be services you trust.
- **It does not screen document text.** A document holding instructions to a model is loaded and returned like any
  other.
- **It does not govern writes.** Whoever holds a way to write can write: the command line on the machine, and the
  holder of the ingest door's token.

## A `Reader` comes only from the fence

- `Reader` and the read context each carry a brand that only the fence's own module writes. A value assembled anywhere
  else does not type-check. That module's single cast is the only maker of a `Reader`, and a read context is made only
  by the engine when it is built.
- A brand is a compile-time rule, and TypeScript can be told to forget it: an `as` cast forges one, and a spread copies
  one. So read a change for either. No read outside `packages/engine/src/read/fence.ts` casts to `Reader` or spreads
  one, and no read writes a collection filter of its own: every one goes through `fenced()`.

## A retriever's rows are read again

- A retriever plugin is never given the database pool. It gets a reading already narrowed to the search's reader and
  filters, and a description of that scope for an index of its own.
- Any record a retriever returns that the reading did not hand out is read again from the database under the fence,
  as the engine's own keyword hits are. Every row that survives is then read again by its record's id under the fence.
  A row outside the fence is dropped and counted (`search.retriever_foreign_dropped`).
- So a retriever decides which records are considered. It never decides what they say, or whether the reader may see
  them. This is defence in depth, not isolation: the retriever runs in the engine's process.

## Readers and their tokens

- A reader is a name and a token. The engine's own token reads as the default reader; each named reader's token is a
  file of its own, `.engine/readers/<name>`, made the way the engine's own is (an owner-only directory, written whole
  and linked into place at 0600, read without following a link) and never printed.
- A token is matched against every reader's token, as a digest, in constant time and with no early exit, so how long a
  match takes says nothing about which reader holds it. Two readers holding one token stop the start.
- A request reads as the reader whose token it carries, and the server binds the engine's tools and counts to that
  reader before a route sees them. A route is handed the reading, never the token.
- A browser signs in with a reader's token. The cookie carries a random id; which reader the sign-in reads as is kept
  on the server, so no cookie can name another reader.
- Grants are read when the server starts, from `engine.config.ts`, and checked there: a reader's name is one
  alphabet, never the default reader's, and a grant names collections by their names. A grant covers every folder of a
  collection, including folders loaded after it was written.
- Removing a reader's token ends the reader once the server starts again; `./engine reader remove` starts a running
  server again itself. Until it starts again, the server still holds the token.

## Tokens and the server's admission

- The server listens on `127.0.0.1` only, and speaks plain HTTP.
- Who a request reads or writes as is decided before its body is read:
  - A write route takes the write token and nothing else.
  - A reader's token reads every other route, as that reader.
  - Without a token, only the browser's routes answer: the open ones, the sign-in among them, and those that take a
    session cookie. They answer only at a host the server is reached at, and a change only from a page it served.
  - Every other request gets the same `401`, on every path.
- Every reader's token and the ingest door's token are each at least 32 characters, and all are compared in constant
  time. A route's handler gets the request without its credentials.
- The ingest door is off unless its source sets a token of its own. The server refuses to start when that token is any
  reader's, which agents hold, or when two sources each open a door. A request to the door is at most 8 MB.
- A search cursor is sealed with authenticated encryption (AES-256-GCM) under a key made from the server's token. A
  client can neither read nor alter one. It opens on the server that issued it, also after a restart, and on no server
  holding a different token. An engine run without a server seals its cursors under a random key of its own. A cursor
  names no reader: another reader presenting it pages their own search, read under their own fence, and the documents
  it skips are ones it can only hide, never show.
- Each engine holds its own search cursor key, keyword-index endpoint (its settings and its group commit), telemetry
  and logger, so two engines in one process do not share them. A few things are still kept once per process, each
  listed here: the telemetry and logging a call site with no engine in reach reports to, the keyword
  index's settings as its listing and tier clients read them, each workspace's passage-context mode (15 seconds, by
  organisation), and the apps a connector shows. Memos kept beside a value, such as an embedder's recent query vectors,
  are shared by engines that share that value.

## What an operator must do

- **Keep everything on loopback.** The server, Postgres and the sidecars bind `127.0.0.1`. Any local user and any web
  page can reach a loopback port, so each needs its secret: do not publish their ports. To serve beyond the machine,
  put a TLS proxy in front and set `LOUVAIN_ENGINE_PUBLIC_ORIGIN`, so that sign-in answers at that origin.
- **Give the sidecars their token.** With `LOUVAIN_SIDECAR_TOKEN` set, each sidecar refuses a request that does not
  carry it, except its health check. `./engine up` makes a token per install, and the bundled compose file will not start a
  sidecar without it. A sidecar started any other way with the token unset answers anyone who reaches it.
- **Guard the state directory.** Every reader's token, the database password and the sidecar token live in it,
  with mode 600. The engine refuses to keep a token in a directory that is a link, or that another user owns. Anyone
  who can read that directory can read every document.
- **Read every plugin before you add it**, and know what each remote service you configure receives.

## How each guarantee is checked

| Guarantee | Test here |
| --- | --- |
| The fence fails closed: an org id that is not a UUID or a blank reader asks the host nothing and reads nothing, an empty set or a narrowing that keeps nothing reads nothing, and a host that cannot answer is an error | `packages/engine/test/fence.test.ts` |
| A narrowing never widens, and drops every record admitted by id | `packages/engine/test/fence.test.ts` |
| Two readers through the real server: each token searches, opens and counts its own collections alone, over MCP and the app; the other's document answers as one that does not exist; a token with no grant reads nothing; the engine's own token reads both; a removed token is refused | `packages/engine/test/db/two-readers.test.ts` |
| A token reads as the one reader holding it and as no other; reader tokens are owner-only files named by reader; the host reads a grant over the collections loaded, and anyone ungranted reads nothing | `packages/engine/test/readers.test.ts` |
| A grant is checked at the configuration's line: a reader's name, never the default reader's, and collections' names | `packages/engine-core/test/grants.test.ts` |
| A hidden document does not exist to the reader: never listed, counted or searched, never opened, its identifier answered as missing | `packages/engine/test/db/search.golden.test.ts` |
| Every read filters through the one predicate before it orders or limits | The SQL text of every read, recorded in `packages/engine/test/db/sql/` and compared on every run (`packages/engine/test/db/sql-text.test.ts`) |
| A retriever's rows are the engine's own, and a foreign one is dropped | `packages/engine/test/db/retriever-contract.test.ts` |
| Admission: the routes each token opens, the `401`, a sign-in reading as its reader, the host and origin checks | `packages/engine/test/open-surfaces.test.ts` |
| What is per engine stays so: cursor keys, keyword-index endpoints | `packages/engine/test/hooks.test.ts` |
| Loading the engine opens nothing | `packages/cli/test/door.test.ts` |
| A `Reader` and a read context come only from their makers | The brands, checked by the compiler: `pnpm run typecheck` |

`pnpm run test` runs the unit tests. The database tests need a Postgres server with pgvector named by
`TEST_AUTH_DATABASE_URL`, and the keyword index's image: `pnpm --filter @louvain/engine test:db`, as the CI's
`database` job runs them. The repository the engine is developed in also runs mutation runs over the fence's decisions
and guards against a forged `Reader`, a hand-written collection filter and new module state on every change; they are
extra, and nothing on this page rests on them.

Report a way past any of this privately, as `SECURITY.md` describes.
