import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { embedSlice } from "../src/ingest/embed.js";
import { openPassageRules } from "../src/ingest/passage-rules.js";
import { openTestEngine } from "./db/open-engine.js";

/**
 * ONE EMBEDDING PER CHUNK IN THE OPEN BUILD (`PassageRules.contextVector`, null in `openPassageRules`). Its vector leg
 * ranks by the bare vector alone, so a chunk's context is written as text (the keyword header, `search_ctx`) and never
 * embedded: N chunks with contexts send N texts to the embedder, not 2N, and no row carries a context vector. No model
 * runs: the open build's embedder talks to a local stub that counts what it is sent.
 */
test("N chunks with contexts send N texts, and none carries a context vector", async () => {
  const sent: string[] = [];
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => {
      body += c;
    });
    req.on("end", () => {
      const texts = (JSON.parse(body || "{}") as { texts?: string[] }).texts ?? [];
      sent.push(...texts);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ vectors: texts.map(() => Array(768).fill(0.036)) }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const saved = process.env.LOUVAIN_EMBEDDINGS_URL;
  process.env.LOUVAIN_EMBEDDINGS_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  await openTestEngine();
  try {
    const pieces = [
      { body: "The lease renews in March.", seq: 0 },
      { body: "Rent rises by three percent.", seq: 1 },
      { body: "Notice is due sixty days before.", seq: 2 },
    ];
    const planned = pieces.map(({ body }) => ({
      context: "Harbour Street lease",
      key: "k",
      embedText: `Harbour Street lease\n\n${body}`,
    }));
    const rows = await embedSlice(openPassageRules, pieces, planned);
    assert.deepEqual(
      sent,
      pieces.map((p) => p.body),
      "the bare chunks alone",
    );
    assert.deepEqual(
      rows.map((r) => [r.c?.context ?? null, r.contextVector]),
      pieces.map(() => ["Harbour Street lease", null]),
      "each row keeps its context as text, with no vector",
    );
  } finally {
    if (saved === undefined) delete process.env.LOUVAIN_EMBEDDINGS_URL;
    else process.env.LOUVAIN_EMBEDDINGS_URL = saved;
    server.close();
  }
});
