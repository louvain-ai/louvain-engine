# Permissions from SpiceDB, with pg_rebac

The same search as two people, each fenced by SpiceDB: the engine's readable set comes from
[pg_rebac](https://github.com/louvain-ai/pg_rebac) (`@louvain/engine-pg-rebac`) instead of `engine.config.ts`'s grants.

- **handbook** is read by everyone in the group `all-staff` (alice and bob);
- **payroll** is read by alice alone;
- **mallory** was never granted anything.

```sh
examples/pg-rebac/run.sh
```

It runs `./engine up`, lays SpiceDB, pg_rebac's SQL and rebacd over the engine's own Compose stack (`compose.yml`),
loads the two collections and runs `demo.ts`, which writes the relationships with `rebac.write`, waits for rebacd to
relay them, and searches "salary review" as each person:

```text
"salary review" as alice (org 527b7c27):
  1. salary-bands-2027
  2. payroll-cut-off
  3. annual-pay-review

"salary review" as bob (org 527b7c27):
  1. annual-pay-review

"salary review" as mallory (org 527b7c27):
  (nothing this person may read)
```

The first person to search is looked up through rebacd (pg_rebac's `RB404`, never asked), and read again. If rebacd
stops, pg_rebac refuses every read within five seconds (`RB503`), and the search fails with `PermissionsUnavailable`
instead of returning less (the package's database tests show it through the engine's fence).

The first run builds rebacd from pg_rebac's repository (`PG_REBAC_REF` pins the commit). To stop the example's
services, then the engine's:

```sh
export LOUVAIN_PG_PASSWORD="$(cat .engine/db-password)" LOUVAIN_SIDECAR_TOKEN="$(cat .engine/sidecar-token)"
docker compose --env-file /dev/null -f docker-compose.yml -f examples/pg-rebac/compose.yml stop spicedb rebacd
./engine down
```

What it shows, and what it does not: the fence is the engine's own, every read, with SpiceDB deciding who reads which
container. The demo binds the resolver in its own process (`demo.ts`); a server of yours binds it the same way in the
entry that builds its engine.
