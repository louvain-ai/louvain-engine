import type { Viewer } from "@louvain/engine-core";
import type { AsOf } from "./context.js";
import { bounded, fence, type ReadContext } from "./fence.js";
import { hooksOf } from "./hooks.js";
import { documentPassages } from "./passages/document-passages.sql.js";

/** At most this many records a call: the reranker's window is a page's worth of documents, never the whole store. */
const DOCUMENT_MAX_RECORDS = 300;
/** No document is read past this many characters, whatever the caller asks. */
const DOCUMENT_MAX_CHARS = 64_000;

/**
 * A document as one text, for the reranker to read: each record's readable passages in their order
 * (`documentPassages`), its first passage's context (the record's header) on its own line, a blank line, then every
 * passage's text joined by a newline, cut at `maxChars` code points with no marker. Read under the viewer's fence at
 * the question's instant, so a passage the viewer may not read never reaches the text; a record with nothing
 * readable is absent.
 */
export async function passagesAsDocuments(
  context: ReadContext,
  viewer: Viewer,
  recordIds: readonly string[],
  opts: { asOf?: AsOf; maxChars: number },
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const ids = [...new Set(recordIds)].slice(0, DOCUMENT_MAX_RECORDS);
  const cap = Math.min(Math.max(0, Math.floor(opts.maxChars)), DOCUMENT_MAX_CHARS);
  const reader = await fence(context, viewer);
  if (!reader || ids.length === 0 || cap === 0) return out;
  const rows = await bounded(context, (q) =>
    documentPassages(q, {
      fence: reader,
      ids,
      asOf: opts.asOf,
      cap,
      added: hooksOf(context).filters,
    }),
  );
  const parts = new Map<string, { title: string; texts: string[] }>();
  for (const r of rows) {
    const doc = parts.get(r.event_id);
    if (doc) doc.texts.push(r.text);
    else parts.set(r.event_id, { title: (r.context ?? "").trim(), texts: [r.text] });
  }
  for (const [id, { title, texts }] of parts)
    out.set(id, cutAt(`${title}\n\n${texts.join("\n")}`, cap));
  return out;
}

/** The first `cap` code points (never a lone surrogate at the cut). */
function cutAt(text: string, cap: number): string {
  if (text.length <= cap) return text;
  return Array.from(text).slice(0, cap).join("");
}
