import type { Viewer } from "@louvain/engine-core";
import { fence, type ReadContext } from "./fence.js";
import { recordTexts } from "./passages-by-id.js";

/**
 * The text at a span, as written: each record's stored text read again under the viewer's fence and cut at the span a
 * passage was located at, its line breaks intact. A stored passage is flattened to one line for indexing; a page that
 * shows the words as their author laid them out reads them here. A record the viewer cannot read, or whose text no
 * longer covers the span, yields nothing, and the caller keeps what it had. Bounded by the records asked.
 */
export async function spanTexts(
  context: ReadContext,
  viewer: Viewer,
  wanted: readonly { recordId: string; span: { start: number; end: number } }[],
): Promise<Map<string, string>> {
  const reader = await fence(context, viewer);
  if (!reader || wanted.length === 0) return new Map();
  const texts = await recordTexts(
    context.sql,
    reader,
    wanted.map((w) => w.recordId),
  );
  return new Map(
    wanted.flatMap(({ recordId, span }) => {
      const text = texts.get(recordId);
      return text !== undefined && span.end <= text.length && span.start < span.end
        ? [[recordId, text.slice(span.start, span.end)] as const]
        : [];
    }),
  );
}
