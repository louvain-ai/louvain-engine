# @louvain/engine

The engine package: hybrid search over documents held in Postgres, served to AI agents over MCP. It depends on no
plugin and reads no configuration file: the commands `./engine` runs live in `packages/cli`, which loads
`engine.config.ts`, starts its plugins and hands them to the engine:

| Command | Entry | What it does |
| --- | --- | --- |
| `./engine ingest <source> --<field> …` | `packages/cli/src/ingest.ts` | Runs a source the configuration names, its request's fields as flags: `folder` keeps a collection in step with a folder, `records` loads items from a JSON Lines file. |
| `./engine search "<words>"` | `packages/cli/src/search.ts` | Prints the matching documents, best first. |
| `./engine up` | `packages/cli/src/serve.ts` | Serves the search and read tools over MCP with one token (`src/server/serve.ts`), and takes items at `/ingest` with another. |

All three ways in are ingest sources (`src/ingest/sources/`), and their items go through the one ingest
(`src/ingest/ingest.ts`). It adds a new key, leaves an unchanged one alone, replaces an updated one and withdraws a
removed one (`src/ingest/withdraw.ts`).

`./engine help` lists every command, [Architecture](../../docs/architecture.md) maps the code, and the repository's
`README.md` describes the tools.
