import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { installSetting } from "./install.js";
import type { Place } from "./steps.js";

/**
 * From a cited id to the benchmark's document. An item's key is its dsid, or `<dsid>#<n>` for the n-th message of a
 * split document, and the engine keeps it as the document's `native_id`. Search results do not carry the key, so it is
 * read from this install's database: `DATABASE_URL` when set, else the address `./engine` builds (its `engine` role and
 * database; `LOUVAIN_PG_HOST_PORT` from the environment or the install's `.env`, else 5434; the password it made in the
 * profile's state folder, `Place.state`).
 */
export type KeyResolver = (ids: readonly string[]) => Promise<Map<string, string>>;

type Sql = {
  <T>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T>;
  end(): Promise<void>;
};

export function databaseKeys(p: Place): KeyResolver {
  const { engineRoot } = p;
  // The engine's own Postgres client, from the engine's install: this folder is not a package with dependencies.
  const postgres = createRequire(join(engineRoot, "packages/engine/package.json"))("postgres") as (
    url: string,
  ) => Sql;
  let sql: Sql | null = null;
  return async (ids) => {
    if (ids.length === 0) return new Map();
    sql ??= postgres(databaseUrl(p));
    const rows = await sql<{ id: string; key: string }[]>`
      select id::text as id, native_id as key from source_document
       where id::text = any(${[...ids]}::text[]) and left(native_id, 5) = 'dsid_'`;
    return new Map(rows.map((r) => [r.id, r.key.split("#")[0] ?? r.key]));
  };
}

function databaseUrl(p: Place): string {
  const named = process.env.DATABASE_URL?.trim();
  if (named) return named;
  const password = readFileSync(join(p.state, "db-password"), "utf8").trim();
  const port = installSetting(p.engineRoot, "LOUVAIN_PG_HOST_PORT") ?? "5434";
  return `postgres://engine:${encodeURIComponent(password)}@localhost:${port}/engine`;
}

/** The cited ids as the evaluator's document ids, in citation order, each document once. */
export async function documentIds(
  resolve: KeyResolver,
  cited: readonly string[],
): Promise<string[]> {
  const byId = await resolve(cited);
  return [...new Set(cited.flatMap((id) => byId.get(id) ?? []))];
}
