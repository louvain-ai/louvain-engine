# engine-pg-rebac

The engine's readable set from [pg_rebac](https://github.com/louvain-ai/pg_rebac): who may read what is SpiceDB's
answer, projected into Postgres by pg_rebac's daemon, `rebacd`, and read with `rebac.readable_set`. Use it when your
access rules already live in SpiceDB, or should, instead of the flat grants in `engine.config.ts`.

It is a host binding, not a plugin a configuration names: the readable set decides sight, so an entry binds it in
code, once, for the engine it builds.

```ts
import { createEngine, embedderFor, openStore, settingsOf, storeSettings } from "@louvain/engine";
import { pgRebac } from "@louvain/engine-pg-rebac";

const store = openStore(process.env.DATABASE_URL, storeSettings);
const host = { readableSet: pgRebac(store.sql, { tenantOf: (orgId) => orgId, lookup: "http://rebacd:7341" }) };
const engine = createEngine({ store, embedder: embedderFor(host), plugins, host, settings: settingsOf(undefined) });
```

- `tenantOf` (required) maps the engine's org to the pg_rebac `tenant` its relationships are written in. There is no
  default: a guess at whose relationships these are would be a wider read.
- `lookup` is rebacd's address. A reader pg_rebac was never asked about is looked up there once, then read again.
  Without it, such a reader fails closed.
- `lookupTimeoutMs` bounds that lookup (default 5000).

A reader reads as their reader name, SpiceDB's `user:<t>/<name>`, and a container is the engine's own id
(`ingest/<collection>/<folder>`), written as `container:<t>/<id>`, where `<t>` is what `tenantOf` gives.

## Three answers, never confused

| pg_rebac says | The resolver | The read |
| --- | --- | --- |
| A set | the set | fenced to it |
| Asked, and nothing (an empty set, a retired reader) | `[]` | reads nothing |
| Never asked (`RB404`) | asks rebacd once, then reads again; still unknown, `ReaderNotProjected` | fails |
| Too old (`RB503`, hint `rebac_not_fresh`: past pg_rebac's freshness bound) | asks rebacd once, then reads again; still old, `PermissionsUnavailable` | fails |
| Unavailable (any other `RB503`: a daemon not beating, a schema change being rebuilt, a cap, a lookup SpiceDB could not answer) | `PermissionsUnavailable` | fails |

A failed read is a failed tool call, never an empty page. Any other error (a missing `rebac.tenant` is `RB400`) is thrown as
it came. `rebac.tenant` is set with `set_config(..., true)` inside one transaction per resolution, so a pooled connection
never carries it to the next read.

`rebac.breadth` runs first: it always runs pg_rebac's check, so a reader who may read nothing is told by that check and
never by an empty scan. The engine's own vector leg decides its scan from the fenced set it holds; the breadth is not
passed on.

## Tests

`pnpm test` runs the three answers against a stand-in pool. `pnpm test:db`, with `TEST_AUTH_DATABASE_URL` naming a
Postgres server with pgvector, runs them on pg_rebac's own SQL, at the commit `test/db/database.ts` pins (fetched, or the file `PG_REBAC_SQL`
names, checked against its digest either way), and through the
engine's fence. [`examples/pg-rebac`](../../../examples/pg-rebac) runs the whole stack: SpiceDB, rebacd and two people
seeing different results.
