import type { Viewer } from "@louvain/engine-core";
import type { ReadContext } from "../read/fence.js";
import { hooksOf } from "../read/hooks.js";
import { records } from "../read/records/index.js";

/**
 * One hit per group: the first `want` of a document order, one per document, or per the group an application binds
 * (`filter-seam.ts` `groupOf`) from the readable summary, so only a member the viewer can read stands for its group, a
 * hidden one never hides a visible one, and the best-ranked readable member leads. A record with no readable summary
 * keeps its place.
 * The order is read a window at a time until `want` groups are held or it ends; `more` says whether another
 * group is left, found by reading on and never by counting records.
 */
export async function oneOfEachOriginal<T>(
  context: ReadContext,
  viewer: Viewer,
  { order, want }: { order: readonly (readonly [string, T])[]; want: number },
): Promise<{ chosen: [string, T][]; more: boolean }> {
  const seen = new Set<string>();
  const chosen: [string, T][] = [];
  const window = Math.max(want * 2, 8);
  for (let at = 0; at < order.length; at += window) {
    const slice = order.slice(at, at + window);
    const { summaries } = await records.summaries(
      context,
      viewer,
      slice.map(([recordId]) => recordId),
    );
    const groupOf = hooksOf(context).filters.groupOf ?? ((s: { id: string }) => s.id);
    const originOf = new Map(summaries.map((s) => [s.recordId, groupOf(s)]));
    for (const [recordId, d] of slice) {
      const original = originOf.get(recordId);
      if (original !== undefined) {
        if (seen.has(original)) continue;
        seen.add(original);
      }
      if (chosen.length >= want) return { chosen, more: true };
      chosen.push([recordId, d]);
    }
  }
  return { chosen, more: false };
}
