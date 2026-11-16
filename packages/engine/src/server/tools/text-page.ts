/** The most text one `louvain_read_source` call returns (characters); the rest comes by `offset`. */
export const READ_PAGE_CHARS = 40_000;

/**
 * One page of a source's text (`louvain_read_source`). A source is returned whole by contract, and a long one (a
 * contract, a transcript, a workbook read as text) overflowed its client exactly as an answer did. So the text comes
 * in pages: the whole length first (`textLength`), then `nextOffset` while more follows. Only ever a slice of what the
 * fenced read returned.
 */
export function textPage(
  text: string,
  offset: unknown,
): { text: string; textLength: number; textOffset?: number; nextOffset?: number } {
  const from =
    typeof offset === "number" && Number.isFinite(offset)
      ? Math.min(Math.max(0, Math.floor(offset)), text.length)
      : 0;
  const to = Math.min(text.length, from + READ_PAGE_CHARS);
  return {
    text: text.slice(from, to),
    textLength: text.length,
    ...(from > 0 ? { textOffset: from } : {}),
    ...(to < text.length ? { nextOffset: to } : {}),
  };
}
