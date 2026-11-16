/**
 * The engine's own smoke test: the open accept and index path against the engine's Compose services and a database
 * made from the generated schema alone, as a public reader would run it.
 *
 *   ./engine up                      # the services, this install's secrets in .engine/, and the schema
 *   DATABASE_URL=… LOUVAIN_SIDECAR_TOKEN=… LOUVAIN_EMBEDDINGS_URL=… LOUVAIN_BM25_URL=… \
 *     (cd packages/engine && npx tsx scripts/verify-engine-stack.ts)
 *
 * DATABASE_URL carries the password in `.engine/db-password` and LOUVAIN_SIDECAR_TOKEN is `.engine/sidecar-token`: the
 * stack takes no default credential.
 *
 * One document is accepted (`acceptOpen`), made readable to one reader (`writeProjection`), indexed (`indexOpen`:
 * passages through the embedding sidecar, a keyword entry in the BM25 sidecar), found (`searchPassages`) and read whole
 * (`readSourcePage`, the read tool's page) under the open resolver; a second accept and a second index change nothing; a reader with no rows
 * finds and reads nothing. The grammar sidecar's address is a counting stub for the run: loading, search and reading
 * never call it. Each run accepts a document of its own, so it can be run again on the same database. Exit 0 on
 * every check passing.
 */
import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

let grammarCalls = 0;
const grammar = createServer((_req, res) => {
  grammarCalls += 1;
  res.statusCode = 503;
  res.end();
});
await new Promise<void>((r) => grammar.listen(0, "127.0.0.1", r));
process.env.LOUVAIN_NLP_URL = `http://127.0.0.1:${(grammar.address() as AddressInfo).port}`;

const { sanitizeId } = await import("../src/store/ids.js");
const { config, storeSettings } = await import("../src/config/engine.js");
const { openStore } = await import("../src/store/pool.js");
const store = openStore(config.databaseUrl, storeSettings);
const { createEngine } = await import("../src/engine.js");
const { embedderFor } = await import("../src/host/embedder.js");
const { settingsOf } = await import("../src/config/settings.js");
const { openHost } = await import("../src/host/standalone.js");
// The open build's engine over the process pool, as an open entry builds it; its embedder is the one the writes ask.
const host = openHost(store.sql);
const engine = createEngine({
  store,
  embedder: embedderFor(host),
  plugins: { list: () => [], waiting: () => [], one: () => null, close: async () => {} },
  host,
  settings: settingsOf(undefined),
});
const { sql } = store;
const { context: readContext, writes } = engine;
const { acceptOpen } = await import("../src/ingest/accept.js");
const { indexOpen } = await import("../src/ingest/indexer.js");
const { writeProjection } = await import("../src/store/readable-rows.js");
const { searchPassages } = await import("../src/read/passages/search.js");
const { readSourcePage } = await import("../src/server/tools/read-page.js");

/** A ULID for this run's document: its time, then randomness, in Crockford's base 32. */
function ulid(now = Date.now()): string {
  const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  let time = "";
  for (let t = now, i = 0; i < 10; i += 1, t = Math.floor(t / 32)) time = alphabet[t % 32] + time;
  const bytes = randomBytes(16);
  let rest = "";
  for (let i = 0; i < 16; i += 1) rest += alphabet[(bytes[i] ?? 0) % 32];
  return time + rest;
}

let failures = 0;
const check = (ok: boolean, what: string, detail = ""): void => {
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${what}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
};

try {
  const [org] = await sql<{ id: string }[]>`select id::text as id from org where slug = 'default'`;
  if (!org) throw new Error("no 'default' workspace: load db/baseline.sql into the database first");
  const orgId = org.id;
  const principal = "engine-reader";
  const id = ulid();
  const text = `The Halden launch moved to March (run ${id}). Priya owns the rollout plan.`;
  const ev = {
    id,
    idempotencyKey: `smoke:${id}`,
    source: {
      connector: "smoke",
      workspace: "engine",
      container: "checks",
      nativeId: id,
      type: "document",
      title: "Launch plan",
    },
    record: { objectType: "doc", nativeId: id },
    kind: "file" as const,
    occurredAt: new Date().toISOString(),
    observedAt: new Date().toISOString(),
    actor: { sourceUserId: "maya", displayName: "Maya" },
    body: { text },
    permissions: { containerTuples: [], visibility: "container" as const },
  };

  console.log("\naccept, make readable, index");
  const accepted = await acceptOpen(sql, orgId, ev as never);
  check(accepted.status === "accepted", "acceptOpen accepts a content event");
  await sql.begin((trx) =>
    writeProjection(trx, orgId, sanitizeId(principal), [accepted.container]),
  );
  const [indexed] = await indexOpen(writes, orgId, [accepted.eventId]);
  if (!indexed) throw new Error("indexOpen answered nothing for the record");
  check(
    indexed.passages > 0,
    "indexOpen writes passages through the embedding sidecar",
    `${indexed.passages}`,
  );
  check(indexed.keyword !== "missed", "and the keyword entry is not missed", indexed.keyword);
  check(
    (await acceptOpen(sql, orgId, ev as never)).status === "duplicate",
    "a second accept is a duplicate",
  );
  check(
    (await indexOpen(writes, orgId, [accepted.eventId]))[0]?.passages === 0,
    "a second index writes nothing",
  );

  console.log("\nsearch and read, under the open resolver");
  const viewer = { orgId, principal };
  const found = await searchPassages(readContext, viewer as never, `Halden launch ${id}`, {
    mode: "hybrid",
    limit: 5,
  });
  check(
    found.hits.some((h) => h.recordId === accepted.eventId),
    "searchPassages finds the document",
    `${found.hits.length} hit(s), degraded ${JSON.stringify(found.degraded)}`,
  );
  const nobody = { orgId, principal: "nobody" };
  check(
    (
      await searchPassages(readContext, nobody as never, "Halden launch", {
        mode: "hybrid",
        limit: 5,
      })
    ).hits.length === 0,
    "a reader with no rows finds nothing",
  );
  const [doc] = await sql<{ source_id: string }[]>`
    select source_id from source_revision where event_id = ${accepted.eventId}`;
  const page = await readSourcePage(readContext, viewer as never, { id: String(doc?.source_id) });
  check("text" in page && page.text === text, "the read tool reads the document whole");
  check(
    "error" in (await readSourcePage(readContext, nobody as never, { id: String(doc?.source_id) })),
    "and a reader with no rows reads nothing",
  );
  check(grammarCalls === 0, "the grammar sidecar was never called", `${grammarCalls} call(s)`);
} catch (error) {
  failures += 1;
  console.error("  FAIL  threw:", error);
} finally {
  await sql.end({ timeout: 5 }).catch(() => {});
  grammar.close();
}
console.log(`\nverify-engine-stack: ${failures === 0 ? "PASS" : `${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);
