import { randomUUID } from "node:crypto";
import type { Sql } from "postgres";
import { heldCount } from "./held.js";
import type { Collection } from "./held-types.js";

/**
 * A collection belongs to the source that feeds it, and one run at a time ingests into it. Another source may neither
 * replace nor remove what it holds, and a whole listing keeps to one origin, so a wrong folder is refused before
 * anything is read; only a person at the command line takes a collection over. The run holds a lease on the
 * collection's row, renewed while it works and taken over once it expires, so a run that dies frees it by expiry.
 */
export class IngestRefused extends Error {}
/** Another source or origin owns the collection: the one refusal a person may override, by taking it over. */
export class OriginRefused extends IngestRefused {}

export type Claim = { source: string; origin: string; lists: "all" | "some"; takeOver: boolean };
export type Hold = { renew: () => Promise<void>; release: () => Promise<void> };

/** How long a run holds the collection without renewing it, and how often it renews. */
const LEASE_SECONDS = 300;
const RENEW_EVERY_MS = 60_000;

/** Checks the run may feed the collection, then holds it for the run, or refuses saying which and why. */
export async function claimCollection(
  sql: Sql,
  collection: Collection,
  claim: Claim,
  leaseSeconds = LEASE_SECONDS,
): Promise<Hold> {
  if (!claim.takeOver) await checkOwner(sql, collection, claim);
  const holder = randomUUID();
  const [held] = await sql<{ holder: string }[]>`
    insert into ingest_collection (org_id, collection, source, origin, lists, holder, held_until)
    values (${collection.orgId}, ${collection.name}, ${claim.source}, ${claim.origin}, ${claim.lists},
            ${holder}, now() + make_interval(secs => ${leaseSeconds}))
    on conflict (org_id, collection) do update
       set source = excluded.source, origin = excluded.origin, lists = excluded.lists,
           holder = excluded.holder, held_until = excluded.held_until
     -- The conflicting row alone, its holder free or expired; its owner checked again, as it may have changed since.
     where (ingest_collection.holder is null or ingest_collection.held_until < now()) -- sql-shape: one row's columns
       and (${claim.takeOver}::boolean or (ingest_collection.source = excluded.source -- sql-shape: one row's columns
            and (excluded.lists = 'some' or ingest_collection.origin = excluded.origin))) -- sql-shape: one row's columns
    returning holder`;
  if (!held)
    throw new IngestRefused(
      `"${collection.name}" is being ingested into by another run. Try again when it ends.`,
    );
  return lease(sql, collection, holder, leaseSeconds);
}

async function checkOwner(sql: Sql, collection: Collection, claim: Claim): Promise<void> {
  const [owner] = await sql<{ source: string; origin: string }[]>`
    select source, origin from ingest_collection
     where org_id = ${collection.orgId} and collection = ${collection.name}`;
  const name = `"${collection.name}"`;
  if (owner && owner.source !== claim.source)
    throw new OriginRefused(
      `${name} is fed by the ${owner.source} source, not this one. Nothing was read.`,
    );
  if (owner && claim.lists === "all" && owner.origin !== claim.origin)
    throw new OriginRefused(
      `${name} was loaded from ${owner.origin}, not ${claim.origin}. Nothing was read.`,
    );
  if (owner) return;
  const held = await heldCount(sql, collection);
  if (held > 0)
    throw new OriginRefused(
      `${name} holds ${held} item${held === 1 ? "" : "s"} no source of its own loaded.`,
    );
}

/** The run's hold: renewed at most once a minute while it works, and let go of however the run ends. */
function lease(sql: Sql, collection: Collection, holder: string, leaseSeconds: number): Hold {
  let renewed = Date.now();
  const mine = () =>
    sql`org_id = ${collection.orgId} and collection = ${collection.name} and holder = ${holder}`;
  return {
    renew: async () => {
      if (Date.now() - renewed < RENEW_EVERY_MS) return;
      const kept =
        await sql`update ingest_collection set held_until = now() + make_interval(secs => ${leaseSeconds})
        where ${mine()} returning 1`;
      if (kept.length === 0)
        throw new IngestRefused(
          `"${collection.name}" was taken over while this run was paused. Run it again.`,
        );
      renewed = Date.now();
    },
    release: async () => {
      await sql`update ingest_collection set holder = null, held_until = null where ${mine()}`;
    },
  };
}
