import { telemetryOf } from "../../host/given.js";
import { stage } from "../ask-deadline.js";
import { bounded } from "../bounded.js";
import { asPgVector } from "../embedding.js";
import type { ReadContext, Reader } from "../fence.js";
import { hooksOf } from "../hooks.js";
import { instantOf } from "../instant.js";
import { isStatementTimeout, VECTOR_LEG_SETTINGS } from "../legs.js";
import { queryIn } from "../vector-space.js";
import type { VectorSpace } from "../vector-space-types.js";
import { droppedCurrent } from "./dropped-current.sql.js";
import type { PassageLegRead, Row, WindowRead } from "./leg-types.js";
import { nearest } from "./nearest.sql.js";
import { nearestInWindow } from "./nearest-in-window.sql.js";
import type { PassageFilters } from "./types.js";
import type { VectorRead } from "./vector-legs.js";
import { windowSize } from "./window-size.sql.js";

/**
 * A dropped version that is current for this read is always told: a version superseded in its own container keeps its
 * passages and loses their vectors, so the keyword legs find it and the vector leg cannot rank it. The read then says
 * `vector:superseded` in `degraded`. Whether it is current is the reader's own rule (`droppedCurrent`). A probe that
 * times out tells, since it could not say otherwise, and never fails the search.
 */
async function supersededCurrent(
  context: ReadContext,
  fence: Reader,
  f: PassageFilters,
): Promise<boolean> {
  const { validAt, knownAt } = instantOf(f.asOf, "passages.search");
  const admitted = fence.admitted ?? [];
  try {
    const rows = await bounded(context, (q) =>
      droppedCurrent(q, {
        fence,
        filters: f,
        added: hooksOf(context).filters,
        validAt,
        knownAt,
        admitted,
      }),
    );
    return rows.length > 0;
  } catch (err) {
    if (!isStatementTimeout(err)) throw err;
    telemetryOf(context).count("read.superseded_probe_timeout", 1, {});
    return true;
  }
}

/**
 * The nearest passages as the scan ranked them, with only a run of exactly equal scores put in passage order: the scan
 * gives a tie no order of its own and a plan change flips it, which fusion would then read as a different rank
 * (`passages.ts` `byPassage`). Nothing else moves: under `relaxed_order` the scan's order is not strictly by score, and
 * re-sorting the page by score would change ranks beyond ties.
 */
async function vectorLeg(...args: Parameters<typeof nearestPassages>) {
  const rows = await nearestPassages(...args);
  return rows ? tiesInPassageOrder(rows) : rows;
}

/**
 * The vector leg, and beside it whether a version whose vectors were dropped is current for this read
 * (`supersededCurrent`): then `degraded` gains `vector:superseded`, and the keyword legs still find it.
 */
export async function vectorLegTold(...args: Parameters<typeof nearestPassages>) {
  const [context, { fence, filters: f, degraded }] = args;
  const [rows, outOfReach] = await Promise.all([
    vectorLeg(...args),
    supersededCurrent(context, fence, f),
  ]);
  if (outOfReach) degraded.push("vector:superseded");
  return rows;
}

type Tied = { id: string; event_id: string; seq: number; occurred_at: Date };

/**
 * The order of a tie, on stable keys only: the newer passage first, then by record and its place in the record, the
 * passage's own id last. Not by passage id first: a passage id is a random uuid, so a tie broken by it differs from
 * one database to the next. A record's id and a passage's `seq` are the source's. The vector leg's exact ties,
 * fusion's (`searchPassages`) and the lexical pass's SQL order all break the same way.
 */
export function passageTieOrder(a: Tied, b: Tied): number {
  const at = +new Date(b.occurred_at) - +new Date(a.occurred_at);
  if (at !== 0) return at;
  if (a.event_id !== b.event_id) return a.event_id < b.event_id ? -1 : 1;
  if (a.seq !== b.seq) return a.seq - b.seq;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Each run of adjacent rows with the same score, put in `passageTieOrder`; every other row keeps its place. */
export function tiesInPassageOrder<T extends Tied & { score?: number }>(rows: T[]): T[] {
  const out: T[] = [];
  for (let i = 0; i < rows.length; ) {
    let j = i + 1;
    while (j < rows.length && rows[j]?.score === rows[i]?.score) j++;
    out.push(...rows.slice(i, j).sort(passageTieOrder));
    i = j;
  }
  return out;
}

async function nearestPassages(
  context: ReadContext,
  leg: PassageLegRead & {
    space: VectorSpace;
    /** Set when a windowed read was scanned rather than read exactly. */
    window: WindowRead;
  },
): Promise<Row[] | null> {
  const { fence, query, filters: f, added, limit, space: chosen, degraded, window } = leg;
  let qv: string;
  let space = chosen;
  try {
    // The query's space comes back with it: a next sidecar that cannot answer flips the columns too (`queryIn`).
    const embedded = await queryIn(space, query, fence.orgId);
    qv = asPgVector(embedded.vector);
    space = embedded.space;
  } catch {
    // swallowed: an embedding lane that cannot answer costs the vector leg, never the search — the
    // keyword leg still carries it, the caller is told in `degraded`, and it is counted.
    telemetryOf(context).count("read.embed.unavailable", 1, { leg: "passage" });
    degraded.push("vector:embedding");
    return null;
  }
  // Timed as `read.vector` (the embedding above is `read.embed`).
  const read: VectorRead = { fence, filters: f, added, columns: space.columns, vector: qv, limit };
  const timed = (run: typeof nearest, tags: Record<string, string>) =>
    stage("read.vector", () => bounded(context, (q) => run(q, read), VECTOR_LEG_SETTINGS), tags);
  if (windowed(f) && (await windowPlan(context, { fence, filters: f, added }, space)) === "exact")
    return timed(nearestInWindow, { leg: "passage", window: "exact" });
  if (windowed(f)) window.scanned = true;
  return timed(nearest, { leg: "passage" });
}

/**
 * A date range is read exactly when it is small (`nearestInWindow`): the range is a predicate inside the index scan,
 * which stops at its scan bound with whatever it found. So a windowed read counts its passages first (`windowSize`),
 * and a larger range is scanned, which finds its page quickly, and the search reports `bounded`.
 *
 * The exact read costs about four pages a passage, since a vector is stored out of line: a range of 50,000 reads about
 * 206,000 pages, cheap on a local disk (0.43 s) and past the read timeout on a database that fetches a cold
 * workspace's pages over the network. So the bound is where the index stops costing recall. Measured on 768-dimension vectors at the deployment's proportions (150,000 passages in 2
 * collections, and 130,000 in 3,986), 20 queries a range, with `VECTOR_LEG_SETTINGS`: a range of up to about 5,000 is
 * planned exactly whichever read is asked (recall 1.0); from 10,000 to 100,000 the index's recall within the range
 * (0.76 to 0.80) is its recall with no range at all (0.763), and it never came back short. Random vectors are the
 * index's worst case, so these are floors. At 5,000 the exact read reads about 20,000 pages.
 */
const WINDOW_EXACT_PASSAGES = 5_000;

/** `LOUVAIN_PASSAGE_WINDOW_EXACT=off` is the kill switch, read per call: a windowed read is then the HNSW scan alone. */
function windowed(f: PassageFilters): boolean {
  if ((process.env.LOUVAIN_PASSAGE_WINDOW_EXACT ?? "").trim().toLowerCase() === "off") return false;
  return (f.window?.from ?? f.since) !== undefined || (f.window?.to ?? f.until) !== undefined;
}

async function windowPlan(
  context: ReadContext,
  leg: Pick<PassageLegRead, "fence" | "filters" | "added">,
  space: VectorSpace,
): Promise<"exact" | "scan"> {
  const { fence, filters: f, added } = leg;
  try {
    const [row] = await bounded(context, (q) =>
      windowSize(
        q,
        { fence, filters: f, added, columns: space.columns },
        WINDOW_EXACT_PASSAGES + 1,
      ),
    );
    return (row?.n ?? 0) <= WINDOW_EXACT_PASSAGES ? "exact" : "scan";
  } catch (err) {
    if (!isStatementTimeout(err)) throw err;
    // A count the read timeout cut is a range too large to read exactly, so it is scanned.
    telemetryOf(context).count("read.vector.window_plan_cut", 1, { leg: "passage" });
    return "scan";
  }
}
