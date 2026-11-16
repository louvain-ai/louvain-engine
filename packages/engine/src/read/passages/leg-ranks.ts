/**
 * Where a passage stood in each leg before the legs were fused (1 is first): a fact the passage read already has,
 * kept beside each hit it hands out rather than inside it, so no page that prints a hit changes shape. A document's
 * place in a leg is its best passage's there; a leg that did not find it has none.
 */
type LegRanks = { readonly vector?: number; readonly keyword?: number };

const placed = new WeakMap<object, LegRanks>();
/** The hits of a read of ONE leg (a retriever's), whose place joins the other retriever's for the same passage. */
const ofOneLeg = new WeakSet<object>();

/** Note each hit's places, from the legs as they were ranked: `hits[i]` was made from `fused[i]`'s row. */
export function noteLegRanks<R extends { id: string }>(
  legs: readonly { leg: "vector" | "keyword"; rows: readonly R[] }[],
  fused: readonly { row: R }[],
  hits: readonly object[],
): void {
  const at = new Map<string, { vector?: number; keyword?: number }>();
  for (const { leg, rows } of legs)
    rows.forEach((row, i) => {
      const ranks = at.get(row.id) ?? {};
      if (ranks[leg] === undefined) at.set(row.id, { ...ranks, [leg]: i + 1 });
    });
  hits.forEach((hit, i) => {
    const ranks = at.get(fused[i]?.row.id ?? "");
    if (ranks) placed.set(hit, ranks);
    if (legs.length === 1) ofOneLeg.add(hit);
  });
}

/**
 * The places of one passage that the one-leg reads handed out (the vector and keyword retrievers'), joined onto each
 * of those rows, so the row fusion keeps carries both legs' places, as one read of both legs noted them. A read of both
 * legs (a figures read) keeps its own.
 */
export function joinLegRanks<R extends object>(rows: readonly R[], key: (row: R) => string): void {
  const single = rows.filter((row) => ofOneLeg.has(row));
  const joined = new Map<string, LegRanks>();
  for (const row of single) {
    const ranks = placed.get(row);
    if (ranks) joined.set(key(row), { ...ranks, ...joined.get(key(row)) });
  }
  for (const row of single) {
    const ranks = joined.get(key(row));
    if (ranks) placed.set(row, ranks);
  }
}

/** Each document's best place in the keyword leg (`words`) and the vector leg (`meaning`), from the hits a search kept. */
export function documentRanks(
  hits: readonly { evidence: { recordId: string } }[],
): Map<string, { words: number | null; meaning: number | null }> {
  const best = new Map<string, { words: number | null; meaning: number | null }>();
  const lower = (a: number | null, b: number | undefined) =>
    b === undefined ? a : a === null ? b : Math.min(a, b);
  for (const { evidence } of hits) {
    const ranks = placed.get(evidence);
    if (!ranks) continue;
    const was = best.get(evidence.recordId) ?? { words: null, meaning: null };
    best.set(evidence.recordId, {
      words: lower(was.words, ranks.keyword),
      meaning: lower(was.meaning, ranks.vector),
    });
  }
  return best;
}
