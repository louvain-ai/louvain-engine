import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import { skipWithoutDatabase } from "./database.js";
import { type Engine, openEngine } from "./engine.js";
import { eventOf, inFolder } from "./events.js";

/**
 * The keyword index's document entries (`read/listing/keyword-documents.ts`), as the open build writes them: one per
 * document, its current revision's, replaced by a newer revision, written again from the revision a withdrawal leaves
 * current, and deleted with the document. Read from a stand-in index that keeps what it is sent, upserts and deletes
 * in order. Its own database and corpus, every document invented.
 */
const FIRST = { title: "Kiln schedule", date: "2026-02-02", text: "The kiln fires on Mondays." };
const SECOND = {
  title: "Kiln schedule",
  date: "2026-02-09",
  text: "The kiln fires on Mondays and Thursdays.",
};
const ALONE = { title: "Glaze stock", date: "2026-02-03", text: "Cobalt glaze is low." };
const EVENTS = [
  eventOf(inFolder("studio/kiln"), FIRST, 9701),
  eventOf(inFolder("studio/kiln"), SECOND, 9702),
  eventOf(inFolder("studio/glaze"), ALONE, 9703),
];

type Entry = { id: string; kind?: string; text: string; modified?: string; app?: string };
const held = new Map<string, Entry>();

async function bodyOf(req: IncomingMessage): Promise<{ docs?: Entry[]; ids?: string[] }> {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  return raw ? JSON.parse(raw) : {};
}

/** A keyword index that keeps what it is sent: `/index` upserts by id, `/delete` removes by id. */
function startIndex(): Promise<{ url: string; server: Server }> {
  const server = createServer((req, res) => {
    void bodyOf(req).then((body) => {
      if (req.url === "/index") for (const doc of body.docs ?? []) held.set(doc.id, doc);
      if (req.url === "/delete") for (const id of body.ids ?? []) held.delete(id);
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          indexed: body.docs?.length ?? 0,
          committed: true,
          deleted: 0,
          boot: "one",
        }),
      );
    });
  });
  return new Promise((done) =>
    server.listen(0, "127.0.0.1", () =>
      done({ url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, server }),
    ),
  );
}

const skip = skipWithoutDatabase;
let engine: Engine;
let index: { url: string; server: Server } | undefined;
before(async () => {
  if (skip) return;
  index = await startIndex();
  const url = index.url;
  engine = await openEngine("keyword-documents", {
    prepare: () => {
      process.env.LOUVAIN_BM25_URL = url;
    },
    events: EVENTS,
  });
});
after(async () => {
  await engine?.close();
  await new Promise((done) => index?.server.close(done));
});

const documentOf = async (key: string) =>
  (await engine.sql<{ id: string }[]>`select id from source_document where native_id = ${key}`)[0]
    ?.id ?? "";
const entryOf = async (key: string) => held.get(`doc:${await documentOf(key)}`);

async function withdraw(event: (typeof EVENTS)[number]) {
  const { withdrawOpen } = await import("../../src/ingest/withdraw.js");
  const { workspaceIdOf } = await import("../../src/store/tenant.js");
  return withdrawOpen(engine.writes, await workspaceIdOf(engine.sql), [
    { id: event.id, connector: "http", workspace: "folder", recordKey: null },
  ]);
}

test("each document has one entry, its current revision's, never a search hit's kind", {
  skip,
}, async () => {
  const kiln = await entryOf("studio/kiln");
  assert.equal(kiln?.kind, "document");
  assert.equal(kiln?.text, SECOND.text);
  assert.equal(kiln?.modified?.slice(0, 10), SECOND.date);
  assert.equal((await entryOf("studio/glaze"))?.text, ALONE.text);
  const documents = [...held.values()].filter((e) => e.kind === "document");
  assert.equal(documents.length, 2, documents.map((e) => e.id).join(", "));
  // Every record keeps its own entry beside them.
  for (const e of EVENTS) assert.equal(held.get(e.id)?.kind, undefined, e.id);
});

test("withdrawing the current revision writes the entry again from the one now current", {
  skip,
}, async () => {
  const done = await withdraw(EVENTS[1] as (typeof EVENTS)[number]);
  assert.equal(done.keywordMissed, 0);
  assert.equal((await entryOf("studio/kiln"))?.text, FIRST.text);
  assert.equal(held.has(EVENTS[1]?.id ?? ""), false);
});

test("withdrawing a document's last revision deletes its entry", { skip }, async () => {
  const id = await documentOf("studio/glaze");
  await withdraw(EVENTS[2] as (typeof EVENTS)[number]);
  assert.equal(held.has(`doc:${id}`), false);
  assert.equal(held.has(EVENTS[2]?.id ?? ""), false);
});
