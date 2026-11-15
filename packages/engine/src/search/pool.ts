import type {
  Candidate,
  FencedReading,
  Reranker,
  Retrieved,
  RetrieverAsk,
  Started,
  Viewer,
} from "@louvain/engine-core";
import { attempt } from "../ask/degrade.js";
import type { WithIds } from "../ask/evidence.js";
import type { ReadContext } from "../kg/read/fence.js";
import { passages } from "../kg/read/passages-api.js";
import { readableRecords } from "../kg/read/readable-records.js";
import { telemetry } from "../telemetry.js";
import type { SearchOptions, SearchPool } from "./document.js";
import { fused } from "./fused.js";
import { stage } from "./stage.js";
import { withQuestion } from "./with-question.js";

/**
 * THE OPEN SEARCH'S POOL: the configuration's retriever plugins, each handed a reading fenced to the search, every row
 * they return re-checked against that fence by id, then fused (`fused.ts`) in their order. A row the reading did not
 * hand out, or one outside the search's scope, is dropped and counted (`search.retriever_foreign_dropped`).
 *
 * The shipped retrievers (`plugins/retriever-*`) are the legs the answer path's `candidates()` reads for a query with
 * no plan, at the same depth and in the same fusion, so the open page is the answer path's page. A search with no
 * retriever configured is refused in one sentence. The configuration's reranker, or `null`, travels with the pool.
 */
export function retrieverPool(
  retrievers: readonly Started<"retriever">[],
  reranker: Reranker | null = null,
): SearchPool {
  if (retrievers.length === 0)
    throw new Error(
      "No retriever is configured, so nothing can be searched: list at least one in engine.config.ts.",
    );
  const pool: SearchPool = async (context, viewer, query, question, depth, opts) => {
    const reading = fencedReading(context, viewer, opts);
    const read = async (q: string) => {
      const mode = opts.mode ?? "hybrid";
      const ask: RetrieverAsk = { query: q, limit: depth, mode, bounded: reading.bounded };
      const first = await legsOf(retrievers, (r) => r.candidates(ask, reading.read));
      const kept = await reading.recheck(first);
      const found = fused(kept.legs);
      const after = retrievers.filter(({ plugin }) => plugin.after);
      if (after.length === 0) return { found, degraded: kept.degraded };
      const page = found.map((f) => f.evidence);
      const more = await reading.recheck(
        await legsOf(after, (r) => r.after?.(ask, reading.read, page) ?? none()),
      );
      return {
        found: fused([...kept.legs, ...more.legs]),
        degraded: [...kept.degraded, ...more.degraded],
      };
    };
    return withQuestion(
      await Promise.all([read(query), ...(question === null ? [] : [read(question)])]),
    );
  };
  return Object.assign(pool, { reranker });
}

type Named = { name: string; got: Retrieved };
const none = async (): Promise<Retrieved> => ({ legs: [], degraded: [] });

/** Each retriever's legs, read together, in the configuration's order. */
const legsOf = (
  retrievers: readonly Started<"retriever">[],
  call: (r: Started<"retriever">["plugin"]) => Promise<Retrieved>,
): Promise<Named[]> =>
  Promise.all(retrievers.map(async ({ name, plugin }) => ({ name, got: await call(plugin) })));

/**
 * A READING FENCED TO ONE SEARCH: the reader, the search's narrowing and its as-of, never the pool. It remembers every
 * row it hands out, so what a retriever returns is kept only when this reading produced it, and `recheck` then reads
 * the survivors' records again under the search's fence, by id.
 */
function fencedReading(context: ReadContext, viewer: Viewer, opts: SearchOptions) {
  const handed = new Map<Candidate, WithIds>();
  const filters = { ...opts.narrow, ...(opts.asOf ? { asOf: opts.asOf } : {}) };
  const bounded = opts.recall === "bounded";
  const read: FencedReading = {
    passages: async (q, how) => {
      const page = await passagesRead(how.digits ? "digits" : how.mode, () =>
        passages.search(context, viewer, q, {
          mode: how.mode,
          filters: how.digits ? { ...filters, digits: true } : filters,
          limit: how.limit,
          ...(how.digits ? {} : { bounded }),
          ...(opts.embedder ? { embedder: opts.embedder } : {}),
        }),
      );
      for (const hit of page.hits) handed.set(hit, hit);
      return page;
    },
  };
  const recheck = async (named: readonly Named[]) => {
    const own = named.map(({ name, got }) => ({
      name,
      got,
      legs: got.legs.map((l) => ({ leg: l.leg, rows: rowsOf(name, l.rows, handed) })),
    }));
    const ids = own.flatMap((n) => n.legs.flatMap((l) => l.rows.map((row) => row.recordId)));
    const containers = opts.narrow?.containers;
    const readable = await readableRecords(context, viewer, { recordIds: ids, containers });
    return {
      legs: own.flatMap(({ name, legs }) =>
        legs.map((l) => ({
          leg: l.leg,
          rows: kept(name, l.rows, (row) => readable.has(row.recordId)),
        })),
      ),
      degraded: own.flatMap(({ got }) => [...got.degraded]),
    };
  };
  return { read, recheck, bounded };
}

/** One passages read, timed. A read that fails is reported once and comes back with no hits, named by what it read. */
async function passagesRead(read: string, search: () => ReturnType<typeof passages.search>) {
  const staged = await stage("passages", () => attempt(`passages:${read}`, null, search));
  return staged.value ?? { hits: [], degraded: [...staged.degraded] };
}

/** The rows of a leg this reading handed out, as the engine's own; any other is dropped and counted. */
function rowsOf(name: string, rows: readonly Candidate[], handed: Map<Candidate, WithIds>) {
  const own = rows.flatMap((row) => {
    const evidence = handed.get(row);
    return evidence ? [evidence] : [];
  });
  dropped(name, rows.length - own.length);
  return own;
}

function kept<T>(name: string, rows: readonly T[], keep: (row: T) => boolean): T[] {
  const out = rows.filter(keep);
  dropped(name, rows.length - out.length);
  return out;
}

const dropped = (retriever: string, n: number) => {
  if (n > 0) telemetry.count("search.retriever_foreign_dropped", n, { retriever });
};
