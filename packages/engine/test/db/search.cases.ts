import type { Collection, Engine, Reader } from "./engine.js";
import { DEEP_FACT_LOST } from "./search.deep.cases.js";

type Mode = "vector" | "keyword" | "hybrid";

/**
 * What is asked of the engine (over invented content: every name, company and figure is made up). Each case is a call through one of the engine's real entry points over
 * the golden corpus (`corpus.ts`), named for what it asks. `search.golden.json` holds what each returns, and the
 * SQL snapshot test runs the same cases to see what each one sends.
 *
 * Most cases ask as the open build's own reader, who reads everything. The last group asks as a reader of part of the
 * corpus, and what those cases are shown is also held to that reader's collections (`partial`).
 */
export type Case = {
  name: string;
  run: (engine: Engine) => Promise<unknown>;
  /** A reader who reads only part of the corpus. */
  partial?: Exclude<Reader, "everyone">;
  /**
   * A known defect this case records as it stands. Its answer is pinned so a refactor cannot move it unseen, and is
   * wrong: the fix re-records it on purpose, and drops this.
   */
  defect?: string;
};

/**
 * The superseded revision is shown. The open loader's events carry no record, so a file's revisions have no record key
 * and the version rule (`read/passages/filter.ts`, `record_has_newer`) never retires the earlier one's passages, while the
 * source groups both revisions as one document. Asked for words only the earlier revision holds, the ranked page
 * shows the document with the earlier date and the earlier text as its excerpt, and nothing says it is not current.
 */
const SUPERSEDED_SHOWN: Case = {
  name: "a revised document's earlier words alone",
  run: (e) => e.tool("louvain_search_sources", { query: "home two", mode: "keyword", limit: 1 }),
  defect:
    "the ranked page shows a superseded revision (its date and its text) as the document's hit; see SUPERSEDED_SHOWN",
};

/**
 * An identifier typed joined. "FIN-2207" is held by the text search as "fin-2207", "fin" and "2207", never "fin2207", so
 * the keyword leg meets no word of "fin2207". The exact tier reads a key
 * typed joined as the key (`search-exact.ts`), so the document titled by it leads; a passage that only mentions the
 * key is still found by the keyword leg only as written, until the tokeniser joins it on both paths (the showpiece).
 */
const IDENTIFIER_JOINED: Case = {
  name: "an identifier typed joined",
  run: (e) => e.tool("louvain_search_sources", { query: "fin2207", limit: 3 }),
};

/**
 * A figure written another way, and inside a key, is found. "4,471" is the figure 4471 to the keyword index's analyzer (its
 * word-delimiter step, `analyzer-cases.json`), answered by the documents holding it (rule 6), and "PO-4471" is held as
 * `po`, `4471` and `po4471`.
 */
const FIGURE_SPLIT: Case = {
  name: "a figure written another way",
  run: (e) => e.tool("louvain_search_sources", { query: "4,471", limit: 3 }),
};

type Run = Case["run"];

const tool =
  (args: Record<string, unknown>): Run =>
  (e) =>
    e.tool("louvain_search_sources", args);

/** A call the tool refuses, recorded as its refusal: the message a caller is given, never a page. */
const refusalOf =
  (run: Run): Run =>
  async (e) => {
    try {
      return { answered: await run(e) };
    } catch (err) {
      if (err instanceof Error && err.name === "ToolInputError") return { refused: err.message };
      throw err;
    }
  };

const searchAs =
  (reader: Reader, args: Record<string, unknown>, within?: Collection[]): Run =>
  (e) =>
    e.search(reader, args, within);

/** Every page of one search, following each `nextCursor` until there is none. */
const everyPage =
  (reader: Reader, args: Record<string, unknown>, within?: Collection[]): Run =>
  async (e) => {
    const pages: { nextCursor?: string }[] = [];
    let cursor: string | undefined;
    do {
      const asked = { ...args, ...(cursor ? { cursor } : {}) };
      const page = (await e.search(reader, asked, within)) as { nextCursor?: string };
      pages.push(page);
      cursor = page.nextCursor;
    } while (cursor && pages.length < 20);
    return pages;
  };

/** A document opened by its key (or a version by its key and date), as `louvain_read_source` opens it. */
const readOf =
  (reader: Reader, key: string, version?: string): Run =>
  (e) => {
    const idOf = (k: string) => [...e.ids].find(([, named]) => named === k)?.[0] ?? k;
    return e.read(reader, { id: idOf(key), ...(version ? { version: idOf(version) } : {}) });
  };

/** The passages one leg (or both, fused) returns, each as `<record>#<seq> <legs>`, in order. */
const passagesOf =
  (reader: Reader, query: string, mode: Mode, within?: Collection[]): Run =>
  async (e) => {
    const found = await e.passages(reader, query, mode, within);
    return {
      hits: found.hits.map((h) => `${h.recordId}#${h.seq} ${h.legs.join("+")}`),
      degraded: found.degraded,
    };
  };

/** The documents the tool pages through, before paging, each with its excerpt: fused, or reranked. */
const documentsOf =
  (reader: Reader, query: string, reranked: boolean, within?: Collection[]): Run =>
  async (e) => {
    const found = await e.documents(reader, query, reranked, within);
    return {
      documents: found.documents.map((d) => `${d.summary.id} ${d.excerpt}`),
      hasMore: found.hasMore,
      degraded: found.degraded,
    };
  };

/** A second search that leaves out what the first one showed. */
const leavingOutTheFirst: Run = async (e) => {
  const first = (await e.tool("louvain_search_sources", { query: "budget", limit: 2 })) as {
    sources: { id: string }[];
  };
  const exclude = first.sources.map((s) => s.id);
  return e.tool("louvain_search_sources", { query: "budget", limit: 4, exclude });
};

const lookUp =
  (reader: Reader, identifier: string): Run =>
  (e) =>
    e.lookup(reader, { identifier });

/**
 * An identifier `length` characters long: what the lookup answers, or the sentence it refuses with. The identifier
 * itself is written back as its length, so the recording stays readable.
 */
const atLength =
  (length: number): Run =>
  async (e) => {
    const long = "x".repeat(length);
    const named = (v: unknown) => JSON.parse(JSON.stringify(v).replaceAll(long, `<${length} × x>`));
    try {
      return named(await e.lookup("everyone", { identifier: long }));
    } catch (err) {
      return { refused: err instanceof Error ? err.message : String(err) };
    }
  };

/** A container listed, every page, as `louvain_search_sources` lists one named by `container` with no query. */
const listing =
  (reader: Reader, collection: Collection, limit: number): Run =>
  (e) =>
    everyPage(reader, { query: "", container: e.container(collection), limit })(e);

/**
 * The lookup: an identifier a source IS (its path), a key a title opens with, one nothing is, and an identifier only a
 * hidden document holds, which a partial reader must get exactly as one that does not exist.
 */
const LOOKUPS: Case[] = [
  { name: "lookup: a source's path", run: lookUp("everyone", "finance/po-4471") },
  { name: "lookup: a key a title opens with", run: lookUp("everyone", "FIN-2207") },
  { name: "lookup: an identifier nothing is", run: lookUp("everyone", "ZZZ-404") },
  { name: "lookup: a whole title", run: lookUp("everyone", "supplier invoice approval") },
  {
    name: "lookup: a URL nothing is at",
    run: lookUp("everyone", "https://intranet.invalid/po/4471"),
  },
  { name: "lookup: the longest identifier taken", run: atLength(4096) },
  { name: "lookup: an identifier one past the longest", run: atLength(4097) },
  {
    name: "lookup by staff: a key only finance holds",
    run: lookUp("staff", "FIN-2207"),
    partial: "staff",
  },
  {
    name: "lookup by staff: a key only the board holds",
    run: lookUp("staff", "BRD-118"),
    partial: "staff",
  },
  {
    name: "lookup by staff: an identifier nothing is",
    run: lookUp("staff", "ZZZ-404"),
    partial: "staff",
  },
  {
    name: "lookup by finance: a key only the board holds",
    run: lookUp("finance", "BRD-118"),
    partial: "finance",
  },
  {
    name: "lookup by finance: an identifier nothing is",
    run: lookUp("finance", "ZZZ-404"),
    partial: "finance",
  },
];

/**
 * The container listing: a collection listed to its end, as each reader; and the reviewed leak, a collection filed
 * inside one the reader cannot read, which they may list and search but whose container is never named to them.
 */
const LISTINGS: Case[] = [
  { name: "listing: a collection, every page", run: listing("everyone", "finance", 2) },
  {
    name: "listing by staff: a collection, every page",
    run: listing("staff", "engineering", 2),
    partial: "staff",
  },
  {
    name: "listing by staff: inside a hidden collection",
    run: listing("staff", "board-shared", 2),
    partial: "staff",
  },
  {
    name: "listing by staff: a hidden collection",
    run: listing("staff", "board", 2),
    partial: "staff",
  },
  {
    name: "search by staff: inside a hidden collection",
    run: searchAs("staff", { query: "office move third floor" }),
    partial: "staff",
  },
  {
    name: "listing by finance: inside a hidden collection",
    run: listing("finance", "board-shared", 2),
    partial: "finance",
  },
];

const cases = (list: [string, Run][], partial?: Case["partial"]): Case[] =>
  list.map(([name, run]) => ({ name, run, ...(partial ? { partial } : {}) }));

export const CASES: Case[] = [
  ...cases([
    // The ranked page the tool returns.
    ["a plain question", tool({ query: "annual leave allowance" })],
    [
      "a question sharing no word with its answer",
      tool({ query: "automobile allowance", limit: 5 }),
    ],
    ["an exact code", tool({ query: "PO-4471", limit: 5 })],
    ["the keyword mode", tool({ query: "Q4 revenue", mode: "keyword", limit: 5 })],
    ["words two near-duplicates share", tool({ query: "expenses policy meals", limit: 5 })],
    [
      "words from inside a long document",
      tool({ query: "replication slot disk filled", limit: 3 }),
    ],
    ["a revised document's current words", tool({ query: "work from home three days", limit: 5 })],
    ["a revised document's earlier words", tool({ query: "home two days", mode: "keyword" })],
  ]),
  SUPERSEDED_SHOWN,
  DEEP_FACT_LOST,
  FIGURE_SPLIT,
  IDENTIFIER_JOINED,
  ...cases([
    [
      "a query and the person's question",
      // `question` is declared only while the deployment searches it: otherwise refused by name.
      refusalOf(tool({ query: "audit", question: "When do the auditors arrive?", limit: 5 })),
    ],
    ["a search leaving out what was shown", leavingOutTheFirst],
    // Dates.
    ["after a date", tool({ query: "budget", after: "2025-04-01" })],
    ["before a date", tool({ query: "budget", before: "2024-12-31", limit: 5 })],
    [
      "between two dates",
      tool({ query: "policy", after: "2024-03-01", before: "2024-09-30", limit: 5 }),
    ],
    // Paging.
    ["the ranked view, every page", everyPage("everyone", { query: "policy", limit: 4 })],
    ["a matched search paged to its end", everyPage("everyone", { query: "plan", limit: 3 })],
    // The list view.
    ["the list view", tool({ query: "budget", view: "list", limit: 10 })],
    [
      "the list view, every page",
      everyPage("everyone", { query: "budget", view: "list", limit: 2 }),
    ],
    [
      "the list view over a range nothing matches",
      tool({ query: "parental", view: "list", after: "2025-06-01" }),
    ],
    // Reading a document.
    ["reading a short document", readOf("everyone", "finance/po-4471")],
    ["reading a long document", readOf("everyone", "engineering/failover-incident")],
    ["reading a revised document", readOf("everyone", "handbook/remote-working")],
    [
      "reading an earlier version",
      readOf("everyone", "handbook/remote-working", "handbook/remote-working@2024-04-02"),
    ],
    // Below the tool: each leg, the two fused, and the documents fused and reranked.
    ["the vector leg", passagesOf("everyone", "car mileage insurance", "vector")],
    ["the keyword leg", passagesOf("everyone", "car mileage insurance", "keyword")],
    ["the two legs fused", passagesOf("everyone", "car mileage insurance", "hybrid")],
    ["the vector leg, by meaning", passagesOf("everyone", "automobile", "vector")],
    ["the keyword leg, on a code", passagesOf("everyone", "PO-4471", "keyword")],
    ["the documents, fused", documentsOf("everyone", "budget review", false)],
    ["the documents, reranked", documentsOf("everyone", "budget review", true)],
    ["long and short documents, reranked", documentsOf("everyone", "audit budget", true)],
    // Narrowing: to a collection, an app, a day.
    ["one collection", searchAs("everyone", { query: "budget", limit: 6 }, ["finance"])],
    [
      "one collection, the list view",
      searchAs("everyone", { query: "budget", view: "list" }, ["finance"]),
    ],
    ["one collection, the passages", passagesOf("everyone", "budget", "hybrid", ["finance"])],
    ["one collection, the documents", documentsOf("everyone", "budget", false, ["board"])],
    // The open tool declares no `app` (a folder load gives every file one connector): an app is refused by name, never
    // dropped into an unfiltered page, which is what it was before.
    ["an app", refusalOf(tool({ query: "budget", app: "http", limit: 5 }))],
    ["an app nothing is in", refusalOf(tool({ query: "budget", app: "chat", limit: 5 }))],
    ["as known on a day", tool({ query: "work from home days", asOf: "2025-01-01", limit: 5 })],
    // Relevance: a word in no document is answered "nothing matches", its nearest documents only loosely related;
    // a figure written with a separator matches the document that states it without one ("PO-4471").
    ["a word in no document", tool({ query: "highfield", limit: 5 })],
    // A search with nothing to look for is refused in a sentence, never answered with guesses by meaning.
    ["a search with no word and no figure", refusalOf(tool({ query: "?!", limit: 5 }))],
    // The scored configuration's stages.
    [
      "the scored stages: a question",
      tool({ query: "audit", question: "When do the auditors arrive?", limit: 5 }),
    ],
    ["the scored stages: a title", tool({ query: "payroll calendar", limit: 5 })],
    [
      "the scored stages: a dated search",
      tool({ query: "budget audit auditors ledger", after: "2025-01-01", limit: 5 }),
    ],
  ]),
  ...cases(
    [
      ["a reader's search for what only others read", searchAs("staff", { query: "budget" })],
      [
        "a reader's search for a word only a hidden document holds",
        searchAs("staff", { query: "Heron acquisition", limit: 5 }),
      ],
      [
        "a reader's list view, every page",
        everyPage("staff", { query: "", view: "list", after: "2024-01-01", limit: 6 }),
      ],
      ["a reader's documents, reranked", documentsOf("staff", "budget minutes", true)],
      ["a reader opening a hidden document", readOf("staff", "board/heron-acquisition")],
      [
        "a reader opening a document that does not exist",
        readOf("staff", "board/no-such-document"),
      ],
      [
        "a reader naming a collection they cannot read",
        searchAs("staff", { query: "budget" }, ["board"]),
      ],
      [
        "a reader naming one they read and one they cannot",
        searchAs("staff", { query: "budget", limit: 6 }, ["engineering", "board"]),
      ],
      [
        "a reader's list view of a collection they cannot read",
        searchAs("staff", { query: "", view: "list" }, ["board"]),
      ],
      [
        "a reader's passages in a collection they cannot read",
        passagesOf("staff", "budget", "hybrid", ["board"]),
      ],
      [
        "a reader's documents in a collection they cannot read",
        documentsOf("staff", "budget", false, ["board"]),
      ],
    ],
    "staff",
  ),
  ...cases(
    [
      [
        "a reader's keyword search for a hidden word",
        searchAs("finance", { query: "Heron", mode: "keyword" }),
      ],
      ["a reader's ranked view, every page", everyPage("finance", { query: "budget", limit: 4 })],
      ["a reader's vector leg", passagesOf("finance", "board budget", "vector")],
      ["a reader's keyword leg", passagesOf("finance", "board budget", "keyword")],
    ],
    "finance",
  ),
  ...LOOKUPS,
  ...LISTINGS,
];
