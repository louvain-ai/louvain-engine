import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, test } from "node:test";
import {
  createEngine,
  embedderFor,
  keywordRetriever,
  openReading,
  openStore,
  settingsOf,
  storeSettings,
} from "@louvain/engine";
import { createPluginRegistry, defineEngine, type Host } from "@louvain/engine-core";
import postgres, { type Sql } from "postgres";
import { PermissionsUnavailable, pgRebac, ReaderNotProjected } from "../../src/index.js";
import { createDatabase, skipWithoutDatabase, type TestDatabase } from "./database.js";

/**
 * The resolver on pg_rebac's own SQL, its states made by pg_rebac's own writers (`rebac.project`,
 * `rebac.mark_unavailable`, `rebac.heartbeat`): a set with the engine's slashed containers, a reader of nothing, a
 * reader never asked, unavailable, a stale daemon, another `tenant`'s rows, and the same answers through the engine's
 * fence, where unavailable is a failed read and never an empty one.
 */
const HANDBOOK = "ingest/handbook/policies";
const PAYROLL = "ingest/payroll/2026";

describe("pgRebac on pg_rebac's SQL", { skip: skipWithoutDatabase }, () => {
  let db: TestDatabase;
  let sql: Sql;
  let org: string;
  const tenantOf = (orgId: string) => orgId;

  /** Writes a reader's projection as rebacd does: under the reader's lock, at no token. */
  const project = (t: string, principal: string, containers: string[]) =>
    sql.begin(async (tx) => {
      await tx`select rebac.lock_principal(${t}, ${principal})`;
      await tx`select rebac.project(${t}, ${principal}, ${containers}::text[], null)`;
    });

  before(async () => {
    db = await createDatabase();
    sql = postgres(db.url, { max: 2, onnotice: () => {} });
    const [row] = await sql<
      { id: string }[]
    >`select id::text as id from org where slug = 'default'`;
    org = row?.id ?? assert.fail("the engine's schema made no default org");
    await sql`select rebac.heartbeat()`;
    await project(org, "alice", [HANDBOOK, PAYROLL]);
    await project(org, "bob", []);
    await project("another-tenant", "carol", ["ingest/board/minutes"]);
    await sql`select rebac.mark_unavailable(${org}, 'carol', 'lookup_failed')`;
  });
  after(async () => {
    await sql?.end({ timeout: 5 });
    await db?.drop();
  });

  test("a reader's set is pg_rebac's, the engine's slashed containers whole", async () => {
    assert.deepEqual(
      await pgRebac(sql, { tenantOf }).readableSet("alice", org),
      [PAYROLL, HANDBOOK].sort(),
    );
  });

  test("a reader asked and granted nothing reads nothing", async () => {
    assert.deepEqual(await pgRebac(sql, { tenantOf }).readableSet("bob", org), []);
  });

  test("a reader pg_rebac cannot answer for is unavailable, whatever another pg_rebac namespace holds for that name", async () => {
    await assert.rejects(
      pgRebac(sql, { tenantOf }).readableSet("carol", org),
      PermissionsUnavailable,
    );
  });

  test("a reader never asked fails closed with no rebacd, and is read once rebacd has projected them", async () => {
    await assert.rejects(pgRebac(sql, { tenantOf }).readableSet("dave", org), ReaderNotProjected);
    const daemon = await standIn(async (body) => project(body.tenant, body.principal, [HANDBOOK]));
    try {
      const lookup = `http://127.0.0.1:${(daemon.address() as AddressInfo).port}`;
      assert.deepEqual(await pgRebac(sql, { tenantOf, lookup }).readableSet("dave", org), [
        HANDBOOK,
      ]);
    } finally {
      daemon.close();
    }
  });

  test("a daemon that stopped beating makes every read unavailable, until it beats again", async () => {
    await sql`update rebac.watch_state set heartbeat_at = now() - interval '1 hour'`;
    try {
      await assert.rejects(
        pgRebac(sql, { tenantOf }).readableSet("alice", org),
        PermissionsUnavailable,
      );
    } finally {
      await sql`select rebac.heartbeat()`;
    }
  });

  test("a set older than the freshness bound is renewed through rebacd, and is unavailable without it", async () => {
    await project(org, "frank", [HANDBOOK]);
    await sql`update rebac.principal_state set looked_up_at = now() - interval '2 hours' where principal = 'frank'`;
    await assert.rejects(
      pgRebac(sql, { tenantOf }).readableSet("frank", org),
      PermissionsUnavailable,
    );
    const daemon = await standIn(async (body) => project(body.tenant, body.principal, [HANDBOOK]));
    try {
      const lookup = `http://127.0.0.1:${(daemon.address() as AddressInfo).port}`;
      assert.deepEqual(await pgRebac(sql, { tenantOf, lookup }).readableSet("frank", org), [
        HANDBOOK,
      ]);
    } finally {
      daemon.close();
    }
  });

  test("through the engine's fence: a set reads, nothing reads nothing, and unavailable fails the read", async () => {
    const store = openStore(db.url, storeSettings);
    const host: Host = { readableSet: pgRebac(store.sql, { tenantOf }) };
    const engine = createEngine({
      store,
      embedder: embedderFor(host),
      plugins: await createPluginRegistry({ ...defineEngine({}), retriever: [keywordRetriever()] }),
      host,
      settings: settingsOf(undefined),
    });
    try {
      const reading = openReading(engine);
      await reading("alice").counts();
      await reading("bob").counts();
      await assert.rejects(reading("carol").counts(), PermissionsUnavailable);
      await assert.rejects(reading("erin").counts(), ReaderNotProjected);
    } finally {
      await engine.close();
    }
  });
});

/** A stand-in rebacd: `POST /lookup` runs `onLookup` with its body, then answers 200. */
async function standIn(
  onLookup: (body: { tenant: string; principal: string }) => Promise<void>,
): Promise<Server> {
  const server = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    await onLookup(JSON.parse(raw));
    res.writeHead(200, { "content-type": "application/json" }).end('{"containers":1}');
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  return server;
}
