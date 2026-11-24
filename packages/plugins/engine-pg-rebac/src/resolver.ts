/**
 * pg_rebac as the engine's readable set: the containers `rebac.readable_set` holds for a reader in the `tenant` its
 * org maps to. Three answers stay three: a set (an empty one reads nothing), a reader never asked or a set past its
 * freshness bound (looked up once through rebacd, then read again), and unavailable, which throws, never an empty set.
 */
import type { ReadableSetResolver } from "@louvain/engine-core";
import type { Sql } from "postgres";
import { type Lookup, lookupAt } from "./lookup.js";
import { PermissionsUnavailable, ReaderNotProjected } from "./refusals.js";

export type PgRebacOptions = {
  /** The pg_rebac `tenant` an engine org reads in (its `rebac.tenant`). Required: a default would guess whose relationships these are. */
  tenantOf: (orgId: string) => string;
  /** rebacd's address (`http://rebacd:7341`), which a reader never asked is looked up at; none fails them closed. */
  lookup?: string;
  /** How long a lookup may take, in milliseconds (default 5000). */
  lookupTimeoutMs?: number;
};

/**
 * Why a read needs rebacd before it can answer: the reader was never asked (RB404), or its set is older than
 * pg_rebac's freshness bound (RB503, hint `rebac_not_fresh`), which a lookup renews. Every other RB503 stays a throw.
 */
type Ask = { readonly ask: "never asked" | "not fresh" };
const NEVER_ASKED: Ask = { ask: "never asked" };
const NOT_FRESH: Ask = { ask: "not fresh" };

export function pgRebac(sql: Sql, options: PgRebacOptions): ReadableSetResolver {
  const ask = options.lookup ? lookupAt(options.lookup, options.lookupTimeoutMs ?? 5_000) : null;
  return {
    readableSet: (principal, orgId) =>
      readOrAsk(sql, ask, { tenant: options.tenantOf(orgId), principal }),
    admitted: () => [],
  };
}

/** Who is read, and in which `tenant`. */
type Asked = { tenant: string; principal: string };

async function readOrAsk(
  sql: Sql,
  ask: Lookup | null,
  { tenant, principal }: Asked,
): Promise<string[]> {
  const first = await readSet(sql, tenant, principal);
  if (Array.isArray(first)) return first;
  if (ask === null) refused(first, "and no rebacd is named to ask");
  await ask(tenant, principal);
  const again = await readSet(sql, tenant, principal);
  if (Array.isArray(again)) return again;
  return refused(again, "even after rebacd looked the reader up");
}

/** A read that still needs rebacd, refused by its reason: never asked is not projected, too old is unavailable. */
function refused(why: Ask, after: string): never {
  if (why === NEVER_ASKED)
    throw new ReaderNotProjected(`pg_rebac was never asked about this reader, ${after}`);
  throw new PermissionsUnavailable(`pg_rebac's set for this reader is too old to read, ${after}`);
}

/**
 * The reader's set in one transaction, `rebac.tenant` set for it alone. `breadth` goes first because it always runs
 * pg_rebac's check, so a reader who reads nothing is told by that check, never by an empty scan.
 */
async function readSet(sql: Sql, tenant: string, principal: string): Promise<string[] | Ask> {
  try {
    return await sql.begin(async (tx) => {
      await tx`select set_config('rebac.tenant', ${tenant}, true)`;
      const [row] = await tx<{ n: number }[]>`select rebac.breadth(${principal}) as n`;
      if (!row?.n) return [];
      const rows = await tx<{ c: string }[]>`
        select c from rebac.readable_set(${principal}) as c order by c`;
      return rows.map((r) => r.c);
    });
  } catch (err) {
    const { code, hint } = (err ?? {}) as { code?: unknown; hint?: unknown };
    if (code === "RB404") return NEVER_ASKED;
    if (code === "RB503" && typeof hint === "string" && hint.startsWith("rebac_not_fresh"))
      return NOT_FRESH;
    if (code === "RB503")
      throw new PermissionsUnavailable("pg_rebac cannot answer for this reader now", {
        cause: err,
      });
    throw err;
  }
}
