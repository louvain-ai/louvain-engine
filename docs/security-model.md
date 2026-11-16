# Security model

This page is for anyone deciding whether to trust the engine with documents that not every reader may see. Each part
says what holds, what does not, and what checks it. Some checks are tests in this repository. Others run only in the
repository the engine is developed in, and each of those is marked as such.
[Permissions](permissions.md) covers the practical side: the host, hostile files and what the engine trusts.

## The shape of a read

A read is made for a viewer: an organisation and a reader id. Which documents that viewer may read is the **host's**
answer, not the engine's. The host answers with a **readable set**: the collections the viewer may read, plus any
records admitted by id. The engine never grants a permission; it enforces the host's answer on every read. This build's
host has one reader, who reads every collection loaded, so the guarantees below matter once a build binds a host with
more than one.

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
  one. So in the development repository, `check-fence-makers` reads the code through the TypeScript checker on every
  change and refuses three things:
  - a call to the context maker outside its listed callers;
  - a spread of a `Reader` or a context that then sets its collections, admitted records, resolver, store or hooks;
  - a cast to a branded type outside the fence's module.

  It fails closed when it cannot find what it checks.
- Also in the development repository, `check-fences` looks for the known ways of writing a collection filter by hand,
  and for any read of the readable-set table, outside the fence's own modules. A use that is not a read fence must
  carry a stated reason, and none without one is allowed. It matches how a filter is written, so a filter written some
  new way would pass it; the type rule above is what stops a read from making its own `Reader`.

## A retriever's rows are read again

- A retriever plugin is never given the database pool. It gets a reading already narrowed to the search's reader and
  filters, and a description of that scope for an index of its own.
- Any record a retriever returns that the reading did not hand out is read again from the database under the fence,
  as the engine's own keyword hits are. Every row that survives is then read again by its record's id under the fence.
  A row outside the fence is dropped and counted (`search.retriever_foreign_dropped`).
- So a retriever decides which records are considered. It never decides what they say, or whether the reader may see
  them. This is defence in depth, not isolation: the retriever runs in the engine's process.

## Tokens and the server's admission

- The server listens on `127.0.0.1` only, and speaks plain HTTP.
- Who a request reads or writes as is decided before its body is read:
  - A write route takes the write token and nothing else.
  - The read token reads every other route.
  - Without a token, only the browser's routes answer: the open ones, the sign-in among them, and those that take a
    session cookie. They answer only at a host the server is reached at, and a change only from a page it served.
  - Every other request gets the same `401`, on every path.
- The read token and the ingest door's token are each at least 32 characters, and both are compared in constant
  time. A route's handler gets the request without its
  credentials.
- The ingest door is off unless its source sets a token of its own. The server refuses to start when that token is the
  read token, which agents hold, or when two sources each open a door. A request to the door is at most 8 MB.
- A search cursor is sealed with authenticated encryption (AES-256-GCM) under a key made from the server's token. A
  client can neither read nor alter one. It opens on the server that issued it, also after a restart, and on no server
  holding a different token. An engine run without a server seals its cursors under a random key of its own.
- Each engine holds its own search cursor key, keyword-index endpoint (its settings and its group commit), telemetry
  and logger, so two engines in one process do not share them. A few things are still kept once per process, each
  listed by the guard below: the telemetry and logging a call site with no engine in reach reports to, the keyword
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
- **Guard the state directory.** The read token, the database password and the sidecar token live in it, with mode
  600. The engine refuses to keep its token in a directory that is a link, or that another user owns. Anyone who can
  read that directory can read every document.
- **Read every plugin before you add it**, and know what each remote service you configure receives.

## How each guarantee is checked

| Guarantee | Check | Where |
| --- | --- | --- |
| The fence fails closed, narrows without widening, filters by one predicate, and hides a document the reader cannot read | The database tests, which read as readers of part of the corpus and assert each case above | Here: `pnpm --filter @louvain/engine test:db` |
| The fence's decisions are tested | Mutation runs over a kept list of the fence's decisions: each listed decision is removed in turn, and a named test must fail on an assertion. A test that did not run, or a failure that does not repeat, is refused as a kill | Development repository. Too long for every check, it is run by hand after a change to that code. Every change is checked to leave no mutant without the code it removes, so the set cannot silently shrink |
| A build's hooks, and the engine's embedder, reach its reads and writes | Hook mutants: the embedder the engine lays on its reads and on its writes, and each hook the development build passes, are removed in turn, and a named test must fail. The presentation, keyword index, telemetry and logger the engine lays when a build passes none are covered by the engine's own tests instead | Mutants: development repository, as above. Tests: here |
| A `Reader` and a read context come only from their makers | The brands, enforced by the compiler; `check-fence-makers` and `check-fences` | Brands: here. Guards: development repository, every change |
| A retriever's rows are the engine's own, and a foreign one is dropped | The retriever contract test: a readable record survives with the engine's own text; a hidden one, a garbage id, and one outside the search's narrowing or date are dropped | Here, in the database tests |
| Admission and the server's tokens | The server's tests: the routes each token opens, the `401`, the host and origin checks | Here: `pnpm --filter @louvain/engine test` |
| No new module state, and what is per engine stays so | `check-engine-state`, which refuses module state in the engine but for the listed exceptions above, a list that may only shrink; and tests that two engines seal their cursors under different keys and hold different keyword-index endpoints | Guard: development repository, every change. Test: here |
| Loading the engine opens nothing | A test that imports the engine in a bare environment and finds no socket, file or timer opened; and `check-engine-door`, which follows everything the engine's entry point reaches | Test: here, in the command line's tests. Guard: development repository, every change |

Report a way past any of this privately, as `SECURITY.md` describes.
