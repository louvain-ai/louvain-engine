import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

/**
 * A DATABASE OF THE TEST'S OWN, BUILT FROM THE ENGINE'S BASELINE SCHEMA AND NOTHING ELSE.
 *
 * `TEST_AUTH_DATABASE_URL` names a Postgres server (with pgvector) where the test may create a database. The test makes
 * one named `engine_<purpose>_<random>_test`, loads the baseline schema into it, points `DATABASE_URL` at it before the
 * engine's pool is first imported, and drops it by that exact name when it is done. Without the setting the test is
 * skipped, and says why.
 */
export const serverUrl = process.env.TEST_AUTH_DATABASE_URL;
export const skipWithoutDatabase = serverUrl
  ? false
  : "TEST_AUTH_DATABASE_URL is not set: these tests need a Postgres server";

/** The schema file: `db/baseline.sql` in the engine's repository, or where the generator writes it. */
function baselineSql(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  while (!existsSync(join(dir, "pnpm-workspace.yaml"))) dir = dirname(dir);
  const shipped = join(dir, "db", "baseline.sql");
  return readFileSync(
    existsSync(shipped) ? shipped : join(dir, "scripts", "engine-export", "baseline.sql"),
    "utf8",
  );
}

export type TestDatabase = { url: string; drop: () => Promise<void> };

export async function createBaselineDatabase(purpose: string): Promise<TestDatabase> {
  const server = new URL(serverUrl as string);
  server.searchParams.delete("options");
  const name = `engine_${purpose}_${randomUUID().replaceAll("-", "").slice(0, 12)}_test`;
  const root = postgres(server.href, { max: 1, onnotice: () => {} });
  const target = new URL(server.href);
  target.pathname = `/${name}`;
  const drop = async () => {
    await root.unsafe(`drop database if exists "${name}" with (force)`);
    await root.end({ timeout: 5 });
  };
  try {
    // A fixed collation, so text sorts the same on every server the golden runs on.
    await root.unsafe(
      `create database "${name}" template template0 encoding 'UTF8' lc_collate 'C' lc_ctype 'C'`,
    );
    const loader = postgres(target.href, { max: 1, onnotice: () => {} });
    try {
      await loader.unsafe(baselineSql());
      // Statistics change only when a test asks (`analyze`), so a plan never depends on when autovacuum last looked.
      await loader.unsafe(`do $$ declare t regclass; begin
        for t in select oid from pg_class where relkind = 'r' and relnamespace = 'public'::regnamespace loop
          execute format('alter table %s set (autovacuum_enabled = false)', t);
        end loop; end $$`);
    } finally {
      await loader.end({ timeout: 5 });
    }
  } catch (err) {
    await drop();
    throw err;
  }
  process.env.DATABASE_URL = target.href;
  return { url: target.href, drop };
}
