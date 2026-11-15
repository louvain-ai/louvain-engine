import { fuse } from "@louvain/engine-core";
import { rowKeyOf } from "../ask/evidence.js";
import type { Pooled } from "./document.js";

/**
 * The query's pool alone, or with the question's: fused by reciprocal rank on the row's key, so a passage both found
 * ranks above one only one found, each row keeping the legs that found it in EITHER read (a statement either search
 * found still votes). Each read degrades on its own, and both degradations are reported.
 */
export function withQuestion(pools: readonly { found: Pooled[]; degraded: string[] }[]): {
  found: Pooled[];
  degraded: string[];
} {
  const [byQuery, byQuestion] = pools;
  if (!byQuery) return { found: [], degraded: [] };
  if (!byQuestion) return byQuery;
  const key = (hit: Pooled) => rowKeyOf(hit.evidence);
  const merged = fuse(
    [
      { leg: "query", rows: byQuery.found },
      { leg: "question", rows: byQuestion.found },
    ],
    key,
  );
  const legsOf = new Map<string, Set<string>>();
  for (const hit of [...byQuery.found, ...byQuestion.found])
    legsOf.set(key(hit), new Set([...(legsOf.get(key(hit)) ?? []), ...hit.legs]));
  return {
    found: merged.map((f) => ({
      ...f.row,
      score: f.score,
      legs: [...(legsOf.get(key(f.row)) ?? f.row.legs)],
    })),
    degraded: [...new Set([...byQuery.degraded, ...byQuestion.degraded])],
  };
}
