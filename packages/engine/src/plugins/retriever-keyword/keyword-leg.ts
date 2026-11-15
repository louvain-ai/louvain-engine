import { bm25Configured } from "../../kg/read/bm25.js";
import type { ReadContext } from "../../kg/read/fence.js";
import { hooksOf } from "../../kg/read/hooks.js";
import type { KeywordLegRead, Row } from "../../kg/read/passages-types.js";
import { stage } from "../../kg/read/question.js";
import { sayOnce } from "../../observability/logging.js";
import { type Tags, telemetry } from "../../telemetry.js";
import { bm25Narrowing, bm25Rows } from "./bm25-rows.js";

/**
 * THE KEYWORD LEG: the keyword index first, where it can carry the read's filters (`bm25Narrowing`); otherwise, or when
 * it cannot answer, the passes the build binds (`keyword-index.ts`). Its rows, and what it could not do (`degraded`),
 * returned beside them.
 */
export async function keywordLeg(
  context: ReadContext,
  leg: KeywordLegRead,
): Promise<{ rows: Row[]; degraded: string[] }> {
  // The sidecar narrows only by what it indexes (`bm25Narrowing`): any other filter goes to the Postgres legs, which
  // carry it in their predicate rather than paging over hits the filter then discards.
  const index = hooksOf(context).keyword;
  const narrowing = bm25Configured() ? bm25Narrowing(index, leg.filters) : null;
  if (narrowing) {
    const viaBm25 = await indexRows(context, leg, narrowing);
    if (viaBm25) return { rows: leg.decay ? leg.decay(viaBm25) : viaBm25, degraded: [] };
  }
  // Here with a narrowing, the index did not answer.
  const degraded = narrowing ? ["keyword:bm25"] : [];
  if (index.passes) return { rows: await index.passes(context, leg), degraded };
  // A build that requires its index: no second matcher answers in its place.
  const down = narrowing !== null || !bm25Configured();
  sayOnce(
    down
      ? "the keyword index did not answer; searches find by meaning alone until it does: ./engine logs bm25"
      : "a search filter the keyword index does not carry (figures, knowledge time, a record filter) finds by meaning alone",
  );
  return { rows: [], degraded: [...degraded, down ? "keyword:index" : "keyword:filter"] };
}

/**
 * The keyword index's rows, or null when it did not answer. Timed as `ask.bm25` {up}: the sidecar being down is
 * reported, not thrown, so the stage encloses the catch and settles with `up: "no"`.
 */
async function indexRows(
  context: ReadContext,
  { fence, query, limit, filters }: KeywordLegRead,
  narrowing: NonNullable<ReturnType<typeof bm25Narrowing>>,
): Promise<Row[] | null> {
  const tags: Tags = { up: "yes" };
  return stage(
    "ask.bm25",
    async (): Promise<Row[] | null> => {
      try {
        return await bm25Rows(context, fence, query, limit, filters.asOf, narrowing);
      } catch {
        // swallowed: the sidecar being down or late costs this leg its ranking — the build's passes answer under
        // the same fence, or none do — and the leg names it in what it returns (`keyword:bm25`).
        telemetry.count("kg.read.passages.bm25_fallback", 1, {});
        tags.up = "no";
        return null;
      }
    },
    tags,
  );
}
