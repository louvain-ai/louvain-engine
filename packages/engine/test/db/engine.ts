import type { Engine as OpenedEngine } from "../../src/engine.js";
import type { Writes } from "../../src/ingest/writes.js";
import { type COLLECTIONS, NESTED, READERS } from "./corpus.js";
import { createBaselineDatabase } from "./database.js";
import { EVENTS } from "./events.js";
import { keywordIndexForTests } from "./keyword-index.js";
import { openTestEngine } from "./open-engine.js";
import { STAND_IN_CUTOFFS, standInReranker, startStandIns } from "./stand-ins.js";

/**
 * The engine as these tests see it: the only file here that names the engine's modules. A refactor that moves or
 * renames one changes this file, and nothing else; the cases and their recorded answers stay as they are, which is
 * what makes them a guard.
 *
 * `openEngine` builds the world every case reads: a database of its own from the baseline schema, the stand-in models,
 * the open build's engine over it (`open-engine.ts`), the corpus loaded through the open loader (the revision after it),
 * the two partial readers' projections, and settled tables. The environment is set before the engine's first import,
 * since its pool and settings read it once; a test that sets more of it does so in `prepare`.
 */
export type Reader = "everyone" | keyof typeof READERS;
export type Collection = (typeof COLLECTIONS)[number];
type Mode = "vector" | "keyword" | "hybrid";

/**
 * The tables rewritten whole and their statistics taken, so a plan depends on what the tables hold and never on when
 * a page was last pruned: the loader updates every row it indexes, and the dead rows it leaves move a planner's costs.
 */
export async function settle(sql: { unsafe: (text: string) => Promise<unknown> }) {
  await sql.unsafe("vacuum (full, analyze)");
}

/**
 * The engine's settings, and only these: every other one the shell carries is cleared, so a recording is the default
 * configuration's whoever runs it. The keyword index is the run's own (`keyword-index.ts`), as the open build requires
 * one, and the reranker is put in front only by the cases that ask for it.
 */
function settings(models: string) {
  for (const name of Object.keys(process.env))
    if (name.startsWith("LOUVAIN_")) delete process.env[name];
  process.env.LOUVAIN_EMBEDDINGS_URL = models;
}

/**
 * Runs the loader on the engine's writes: by default as it is; a test that listens to what the loader sends wraps it
 * (`sql-text.test.ts`), and one that loads more loads it after.
 */
type AroundLoad = (writes: Writes, loading: () => Promise<unknown>) => Promise<unknown>;

type Opening = {
  /** What a test sets in the environment before the engine is built: its keyword index, its embedder. */
  prepare?: () => Promise<void> | void;
  around?: AroundLoad;
  /**
   * The corpus: the golden one unless a test brings its own (`search-table.ts`), in which case the golden readers and
   * nesting are not written, since none of their collections exist.
   */
  events?: readonly (typeof EVENTS)[number][];
};

export async function openEngine(purpose: string, opening: Opening = {}) {
  const { prepare = () => {}, around = (_writes, loading) => loading(), events = EVENTS } = opening;
  const db = await createBaselineDatabase(purpose);
  const models = await startStandIns();
  const stop = async () => {
    await models.close();
    await db.drop();
  };
  // The keyword index the open build requires: a binding that tests its absence sets `LOUVAIN_BM25_URL` itself.
  // Without one (no Python with its binding here), the recorded answers, made with one, are what tells.
  const found = await keywordIndexForTests();
  if (typeof found === "string") console.warn(`engine tests: ${found}`);
  const index = typeof found === "string" ? { url: "", stop: () => {} } : found;
  try {
    settings(models.url);
    if (index.url) process.env.LOUVAIN_BM25_URL = index.url;
    await prepare();
    const opened = await openTestEngine();
    // The cursors a recording holds are sealed under this token, as the server keys its engine's from its own.
    const { hooksOf } = await import("../../src/read/hooks.js");
    hooksOf(opened.context).presentation.keyCursorsFrom?.("golden".repeat(11));
    const engine = await surface(await load(opened, around, events));
    const close = async () => {
      await engine.sql.end({ timeout: 5 });
      index.stop();
      await stop();
    };
    return { ...engine, close };
  } catch (err) {
    index.stop();
    await stop();
    throw err;
  }
}

/** The corpus through the open loader, the partial readers' projections, and settled tables. */
async function load(
  engine: OpenedEngine,
  around: AroundLoad,
  events: readonly (typeof EVENTS)[number][],
) {
  const golden = events === EVENTS;
  const { sql } = engine.store;
  const { containerId } = await import("../../src/store/ids.js");
  const { loadEvents } = await import("../load-events.js");
  const { workspaceIdOf } = await import("../../src/store/tenant.js");
  const { writeProjection } = await import("../../src/store/readable-rows.js");
  let loaded: Awaited<ReturnType<typeof loadEvents>> | undefined;
  await around(engine.writes, async () => {
    loaded = await loadEvents(engine.writes, events);
  });
  if (loaded?.accepted !== events.length) throw new Error(`load: ${JSON.stringify(loaded)}`);
  const orgId = await workspaceIdOf(sql);
  // Every container the load filed, by the collection it is (its last part): a folder's, or a drive's copy.
  const loadedContainers = (
    await sql<{ container: string }[]>`select distinct container from event_log`
  ).map((r) => r.container);
  for (const [reader, reads] of golden ? Object.entries(READERS) : []) {
    const readable: readonly string[] = reads;
    const containers = loadedContainers.filter((c) => readable.includes(c.split("/").at(-1) ?? ""));
    await sql.begin((trx) => writeProjection(trx, orgId, reader, containers));
  }
  // A collection filed inside another, as a source states it: what the open loader has no way to say.
  for (const [child, parent] of golden ? Object.entries(NESTED) : [])
    await sql`insert into container_parent (org_id, child, parent)
      values (${orgId}::uuid, ${containerId("http", "folder", child)}, ${containerId("http", "folder", parent)})`;
  await settle(sql);
  /** A document's key from any id the engine hands back: its source id, or a revision's event id (key and date). */
  const ids = new Map<string, string>();
  for (const row of await sql<{ id: string; key: string }[]>`
    select id, native_id as key from source_document`)
    ids.set(row.id, row.key);
  for (const e of events) ids.set(e.id, `${e.source.nativeId}@${e.occurredAt.slice(0, 10)}`);
  return { engine, sql, readContext: engine.context, orgId, ids };
}

/** The entry points the cases call, each as any reader. */
async function surface({ engine, sql, readContext, orgId, ids }: Awaited<ReturnType<typeof load>>) {
  const { containerId } = await import("../../src/store/ids.js");
  const { DEFAULT_READER } = await import("@louvain/engine-core");
  const { openTools } = await import("../../src/server/tools/run.js");
  const { shippedPlugins } = await import("../shipped-plugins.js");
  const { retrieverPool } = await import("../../src/search/pool.js");
  const { search } = await import("../../src/search/search.js");
  const { searchOrList } = await import("../../src/server/tools/search-apps.js");
  const { readSourcePage } = await import("../../src/server/tools/read-page.js");
  const { searchPassages } = await import("../../src/read/passages/search.js");
  const { lookupSource } = await import("../../src/server/tools/lookup.js");
  // The open build's plugins, as its entries start them: the search reads their retrievers.
  const plugins = await shippedPlugins();
  const runOpenTool = openTools({ ...engine, plugins })(DEFAULT_READER);
  // The same tools with the stand-in reranker configured, as engine.config.ts would name one, its cut-offs measured.
  const rerankingTool = openTools({
    ...engine,
    plugins: {
      ...plugins,
      list: (<K extends Parameters<typeof plugins.list>[0]>(kind: K) =>
        kind === "reranker"
          ? [{ name: "stand-in", plugin: { ...standInReranker, cutoffs: STAND_IN_CUTOFFS } }]
          : plugins.list(kind)) as typeof plugins.list,
    },
  })(DEFAULT_READER);
  const { settings } = engine;
  const pool = { pool: retrieverPool(plugins.list("retriever")), settings };
  const reranking = { pool: retrieverPool(plugins.list("retriever"), standInReranker), settings };
  const owner = (reader: Reader) => ({
    orgId,
    principal: reader === "everyone" ? DEFAULT_READER : reader,
  });
  /** Collections a call names, as the containers the engine knows them by; none named is every one readable. */
  const containers = (within?: readonly Collection[]) =>
    within?.map((c) => containerId("http", "folder", c));
  return {
    sql,
    writes: engine.writes,
    ids,
    pool,
    /** The read context every surface below reads on, for a test that builds its own pool. */
    readContext,
    /** Who a reader is, to the engine's own calls. */
    owner,
    /** The tool an agent calls, as the open build's one reader. */
    tool: (name: string, args: Record<string, unknown>) => runOpenTool(name, args),
    /** The same tool with the stand-in reranker configured. */
    rerankedTool: (name: string, args: Record<string, unknown>) => rerankingTool(name, args),
    /** The same search page, as any reader, in the collections named. */
    search: (reader: Reader, args: Record<string, unknown>, within?: readonly Collection[]) =>
      searchOrList(readContext, args, owner(reader), containers(within), pool),
    read: (reader: Reader, args: { id: string; version?: string }) =>
      readSourcePage(readContext, owner(reader), args),
    /** `louvain_lookup_source`'s page, as any reader. */
    lookup: (reader: Reader, args: Record<string, unknown>) =>
      lookupSource(readContext, owner(reader), args),
    /** A folder collection's container id, as a search's `container` names it. */
    container: (collection: Collection) => containerId("http", "folder", collection),
    /** One leg, or the two fused, as passages. */
    passages: (reader: Reader, query: string, mode: Mode, within?: readonly Collection[]) => {
      const narrowed = containers(within);
      const filters = narrowed ? { containers: narrowed } : {};
      return searchPassages(readContext, owner(reader), { query: query, mode, limit: 72, filters });
    },
    /** The documents the tool pages through (`search/search.ts`); `reranked` puts the stand-in reranker after the fusion. */
    documents: async (
      reader: Reader,
      query: string,
      reranked: boolean,
      within?: readonly Collection[],
    ) => {
      const narrowed = containers(within);
      return search(
        {
          context: readContext,
          reader: owner(reader),
          query,
          options: {
            limit: 24,
            ...(narrowed ? { narrow: { containers: narrowed } } : {}),
            recall: "full",
            rerank: true,
          },
        },
        reranked ? reranking : pool,
      );
    },
  };
}

export type Engine = Awaited<ReturnType<typeof openEngine>>;
