import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

/**
 * A database of the test's own: the engine's baseline schema and pg_rebac's SQL, nothing else. `TEST_AUTH_DATABASE_URL`
 * names a Postgres server (with pgvector) where the test may create one; it is named `engine_pgrebac_<random>_test`
 * and dropped by that exact name. Without the setting the tests are skipped, and say why.
 */
export const serverUrl = process.env.TEST_AUTH_DATABASE_URL;
export const skipWithoutDatabase = serverUrl
  ? false
  : "TEST_AUTH_DATABASE_URL is not set: these tests need a Postgres server";

const here = dirname(fileURLToPath(import.meta.url));

/** pg_rebac's SQL at the commit these tests pin, and its digest: a moving branch never changes what they test. */
const PINNED = "9e643e7d169e82d754239c491ca813c2a8515fdd";
const DIGEST = "f8ae02c6e033b792a3af1410ee2ff45f7062d5a9d2a382736371281d043252ee";

/** The pinned SQL: the file `PG_REBAC_SQL` names, else fetched from pg_rebac's repository; either must match. */
async function rebacSql(): Promise<string> {
  const path = process.env.PG_REBAC_SQL;
  const url = `https://raw.githubusercontent.com/louvain-ai/pg_rebac/${PINNED}/sql/rebac.sql`;
  const text = path ? readFileSync(path, "utf8") : await (await fetch(url)).text();
  const digest = createHash("sha256").update(text).digest("hex");
  if (digest !== DIGEST)
    throw new Error(`pg_rebac's SQL is not the pinned commit's (${path ?? url})`);
  return text;
}

/** The engine's schema: `db/baseline.sql` in the engine's repository, or where the generator writes it. */
function baselineSql(): string {
  let dir = here;
  while (!existsSync(join(dir, "pnpm-workspace.yaml"))) dir = dirname(dir);
  const shipped = join(dir, "db", "baseline.sql");
  return readFileSync(
    existsSync(shipped) ? shipped : join(dir, "scripts", "engine-export", "baseline.sql"),
    "utf8",
  );
}

export type TestDatabase = { url: string; drop: () => Promise<void> };

export async function createDatabase(): Promise<TestDatabase> {
  const server = new URL(serverUrl as string);
  const name = `engine_pgrebac_${randomUUID().replaceAll("-", "").slice(0, 12)}_test`;
  const root = postgres(server.href, { max: 1, onnotice: () => {} });
  const target = new URL(server.href);
  target.pathname = `/${name}`;
  const drop = async () => {
    await root.unsafe(`drop database if exists "${name}" with (force)`);
    await root.end({ timeout: 5 });
  };
  await root.unsafe(`create database "${name}" template template0 encoding 'UTF8'`);
  const loader = postgres(target.href, { max: 1, onnotice: () => {} });
  try {
    await loader.unsafe(baselineSql());
    await loader.unsafe(await rebacSql());
  } catch (err) {
    await drop();
    throw err;
  } finally {
    await loader.end({ timeout: 5 });
  }
  return { url: target.href, drop };
}
