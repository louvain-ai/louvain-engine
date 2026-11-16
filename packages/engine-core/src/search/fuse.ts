/**
 * FUSION: several ranked lists into one page. By default RECIPROCAL RANK: a row scores `weight / (k + rank)` in every
 * list that found it, summed; each list is ranked within ITSELF (a leg cut by its timeout is simply empty). `k = 60`
 * damps the curve; a weight (1 by default) scales one leg, as the `weight` of Elasticsearch's `rrf` retriever does.
 * A list's `ranks` are its rows' places as the leg ranked them: a cap removes rows and re-ranks none.
 */
export const RRF_K = 60;
export type FuseList<T> = { leg: string; rows: readonly T[]; ranks?: readonly number[] };
export type Fused<T> = { row: T; score: number; legs: string[] };
// `penalty` pushes a row down by whole ranks in its list. `tieBreak` orders equal scores, else the lists' order
// stands: pass one wherever that order is not deterministic (two vectors at one distance, in either order).
type Rrf<T> = {
  method?: "rrf";
  k?: number;
  weights?: Readonly<Record<string, number>>;
  penalty?: (row: T) => number;
};
// CONVEX: each list's scores min-max scaled to [0, 1] (all equal: 1), `alpha` × the "vector" list + (1 − alpha) ×
// each other, a row a list lacks 0 there: Weaviate's relativeScoreFusion, Elasticsearch's linear retriever with
// `minmax`; it beats reciprocal rank in Bruch, Gai and Ingber 2023. `alpha` 0.75 is Weaviate's published default.
type Convex<T> = { method: "convex"; alpha?: number; scoreOf: (row: T) => number };
export type FuseOptions<T> = (Rrf<T> | Convex<T>) & { tieBreak?: (a: T, b: T) => number };
export function fuse<T>(
  lists: readonly FuseList<T>[],
  keyOf: (row: T) => string,
  options: FuseOptions<T> = {},
): Fused<T>[] {
  const out = new Map<string, Fused<T>>();
  for (const list of lists) {
    const share = shareOf(list, options);
    list.rows.forEach((row, i) => {
      const key = keyOf(row);
      const hit = out.get(key) ?? { row, score: 0, legs: [] };
      hit.score += share(row, i);
      if (!hit.legs.includes(list.leg)) hit.legs.push(list.leg);
      out.set(key, hit);
    });
  }
  const { tieBreak } = options;
  return [...out.values()].sort(
    (a, b) => b.score - a.score || (tieBreak ? tieBreak(a.row, b.row) : 0),
  );
}

/** What a row at place `i` of `list` adds to its score, by the method. */
function shareOf<T>(list: FuseList<T>, o: FuseOptions<T>): (row: T, i: number) => number {
  if (o.method === "convex") {
    const scores = list.rows.map(o.scoreOf);
    const [min, max] = [Math.min(...scores), Math.max(...scores)];
    const weight = list.leg === "vector" ? (o.alpha ?? 0.75) : 1 - (o.alpha ?? 0.75);
    return (_, i) => weight * (max === min ? 1 : ((scores[i] ?? min) - min) / (max - min));
  }
  const { k = RRF_K, weights = {}, penalty } = o;
  return (row, i) =>
    (weights[list.leg] ?? 1) / (k + (list.ranks?.[i] ?? i + 1) + (penalty ? penalty(row) : 0));
}
