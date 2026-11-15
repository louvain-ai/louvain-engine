import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { queryVectorFor, queryVectorWith, withQueryVectorMemo } from "../src/kg/read/question.js";
import { forgetRecentQueryVectors } from "../src/kg/read/recent-vectors.js";
import { openTestEngine } from "./db/open-engine.js";

/**
 * ONE EMBEDDING PER DISTINCT TEXT ACROSS CALLS, WITHIN A WORKSPACE, FOR A MINUTE (`kg/read/recent-vectors.ts`). An
 * agent's tool call has no memo scope: `louvain_search_sources` runs the answer path's legs beside the listing for the
 * same words, and its ranked head again on every page, so each leg asked the sidecar itself (two or three embeddings
 * a search, a second each). Legs started together now wait on one embedding, and a page asked
 * again embeds nothing; a failure or an empty vector is never kept; a vector is kept per LOADER (one model's never
 * stands in for another's) and per WORKSPACE (a hit is instant and a miss a second, so a shared one would tell one
 * workspace what another just searched). No model runs here: the other space's loader is injected, and the current space's
 * loader is the open build's embedder, which talks to a local stub.
 */
const ORG = "org-a";
const counting = () => {
  const calls: string[] = [];
  return {
    calls,
    load: async (text: string): Promise<number[]> => {
      calls.push(text);
      return [text.length];
    },
  };
};

test("outside any memo, legs that ask together and a page asked again embed the words once", async () => {
  forgetRecentQueryVectors();
  const other = counting();
  const together = await Promise.all([
    queryVectorWith("open renewals", other.load, ORG),
    queryVectorWith("open renewals", other.load, ORG),
    queryVectorWith("open renewals", other.load, ORG),
  ]);
  assert.deepEqual(together, ["[13]", "[13]", "[13]"]);
  assert.equal(await queryVectorWith("open renewals", other.load, ORG), "[13]", "the next page");
  assert.deepEqual(other.calls, ["open renewals"]);
  await queryVectorWith("other words", other.load, ORG);
  assert.deepEqual(other.calls, ["open renewals", "other words"]);
});

test("a vector is kept per workspace: another workspace's search of the same words is its own embedding", async () => {
  forgetRecentQueryVectors();
  const other = counting();
  await queryVectorWith("board deck", other.load, "org-a");
  await queryVectorWith("board deck", other.load, "org-b");
  await queryVectorWith("board deck", other.load, "org-a");
  assert.deepEqual(other.calls, ["board deck", "board deck"]);
  // A read that does not say its workspace shares nothing, as before.
  await queryVectorWith("board deck", other.load);
  assert.equal(other.calls.length, 3);
});

test("a vector is kept per loader: another model's embedding of the same words is its own", async () => {
  forgetRecentQueryVectors();
  const a = counting();
  const b = counting();
  await queryVectorWith("same words", a.load, ORG);
  await queryVectorWith("same words", b.load, ORG);
  assert.deepEqual(a.calls, ["same words"]);
  assert.deepEqual(b.calls, ["same words"]);
});

test("a failed embedding is not kept: every leg waiting on it sees the failure, the next call asks again", async () => {
  forgetRecentQueryVectors();
  let attempts = 0;
  const load = async (text: string): Promise<number[]> => {
    attempts += 1;
    if (attempts === 1) throw new Error("sidecar busy");
    return [text.length];
  };
  const [first, second] = await Promise.allSettled([
    queryVectorWith("q", load, ORG),
    queryVectorWith("q", load, ORG),
  ]);
  assert.equal(first.status, "rejected");
  assert.equal(second.status, "rejected");
  assert.equal(await queryVectorWith("q", load, ORG), "[1]");
  assert.equal(await queryVectorWith("q", load, ORG), "[1]");
  assert.equal(attempts, 2);
});

test("an empty vector is not kept", async () => {
  forgetRecentQueryVectors();
  let attempts = 0;
  const load = async (): Promise<number[]> => {
    attempts += 1;
    return attempts === 1 ? [] : [1];
  };
  assert.equal(await queryVectorWith("q", load, ORG), "[]");
  await Promise.resolve();
  assert.equal(await queryVectorWith("q", load, ORG), "[1]");
  assert.equal(attempts, 2);
});

test("a question's memo still memoises past the shared store, and finds what a call outside it embedded", async () => {
  forgetRecentQueryVectors();
  const other = counting();
  await queryVectorWith("handover notes", other.load, ORG);
  await withQueryVectorMemo(async () => {
    await queryVectorWith("handover notes", other.load, ORG);
    // Forgotten from the shared store mid-question (its 60 s, its 64 texts): the question's own memo still holds it.
    forgetRecentQueryVectors();
    await queryVectorWith("handover notes", other.load, ORG);
  });
  assert.deepEqual(other.calls, ["handover notes"]);
});

test("the current space's product embedder, outside any memo, asks the sidecar once for legs and pages alike", async () => {
  forgetRecentQueryVectors();
  const seen: string[] = [];
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => {
      body += c;
    });
    req.on("end", () => {
      const texts = (JSON.parse(body || "{}") as { texts?: string[] }).texts ?? [];
      seen.push(...texts);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ vectors: texts.map(() => Array.from({ length: 768 }, () => 0.5)) }));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const saved = process.env.LOUVAIN_EMBEDDINGS_URL;
  // Before the first embed: the open build's embedder reads its settings then, once.
  process.env.LOUVAIN_EMBEDDINGS_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  await openTestEngine();
  try {
    const legs = await Promise.all([
      queryVectorFor("quarterly churn", ORG),
      queryVectorFor("quarterly churn", ORG),
      queryVectorFor(" quarterly churn ", ORG),
    ]);
    assert.equal(new Set(legs).size, 1);
    await queryVectorFor("quarterly churn", ORG);
    assert.equal(seen.length, 1, "one sidecar request for three legs and a page");
    await queryVectorFor("quarterly churn", "org-b");
    assert.equal(seen.length, 2, "another workspace's search is its own request");
  } finally {
    if (saved === undefined) delete process.env.LOUVAIN_EMBEDDINGS_URL;
    else process.env.LOUVAIN_EMBEDDINGS_URL = saved;
    server.close();
    forgetRecentQueryVectors();
  }
});
