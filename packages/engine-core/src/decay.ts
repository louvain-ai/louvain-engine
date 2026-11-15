/**
 * A ROW'S RELEVANCE, SCALED BY ITS AGE, WITHIN ONE LEG. Rank fusion keeps no relevance — the gap between
 * places 1 and 12 says nothing about how near either is — so a penalty in places moved a sole old source below a dozen
 * newer rows that barely matched. Inside a leg the native score does carry it: each row's score over the leg's best,
 * times its retention R = floor + (1 − floor) · e^(−age / S), re-sorted. A row with no score keeps its place (a leg
 * that returned none is unchanged). The floor bounds what age can cost: an old row that is the only near one still
 * outranks fresh rows less than `floor` as near.
 */
export function decayed<T extends { occurred_at: Date; score?: number }>(
  rows: readonly T[],
  now: number,
  curve: { days: number; floor: number },
): T[] {
  const best = Math.max(0, ...rows.map((r) => r.score ?? 0));
  if (best <= 0) return [...rows];
  const keyed = rows.map((row, i) => {
    const age = Math.max(0, (now - new Date(row.occurred_at).getTime()) / 86_400_000);
    const retention = curve.floor + (1 - curve.floor) * Math.exp(-age / curve.days);
    const relevance = row.score === undefined ? null : Math.max(0, row.score) / best;
    return { row, i, key: relevance === null ? null : relevance * retention };
  });
  // Unscored rows hold their positions; the scored ones are re-sorted among the places they held.
  const scored = keyed
    .filter((k) => k.key !== null)
    .sort((a, b) => (b.key ?? 0) - (a.key ?? 0) || a.i - b.i);
  let next = 0;
  return keyed.map((k) =>
    k.key === null ? k.row : (scored[next++] as (typeof scored)[number]).row,
  );
}
