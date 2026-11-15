import assert from "node:assert/strict";
import { type ChildProcess, spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { skipWithoutDatabase } from "./database.js";
import { type Engine, openEngine } from "./engine.js";
import { eventOf, inFolder } from "./events.js";
import { freePort, keywordIndexForTests, noKeywordIndex } from "./keyword-index.js";

/**
 * THE SEARCH RESULTS TABLE: what a search returns, end to end, stated as data (`search-table/table.json`) over a fixed
 * invented corpus (`search-table/corpus.json`) and checked through the tool an agent calls, `louvain_search_sources`,
 * on a database of its own built from the baseline schema. A row is a query and what its page must hold; it is
 * `holds` (the engine does it, and a change that breaks it is red) or `pending` (a published rule the engine does
 * not meet yet: a pending row that starts to pass is red too, until it is promoted, so progress is never silent).
 *
 * A row runs on one stack (`stack`):
 * - `keyword-index` (the default): the keyword index (`apps/nlp/bm25.py`) running, as the open stack runs it;
 * - `keyword-index-down`: `LOUVAIN_BM25_URL` names a port nothing answers on, as when the index has stopped;
 * - `no-keyword-index`: `LOUVAIN_BM25_URL` unset, the keyword leg Postgres's own full-text search;
 * - `meaning`: a real embedding sidecar, named by `LOUVAIN_TEST_EMBEDDINGS_URL` (and `LOUVAIN_TEST_SIDECAR_TOKEN`).
 * Every other stack measures meaning with the stand-in embedder (`stand-ins.ts`), which has no recorded floor, so a
 * document matches by its words, keys and figures alone and meaning only orders the page.
 *
 * The keyword index is started here as every database test starts one (`keyword-index.ts`): a container of
 * `LOUVAIN_TEST_BM25_IMAGE`, as the exported CI builds it, else a Python that has its binding (`LOUVAIN_TEST_BM25_PYTHON`,
 * else `apps/nlp/.venv` in this checkout or one above). Or `LOUVAIN_TEST_BM25_URL` names one already running, which must be
 * EMPTY and this run's alone (a container started for it from `apps/nlp/Dockerfile.bm25`): the index answers by org
 * and folder, and another corpus in it would offer its own words as near words. Without one, or without a database, or without an embedding sidecar for the meaning rows, those rows
 * are skipped and the skip names why; `LOUVAIN_TEST_TABLE_REQUIRE=1` makes a missing keyword index a failure instead.
 * `LOUVAIN_TEST_TABLE_PRINT=1` prints each row's page, the way a new row's expectation is read off before it is written.
 */
export type Stack = "keyword-index" | "keyword-index-down" | "no-keyword-index" | "meaning";

export type Row = {
  query: string;
  /** Further arguments of the search call; `limit` defaults to 10. */
  args?: Record<string, unknown>;
  class: string;
  why: string;
  status: "holds" | "pending";
  /** A pending row: why the engine does not meet it, and which rule or ruling decides it. */
  pending?: { reason: string; rule: string };
  stack?: Stack;
  /** Documents that must be among the first `within` matches. */
  must?: { keys: string[]; within: number };
  /** With `must`: the matches are exactly those documents, no other. */
  only?: true;
  /** The document that must be the first match. */
  first?: string;
  /** Documents that must appear nowhere on the page, matched or loosely related. */
  mustNot?: string[];
  /** Documents that must not be among the matches (they may be listed as loosely related, which is not evidence). */
  notMatched?: string[];
  /** The page's note, exactly; `null` when the page must carry none. */
  note?: string | null;
  /** Nothing matches: no match, `matched: false`. */
  nothing?: true;
  /** The page's `corrected`, exactly: what each changed word was searched as. */
  corrected?: unknown[];
};

type Hit = { id: string };
type Page = {
  sources: Hit[];
  looselyRelated?: Hit[];
  matched?: boolean;
  note?: string | null;
  corrected?: unknown[] | null;
};

/** The settings this file reads, taken before the engine clears every `LOUVAIN_` setting (`engine.ts` `settings`). */
const ENV = {
  embeddings: process.env.LOUVAIN_TEST_EMBEDDINGS_URL,
  token: process.env.LOUVAIN_TEST_SIDECAR_TOKEN,
  require: process.env.LOUVAIN_TEST_TABLE_REQUIRE === "1",
  print: process.env.LOUVAIN_TEST_TABLE_PRINT === "1",
};

const here = dirname(fileURLToPath(import.meta.url));
const read = (name: string) => JSON.parse(readFileSync(join(here, "search-table", name), "utf8"));
export const CORPUS: { key: string; title: string; date: string; text: string }[] =
  read("corpus.json");
export const ROWS: Row[] = read("table.json").rows;

const EVENTS = CORPUS.map((d, i) => eventOf(inFolder(d.key), d, 20000 + i));

/** Why a stack cannot run here, or false when it can. */
function missing(stack: Stack): string | false {
  if (skipWithoutDatabase) return skipWithoutDatabase;
  if (stack === "meaning" && !ENV.embeddings)
    return "LOUVAIN_TEST_EMBEDDINGS_URL is not set: the meaning rows need a real embedding sidecar";
  const why = noKeywordIndex();
  if ((stack === "keyword-index" || stack === "meaning") && why) {
    if (ENV.require) throw new Error(why);
    return why;
  }
  return false;
}

/** What a page shows against what its row claims: the failures, one sentence each. */
export function judge(row: Row, matched: string[], loose: string[], page: Page): string[] {
  const wrong: string[] = [];
  if (row.must) {
    const head = matched.slice(0, row.must.within);
    for (const key of row.must.keys)
      if (!head.includes(key)) wrong.push(`${key} is not in the first ${row.must.within} matches`);
    if (row.only) {
      const extra = matched.filter((k) => !row.must?.keys.includes(k));
      if (extra.length > 0) wrong.push(`it also matches ${extra.join(", ")}`);
    }
  }
  if (row.first !== undefined && matched[0] !== row.first)
    wrong.push(`the first match is ${matched[0] ?? "nothing"}, not ${row.first}`);
  for (const key of row.mustNot ?? [])
    if (matched.includes(key) || loose.includes(key)) wrong.push(`${key} is on the page`);
  for (const key of row.notMatched ?? []) if (matched.includes(key)) wrong.push(`${key} matches`);
  if (row.note !== undefined && (page.note ?? null) !== row.note)
    wrong.push(`the note is ${JSON.stringify(page.note ?? null)}, not ${JSON.stringify(row.note)}`);
  if (row.corrected !== undefined && !isDeepStrictEqual(page.corrected ?? null, row.corrected))
    wrong.push(
      `corrected is ${JSON.stringify(page.corrected ?? null)}, not ${JSON.stringify(row.corrected)}`,
    );
  if (row.nothing && (matched.length > 0 || page.matched !== false))
    wrong.push(`it matches ${matched.join(", ") || "(matched is not false)"}`);
  return wrong;
}

/**
 * The rows of one stack, each a test: a holding row fails with what moved; a pending row fails only when it passes,
 * asking to be promoted. One line at the end counts them.
 */
export function runTable(stack: Stack) {
  const rows = ROWS.filter((r) => (r.stack ?? "keyword-index") === stack);
  const skip = missing(stack);
  const tally = { held: 0, broken: 0, pending: 0, promote: 0, skipped: skip ? rows.length : 0 };
  let engine: Engine;
  let index: { url: string; stop: () => void } | undefined;
  before(async () => {
    if (skip || rows.length === 0) return;
    if (stack === "keyword-index" || stack === "meaning") {
      const started = await keywordIndexForTests();
      if (typeof started === "string") throw new Error(started);
      index = started;
    }
    const down =
      stack === "keyword-index-down" ? `http://127.0.0.1:${await freePort()}` : undefined;
    const { embeddings, token } = ENV;
    engine = await openEngine(`table_${stack.replaceAll("-", "_")}`, {
      prepare: () => {
        if (index) process.env.LOUVAIN_BM25_URL = index.url;
        if (down) process.env.LOUVAIN_BM25_URL = down;
        if (stack === "no-keyword-index") delete process.env.LOUVAIN_BM25_URL;
        if (stack === "meaning" && embeddings) {
          process.env.LOUVAIN_EMBEDDINGS_URL = embeddings;
          if (token) process.env.LOUVAIN_SIDECAR_TOKEN = token;
        }
      },
      events: EVENTS,
    });
  });
  after(async () => {
    await engine?.close();
    index?.stop();
    console.log(
      `search table [${stack}]: ${rows.length} rows; ${tally.held} hold, ${tally.broken} broken, ` +
        `${tally.pending} pending, ${tally.promote} to promote, ${tally.skipped} skipped` +
        (skip ? ` (${skip})` : ""),
    );
  });

  for (const row of rows)
    test(`${row.status} ${row.class}: ${row.query}`, { skip }, async (t) => {
      const page = (await engine.tool("louvain_search_sources", {
        limit: 10,
        query: row.query,
        ...row.args,
      })) as Page;
      const keyOf = (h: Hit) => engine.ids.get(h.id) ?? h.id;
      const matched = page.sources.map(keyOf);
      const loose = (page.looselyRelated ?? []).map(keyOf);
      if (ENV.print)
        t.diagnostic(
          JSON.stringify({
            query: row.query,
            matched,
            loose,
            note: page.note ?? null,
            degraded: (page as { degraded?: unknown }).degraded ?? null,
          }),
        );
      const wrong = judge(row, matched, loose, page);
      if (row.status === "holds") {
        if (wrong.length > 0) tally.broken++;
        else tally.held++;
        assert.deepEqual(wrong, [], `"${row.query}" (${row.why})`);
        return;
      }
      if (wrong.length === 0) {
        tally.promote++;
        assert.fail(
          `promote this row: "${row.query}" now passes (${row.pending?.rule ?? "no rule named"}); set its status to holds`,
        );
      }
      tally.pending++;
      t.diagnostic(`pending (${row.pending?.rule}): ${wrong.join("; ")}`);
    });
}
