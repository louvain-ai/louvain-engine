import { fuse } from "@louvain/engine-core";
import type { WithIds } from "../ask/evidence.js";
import { joinLegRanks } from "../kg/read/leg-ranks.js";
import type { Pooled } from "./document.js";

/**
 * One page from the legs (`fuse`): a row two legs found outranks one only one found; ties keep the legs' order. The
 * row kept for a passage two retrievers found carries its place in both legs (`joinLegRanks`).
 */
export function fused(legs: readonly { leg: string; rows: readonly WithIds[] }[]): Pooled[] {
  const key = (evidence: WithIds) => `passage:${evidence.passageId ?? evidence.recordId}`;
  joinLegRanks(
    legs.flatMap((l) => l.rows),
    key,
  );
  return fuse(legs, key, { tieBreak: tieOrder }).map(({ row, score, legs }) => ({
    evidence: row,
    score,
    legs,
  }));
}

/**
 * A tie in fused score, on stable keys only, as one read of both legs broke it (`passageTieOrder`): the newer passage
 * first, then by record and place in the record, the passage id last.
 */
function tieOrder(a: WithIds, b: WithIds): number {
  const at = +new Date(b.occurredAt) - +new Date(a.occurredAt);
  if (at !== 0) return at;
  if (a.recordId !== b.recordId) return a.recordId < b.recordId ? -1 : 1;
  const place = (a.span?.start ?? 0) - (b.span?.start ?? 0);
  if (place !== 0) return place;
  return (a.passageId ?? "") < (b.passageId ?? "")
    ? -1
    : (a.passageId ?? "") > (b.passageId ?? "")
      ? 1
      : 0;
}
