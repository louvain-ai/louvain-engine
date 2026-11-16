# Operations

**In short:** `./engine up` starts everything, `./engine down` stops it, and `./engine help` lists every command.
`./engine` is a bash script at the repository's root; read it to see what it runs.

You need Docker with Compose, Node 22, pnpm 10.23 or later, and curl.

## Start

1. Run **`./engine up`**.

```text
$ ./engine up
Installing (the lockfile pins every version)...
Building the workspace packages...
Settings: wrote .env from .env.example.
Starting the engine's services (the first run builds their images)...
Reranker: off (engine.config.ts names none).
Schema: loaded.
Tools: http://127.0.0.1:8080/mcp
App:   http://127.0.0.1:8080/app/
Token: .engine/token
Ready.
```

The first run downloads packages, images and the embedding model, writes `.env`, makes this install's secrets and
loads the schema. A later run starts only what is not running, and restarts the tool server when the build, `.env` or a
secret is newer than it.

### Move a port

Every service listens on `127.0.0.1` only. A port that is taken stops `up` and names the setting that moves it.

| Service | Port | Setting |
| --- | --- | --- |
| Postgres | 5434 | `LOUVAIN_PG_HOST_PORT` |
| Embedding sidecar | 8091 | `LOUVAIN_EMBEDDINGS_HOST_PORT` |
| Keyword (BM25) sidecar | 8095 | `LOUVAIN_BM25_HOST_PORT` |
| Tool server | 8080 | `LOUVAIN_ENGINE_PORT` |
| Bulk embedding lane (optional) | 8092 | `LOUVAIN_EMBEDDINGS_BULK_HOST_PORT` |

1. Set the setting in **`.env`** or in the shell (the shell wins). A value that is not a port from 1 to 65535 is
   refused: `engine: LOUVAIN_ENGINE_PORT must be a port number from 1 to 65535, not '70000'`.
2. For a second install on the same machine, also set **`COMPOSE_PROJECT_NAME`**.
3. Run **`./engine up`**.

```text
$ export COMPOSE_PROJECT_NAME=docholliday LOUVAIN_PG_HOST_PORT=27434 LOUVAIN_EMBEDDINGS_HOST_PORT=27091 \
    LOUVAIN_BM25_HOST_PORT=27095 LOUVAIN_ENGINE_PORT=27080
$ ./engine up
Starting the engine's services (the first run builds their images)...
Schema: already loaded.
Tools: http://127.0.0.1:27080/mcp
Token: .engine/token
Ready.
```

### Secrets

`up` keeps three secrets in the `.engine` directory, each readable only by you and never printed:

| File | What it is |
| --- | --- |
| `.engine/db-password` | The Postgres password. Every `up` sets the database role's password to it |
| `.engine/sidecar-token` | The token the embedding and keyword sidecars require |
| `.engine/token` | The bearer token an agent sends, written by the tool server at its first start: the default reader's |
| `.engine/readers/<name>` | A named reader's token, made by `./engine reader add <name>` ([Permissions](permissions.md)) |

To rotate one, run **`./engine down`**, delete its file, then run **`./engine up`**. A `DATABASE_URL` you set yourself
is yours: `./engine` never changes its password.

## Load and search

1. Load a folder with **`./engine ingest folder --folder <path>`**, or a file of JSON records with
   **`./engine ingest records --records <file>`** (`-` reads standard input).

```text
$ ./engine ingest folder --folder notes
ingesting notes into "notes"
  backups.md: added (text)
  ops/on-call.md: added (text)
"notes": 2 added, 0 updated, 0 removed, 0 unchanged; 2 new passages
keyword index: 2 indexed
$ ./engine ingest records --records tickets.jsonl
ingesting tickets.jsonl into "tickets"
  T-1: added
  T-2: added
"tickets": 2 added, 0 updated, 0 removed, 0 unchanged; 2 new passages
keyword index: 2 indexed
```

2. Search with **`./engine search "<words>"`**. It prints the matches one a line: rank, title, date and the id's first
   12 characters.

```text
$ ./engine search "When does the Harbour Street lease renew?"
1. lease-renewal · 2026-11-14 · 21f66a2fce06
2. facilities-agreement · 2026-11-14 · 3ddbf3935ef4
3. hiring-plan · 2026-11-14 · e6d55af948e4
$ ./engine search --full-ids "lease"
1. lease-renewal · 2026-11-14 · 21f66a2fce064bfa91514fdcfea1de25d8a72d97ab25628fe856f8593be42724
2. facilities-agreement · 2026-11-14 · 3ddbf3935ef4dd3c16019bff26e1f856120439be2fc4848ccbb3f29c63394dfe
$ ./engine search "T-2"
1. VPN drops at 17:00 · 2026-11-02 · 96b8f1a15cc1
$ ./engine search "giraffe"
Nothing found among 7 loaded documents.
```

- `--full-ids` prints the whole id, which `louvain_read_source` takes.
- `--question "<question>"` also searches the question the words were chosen for.
- `--` ends the flags: `./engine search -- -5% rise`.
- A record shows the date it states; a document from another app shows the app before its date.

Running `ingest` again loads only what changed. [Ingest](ingest.md) has the options and [How search works](search.md)
the page.

## Connect an agent

1. Add the server to your agent with the token in `.engine/token`. With Claude Code:

```sh
claude mcp add --transport http louvain-engine http://127.0.0.1:8080/mcp --header "Authorization: Bearer $(cat .engine/token)"
```

The server speaks MCP's Streamable HTTP at `/mcp`, through the official MCP TypeScript SDK, stateless and answered as
JSON. It needs `Authorization: Bearer <token>` on every request (`LOUVAIN_ENGINE_TOKEN`, at least 32 characters,
replaces the file's token) and, as the protocol requires, `Accept: application/json, text/event-stream` on every POST;
the SDK agrees the protocol version and refuses a `MCP-Protocol-Version` header it does not speak. `/mcp` takes POST alone:
any other method is 405. It is the `mcp()` surface (`engine.config.ts`, `surfaces`). The engine's own token reads
everything loaded; give an agent that should read less a reader's token of its own ([Permissions](permissions.md)).
Keep the server on `127.0.0.1`; reach it from another machine only through a tunnel or proxy you secure. `examples/agent` calls the three
tools the way an agent does, with no model.

## Open the app

1. Run **`./engine app`**. It opens the app in this machine's browser, or prints the address:

```text
$ ./engine app
App: http://127.0.0.1:8080/app/ (sign in once with the token in .engine/token)
```

`surfaces: [mcp()]` in `engine.config.ts` serves the tools alone. See [The app](app.md).

## Check status and logs

1. Run **`./engine status`**.

```text
$ ./engine status
Profile:        default (engine.config.ts)
Tool server:    running at http://127.0.0.1:8080/mcp (pid 395922)
App:            http://127.0.0.1:8080/app/
Postgres:       running on port 5434
Embeddings:     running on port 8091
Keyword index:  running on port 8095
Reranker:       not running
Documents:      4 loaded
Token file:     .engine/token
```

2. Run **`./engine logs [service]`** for recent output of `server`, `postgres`, `embeddings`, `bm25` or `rerank`, or of
   all of them. Add `--follow` to keep reading. The tool server's own log is `.engine/server.log`.

```text
$ ./engine logs server
Louvain Engine is listening at http://127.0.0.1:8080/mcp; its bearer token is in .engine/token.
Its app is at http://127.0.0.1:8080/app/
```

## Stop

1. Run **`./engine down`**. Your data is kept.

```text
$ ./engine down
Tool server: stopped.
 ...
Services: stopped. Your data is kept; ./engine up starts it again.
```

2. To delete the data too, run **`./engine down --volumes`**. It asks first; from a script, add `--yes`.

```text
$ ./engine down --volumes
This deletes the engine's database and keyword index, and every document loaded into them.
engine: not a terminal, so nothing was deleted. Run it again with --yes to confirm.
$ ./engine down --volumes --yes
 ...
Services: stopped, and the data removed.
```

## Upgrade

1. Run **`git pull`**.
2. Run **`./engine up`**. It reinstalls when the lockfile changed, rebuilds what changed, and restarts the tool server.

```text
$ ./engine up
Building the workspace packages...
Starting the engine's services (the first run builds their images)...
Keyword index: rebuilt from this checkout.
Reranker: off (engine.config.ts names none).
Schema: already loaded.
Tool server: started again; it was running from before the build, settings or secrets changed.
Tools: http://127.0.0.1:8080/mcp
App:   http://127.0.0.1:8080/app/
Token: .engine/token
Ready.
```

   The keyword index is built from your records, so an index an earlier release built never stops `up`: when this
   release's keyword sidecar cannot open it, or reads it only in part, `up` empties it and rebuilds it from the records
   loaded, and says so in one line (`Keyword index: an earlier release built it; rebuilding it from the records
   loaded...`). Until then the sidecar runs, reports the rebuild it needs and refuses to read the old files.

3. If `up` says the database holds another schema, it changed nothing. This release ships no schema upgrade, so
   such a database starts again: **`./engine down --volumes`** (it deletes this install's database), **`./engine up`**,
   then load your documents again with **`./engine ingest`**.

```text
$ ./engine up
Starting the engine's services (the first run builds their images)...
engine: the database holds a schema other than the one this release was built for (or one that could not be compared with it), and this release ships no upgrade for it. Nothing was changed or deleted. To go on, run ./engine down --volumes (it deletes this install's database), then ./engine up, and load your documents again with ./engine ingest.
```

`up`, `ingest` and `search` all refuse a database built for another release this way. A tool server already running
keeps running until `./engine down`.

## Reindex

1. Run **`./engine reindex`**, then **`./engine up`**.

```text
$ ./engine reindex
Schema: already this release's.
Keyword index: emptying and rebuilding it from the records loaded...
 ...
Keyword index: 9 records indexed again.
```

`reindex` rebuilds the keyword index from the records loaded: an entry for each record, and one for each document from
its current revision. Nothing is embedded again, and the documents stay. Running it again changes nothing but the
keyword index.

A release that changes the schema ships its upgrades in `db/upgrades/`, and `reindex` applies them first, in name
order, in one transaction that commits only if the result has that release's schema; otherwise it rolls back whole and
says so. This release ships none.

An upgrade never deletes a document, passage or revision. A database `reindex` cannot upgrade starts again:

```sh
./engine down --volumes
./engine up
./engine ingest folder --folder <path>
```

## Back up

The documents live in Postgres; the keyword index is rebuilt from them, so a back-up is one database dump.

1. Find this install's Postgres container, from the repository's root:

```sh
PG=$(docker ps -q --filter label=com.docker.compose.service=postgres --filter "label=com.docker.compose.project.working_dir=$PWD")
```

2. Dump the database: **`docker exec "$PG" pg_dump -U engine -Fc engine > engine.dump`**.

### Restore

1. Start from an empty database: **`./engine down --volumes --yes`**, then **`./engine up`**.
2. Find the container again (step 1 above), then restore:
   **`docker exec -i "$PG" pg_restore -U engine -d engine --clean --if-exists < engine.dump`**.
3. Rebuild the keyword index: **`./engine reindex`**.

```text
$ ./engine reindex
Schema: already this release's.
Keyword index: emptying and rebuilding it from the records loaded...
 ...
Keyword index: 4 records indexed again.
$ ./engine search "When does the Harbour Street lease renew?"
1. lease-renewal · 2026-11-14 · 635803b968c4
2. facilities-agreement · 2026-11-14 · b145970b74cd
3. hiring-plan · 2026-11-14 · 1a0e7742307a
```

The dump holds no password or token: those stay in the `.engine` directory. Restore into an install of the same release.

## Load faster with the bulk lane

1. Start the Compose profile **`bulk`** as the header of `docker-compose.yml` shows.
2. Set **`LOUVAIN_EMBEDDINGS_BULK_URL`** to its address.

A large load then embeds on its own instance and does not queue in front of searches.

## Run the tests

1. Run **`pnpm run test`** for every package's unit tests. None needs a database.
2. Run the database tests and the stack smoke test against this install:

```sh
DATABASE_URL="postgres://engine:$(cat .engine/db-password)@127.0.0.1:5434/engine"
TEST_AUTH_DATABASE_URL="$DATABASE_URL" pnpm --filter @louvain/engine test:db
DATABASE_URL="$DATABASE_URL" LOUVAIN_SIDECAR_TOKEN="$(cat .engine/sidecar-token)" \
LOUVAIN_EMBEDDINGS_URL="http://127.0.0.1:8091" LOUVAIN_BM25_URL="http://127.0.0.1:8095" \
  pnpm --dir packages/engine exec tsx scripts/verify-engine-stack.ts
```

The database tests hold each search's answer and the SQL each read sends to what is recorded beside them. A change
that moves one on purpose records them again with `test:db:record`, which prints what moved.
