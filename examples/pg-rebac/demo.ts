/**
 * One search as two people, fenced by pg_rebac: the engine's readable set is SpiceDB's answer, projected into the
 * engine's own Postgres by rebacd (`@louvain/engine-pg-rebac`). Everyone reads the handbook through a group; only alice
 * reads payroll; mallory was never granted anything. Run by run.sh, after the engine's stack and rebacd are up and
 * both collections are loaded. It exits non-zero when alice and bob do not see what their grants say.
 */
import {
  createEngine,
  databaseUrl,
  embedderFor,
  figuresRetriever,
  keywordRetriever,
  openReading,
  openStore,
  settingsOf,
  storeSettings,
  vectorRetriever,
} from "@louvain/engine";
import { createPluginRegistry, defineEngine } from "@louvain/engine-core";
import { pgRebac } from "@louvain/engine-pg-rebac";
import postgres, { type Sql } from "postgres";

const QUERY = "salary review";
/** rebacd's lookup endpoint, as compose.yml publishes it on the loopback address. */
const LOOKUP = "http://127.0.0.1:7341";

/** Each collection's grant, as SpiceDB relationships on every container ingest filed it under. */
const GRANTS: Record<string, string> = {
  handbook: "group:all-staff#member",
  payroll: "user:alice",
};

const sql = postgres(databaseUrl(), { max: 2, onnotice: () => {} });
try {
  const org = await orgOf(sql);
  await grant(sql, org);
  await relayed(sql);
  const seen = await searchAs(org, ["alice", "bob", "mallory"]);
  const ok =
    seen.alice?.some((t) => /salary.bands/i.test(t)) &&
    !seen.bob?.some((t) => /salary.bands/i.test(t));
  if (!ok) throw new Error("alice and bob did not see what their grants say");
} finally {
  await sql.end({ timeout: 5 });
}

async function orgOf(sql: Sql): Promise<string> {
  const [row] = await sql<{ id: string }[]>`select id::text as id from org where slug = 'default'`;
  if (!row) throw new Error("no default organisation: run ./engine up first");
  return row.id;
}

/** Everyone in all-staff, and each loaded container granted as its collection says, through rebac.write. */
async function grant(sql: Sql, org: string): Promise<void> {
  const containers = await sql<{ container: string }[]>`
    select container from readable_container where org_id = ${org}::uuid and principal_id = 'engine-reader'`;
  const ref = (type: string, id: string) => `${type}:${org}/${id}`;
  await sql.begin(async (tx) => {
    await tx`select set_config('rebac.tenant', ${org}, true)`;
    for (const who of ["alice", "bob"])
      await tx`select rebac.write('touch', ${ref("group", "all-staff")}, 'member', ${ref("user", who)})`;
    for (const { container } of containers) {
      const [type, id] = (GRANTS[container.split("/")[1] ?? ""] ?? "").split(":");
      if (type && id)
        await tx`select rebac.write('touch', ${ref("container", container)}, 'member', ${ref(type, id)})`;
    }
  });
}

/** Until rebacd has relayed every relationship to SpiceDB, so a first lookup asks a SpiceDB that holds them. */
async function relayed(sql: Sql): Promise<void> {
  for (let tries = 0; tries < 60; tries++) {
    const [s] = await sql<
      { pending: number }[]
    >`select pending_outbox::int as pending from rebac.status()`;
    if (s?.pending === 0) return;
    await new Promise((done) => setTimeout(done, 500));
  }
  throw new Error("rebacd did not relay the relationships within 30 s: docker compose logs rebacd");
}

/** The same search as each person, printed; each one's titles, by name. */
async function searchAs(org: string, people: string[]): Promise<Record<string, string[]>> {
  const store = openStore(databaseUrl(), storeSettings);
  const host = { readableSet: pgRebac(store.sql, { tenantOf: (orgId) => orgId, lookup: LOOKUP }) };
  const retriever = [vectorRetriever(), keywordRetriever(), figuresRetriever()];
  const plugins = await createPluginRegistry({ ...defineEngine({}), retriever });
  const engine = createEngine({
    store,
    embedder: embedderFor(host),
    plugins,
    host,
    settings: settingsOf(undefined),
  });
  const reading = openReading(engine);
  const seen: Record<string, string[]> = {};
  try {
    for (const who of people) {
      const page = await reading(who).tool("louvain_search_sources", { query: QUERY });
      const titles = ((page.sources ?? []) as { title: string }[]).map((s) => s.title);
      seen[who] = titles;
      console.log(`\n"${QUERY}" as ${who} (org ${org.slice(0, 8)}):`);
      console.log(
        titles.length
          ? titles.map((t, i) => `  ${i + 1}. ${t}`).join("\n")
          : "  (nothing this person may read)",
      );
    }
  } finally {
    await engine.close();
  }
  return seen;
}
