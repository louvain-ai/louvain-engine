import type {
  Candidate,
  FencedReading,
  ReadingScope,
  Reranker,
  Retrieved,
  RetrieverAsk,
  Started,
  Viewer,
} from "@louvain/engine-core";
import { attempt } from "../ask/degrade.js";
import type { WithIds } from "../ask/evidence.js";
import { fence, type ReadContext } from "../kg/read/fence.js";
import { passages } from "../kg/read/passages-api.js";
import { readableRecords } from "../kg/read/readable-records.js";
import { recordsAsPassages } from "../kg/read/records-as-passages.js";
import { telemetry } from "../telemetry.js";
import type { SearchOptions, SearchPool } from "./document.js";
import { fused } from "./fused.js";
import { stage } from "./stage.js";
import { withQuestion } from "./with-question.js";

/**
 * The search's pool: the configuration's retriever plugins, each handed a reading fenced to the search, every record
 * they return read again under that fence as the keyword index's hits are (`records-as-passages.ts`), then fused
 * (`fused.ts`) in their order. A record outside the search's scope is dropped and counted
 * (`search.retriever_foreign_dropped`). A search with no retriever configured is refused in one sentence. The
 * configuration's reranker, or `null`, travels with the pool.
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
    const reading = await fencedReading(context, viewer, opts);
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
 * A READING FENCED TO ONE SEARCH: the reader, the search's narrowing and its as-of, never the pool, and their
 * description (`scope`) for a retriever that asks an index of its own. A row it handed out is kept as handed (two legs
 * hand out the same passage with their own scores, so the row itself, not its id); any other a retriever returns is
 * its record, read again as the keyword index's hits are (`recordsAsPassages`). `recheck` then reads every
 * survivor's record under the fence, by id.
 */
async function fencedReading(context: ReadContext, viewer: Viewer, opts: SearchOptions) {
  const handed = new Set<Candidate>();
  const filters = { ...opts.narrow, ...(opts.asOf ? { asOf: opts.asOf } : {}) };
  const bounded = opts.recall === "bounded";
  const read: FencedReading = {
    scope: await scopeOf(context, viewer, opts),
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
      for (const hit of page.hits) handed.add(hit);
      return page;
    },
  };
  const recheck = async (named: readonly Named[]) => {
    const own = await ownRows(context, viewer, { named, handed, opts });
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

/** What the reading is narrowed to, as a retriever with an index of its own passes it on (`ReadingScope`). */
async function scopeOf(
  context: ReadContext,
  viewer: Viewer,
  opts: SearchOptions,
): Promise<ReadingScope> {
  const { containers, ...filters } = opts.narrow ?? {};
  const reader = await fence(context, viewer, containers);
  return {
    orgId: viewer.orgId,
    containers: reader ? [...reader.containers] : [],
    ...(opts.asOf ? { asOf: opts.asOf } : {}),
    filters,
  };
}

/**
 * Each leg's rows as the engine's own evidence: the passage the reading handed out, by its id, else the record read
 * again (`recordsAsPassages`); one neither gives is dropped and counted.
 */
async function ownRows(
  context: ReadContext,
  viewer: Viewer,
  { named, handed, opts }: { named: readonly Named[]; handed: Set<Candidate>; opts: SearchOptions },
) {
  const handedOf = (row: Candidate) => (handed.has(row) ? (row as WithIds) : undefined);
  const foreign = named.flatMap(({ got }) =>
    got.legs.flatMap((l) => l.rows.filter((row) => !handedOf(row)).map((row) => row.recordId)),
  );
  const reread = await recordsAsPassages(context, viewer, {
    recordIds: foreign,
    ...(opts.asOf ? { asOf: opts.asOf } : {}),
    ...(opts.narrow ? { narrow: opts.narrow } : {}),
  });
  return named.map(({ name, got }) => ({
    name,
    got,
    legs: got.legs.map((l) => ({
      leg: l.leg,
      rows: rowsOf(name, l.rows, (row) => handedOf(row) ?? reread.get(row.recordId)),
    })),
  }));
}

/** One passages read, timed. A read that fails is reported once and comes back with no hits, named by what it read. */
async function passagesRead(read: string, search: () => ReturnType<typeof passages.search>) {
  const staged = await stage("passages", () => attempt(`passages:${read}`, null, search));
  return staged.value ?? { hits: [], degraded: [...staged.degraded] };
}

/** A leg's rows as the engine's own evidence, in their order; any the engine cannot read is dropped and counted. */
function rowsOf(
  name: string,
  rows: readonly Candidate[],
  own: (row: Candidate) => WithIds | undefined,
) {
  const out = rows.flatMap((row) => {
    const evidence = own(row);
    return evidence ? [evidence] : [];
  });
  dropped(name, rows.length - out.length);
  return out;
}

function kept<T>(name: string, rows: readonly T[], keep: (row: T) => boolean): T[] {
  const out = rows.filter(keep);
  dropped(name, rows.length - out.length);
  return out;
}

const dropped = (retriever: string, n: number) => {
  if (n > 0) telemetry.count("search.retriever_foreign_dropped", n, { retriever });
};
