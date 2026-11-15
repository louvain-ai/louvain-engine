import { createHash } from "node:crypto";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * THE MODELS, STOOD IN FOR: an embedding sidecar and a reranker that answer the engine's own wire protocols over HTTP
 * on the loopback address, so the real loader and the real search call them exactly as they call the services, and
 * every answer is a pure function of the text.
 *
 * The embedder is a bag of words: each word of three letters or more adds 1 and 0.5 to two dimensions its hash picks.
 * Texts that share words are near; texts that share none are orthogonal. Its vectors are left UNNORMALISED: every
 * component is a small multiple of 0.5, so every dot product and length Postgres sums is exact in any order, and two
 * passages tied in meaning are tied on every machine and broken by the engine's own tie order. A few words share a
 * meaning (`SAME_MEANING`): the stand-in's whole idea of semantics, and what lets a document be found by meaning and
 * not by its words. Words that carry no meaning (`EMPTY`) are left out, the embedder's query instruction among them, so
 * a query is near what shares its subject rather than its grammar.
 *
 * Its tokeniser (`/count`) is cruder still: a piece for every four characters of a word, plus the two markers every
 * text carries. A word of seventeen characters or more (a GUID, "ibobsonosoino78h9") is then five pieces or more, as
 * the real tokeniser splits a string it does not know; every word a golden case searches is shorter.
 *
 * The reranker scores a document by the query words it holds, divided by the square root of its length, and answers
 * best first, as the sidecar does: short and on-topic rises, long and diffuse sinks, which reorders the fused list in
 * a way a test can predict.
 */
const DIMENSIONS = 768;

const SAME_MEANING: Record<string, string> = {
  automobile: "car",
  vehicle: "car",
  van: "car",
  cash: "money",
  funds: "money",
  budget: "money",
  physician: "doctor",
  clinic: "doctor",
};

const EMPTY = new Set(
  [
    "the and for this that with are was from its our your you any all each every not but has have may must can",
    "into than then them they who what when where which how represent sentence searching relevant passages",
  ]
    .join(" ")
    .split(" "),
);

const wordsOf = (text: string): string[] =>
  text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3 && !EMPTY.has(w))
    .map((w) => SAME_MEANING[w] ?? w);

const hashOf = (s: string) => createHash("sha256").update(s).digest();

export function vectorOf(text: string): number[] {
  const v = new Array<number>(DIMENSIONS).fill(0);
  for (const word of wordsOf(text)) {
    const h = hashOf(word);
    const a = 2 + (h.readUInt16BE(0) % (DIMENSIONS - 2));
    const b = 2 + (h.readUInt16BE(2) % (DIMENSIONS - 2));
    v[a] = (v[a] ?? 0) + 1;
    v[b] = (v[b] ?? 0) + 0.5;
  }
  // Two small dimensions every text has: one the same for all, one its own. Texts that share no word are then not all
  // exactly as far from a query, so no page is cut between equals, where the order would be the index's to choose.
  // Both are smaller than one shared word, and every value is a multiple of 1/8, so the arithmetic stays exact.
  v[0] = 0.5;
  v[1] = (1 + (hashOf(text).readUInt8(0) % 4)) / 8;
  return v;
}

/**
 * The stand-in reranker's cut-off, as a shipped model's is measured: a text holding none of the search's words scores
 * exactly 0.5 (the logistic of 0), under it; one holding a word scores above it.
 */
export const STAND_IN_CUTOFFS = { matched: 0.52 };

/** The stand-in reranker as the engine's plugins are: each text's score squashed into [0, 1], in the order asked. */
export const standInReranker = {
  model: "stand-in",
  rerank: async ({ query, texts }: { query: string; texts: readonly string[] }) => ({
    ok: true as const,
    scores: texts.map((t) => 1 / (1 + Math.exp(-rerankScore(query, t)))),
  }),
};

/** The stand-in tokeniser's count: the two markers, and a piece for every four characters of each word. */
const piecesOf = (text: string): number =>
  2 + text.split(/\s+/).reduce((n, w) => n + Math.ceil(w.length / 4), 0);

export function rerankScore(query: string, text: string): number {
  const asked = new Set(wordsOf(query));
  const words = wordsOf(text);
  const held = new Set(words.filter((w) => asked.has(w))).size;
  return held / Math.sqrt(Math.max(1, words.length));
}

async function bodyOf(req: IncomingMessage): Promise<Record<string, unknown>> {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  return raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
}

function answer(req: IncomingMessage, body: Record<string, unknown>): unknown {
  if (req.url === "/embed")
    return { vectors: ((body.texts as string[] | undefined) ?? []).map(vectorOf) };
  if (req.url === "/count")
    return { counts: ((body.texts as string[] | undefined) ?? []).map(piecesOf) };
  if (req.url === "/rerank") {
    const query = String(body.query ?? "");
    const documents = (body.documents as { id: string; text: string }[] | undefined) ?? [];
    const scored = documents.map((d) => ({ id: d.id, score: rerankScore(query, d.text) }));
    // Best first; a tie keeps the order it was sent in.
    return { results: scored.sort((a, b) => b.score - a.score) };
  }
  return null;
}

export type StandIns = { url: string; close: () => Promise<void> };

/** Both stand-ins on one loopback port: `/embed` and `/rerank`. Health probes get 404, which the engine reads as "unknown". */
export async function startStandIns(): Promise<StandIns> {
  const server: Server = createServer((req, res) => {
    bodyOf(req)
      .then((body) => {
        const reply = req.method === "POST" ? answer(req, body) : null;
        res.statusCode = reply === null ? 404 : 200;
        res.setHeader("content-type", "application/json");
        res.end(reply === null ? "" : JSON.stringify(reply));
      })
      .catch(() => {
        res.statusCode = 400;
        res.end();
      });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
