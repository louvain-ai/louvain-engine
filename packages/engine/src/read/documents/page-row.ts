/** What the document ranking reads of a page row: which tier and id it is, the record it came from, its score. */
export type DocumentRow = { tier: string; id: string; eventId?: string | undefined; score: number };

/**
 * The document ranking, pure: group the page's and the pool's passages by their document, score each by its best chunk
 * plus `bonus` of what its other chunks add, and keep every other page row as `loose`. A pool row not on the page is a
 * candidate for the document ranking only. A row of another tier is not a chunk of its record: it stays loose, and its
 * record reaches the page only when the record's own passages rank it there.
 */
export function rankDocuments<E extends DocumentRow>(
  page: E[],
  pool: E[],
  bonus: number,
): { ranked: (readonly [string, { score: number; best: E }])[]; loose: E[] } {
  const docs = new Map<string, { best: number; rest: number; row: E }>();
  const loose: E[] = [];
  const seen = new Set<string>();
  // The page first: a reranked row keeps the score the reranker gave it.
  for (const e of [...page, ...pool]) {
    const key = `${e.tier}:${e.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (!e.eventId || e.tier !== "passage") {
      if (page.includes(e)) loose.push(e);
      continue;
    }
    const d = docs.get(e.eventId);
    if (!d) docs.set(e.eventId, { best: e.score, rest: 0, row: e });
    else if (e.score > d.best) {
      d.rest += d.best;
      d.best = e.score;
      // The row a document is shown by stays a passage once it has one.
      if (d.row.tier !== "passage" || e.tier === "passage") d.row = e;
    } else {
      d.rest += e.score;
      if (d.row.tier !== "passage" && e.tier === "passage") d.row = e;
    }
  }
  const ranked = [...docs.entries()]
    .map(([id, d]) => [id, { score: d.best + bonus * d.rest, best: d.row }] as const)
    .sort((a, b) => b[1].score - a[1].score);
  return { ranked, loose };
}
