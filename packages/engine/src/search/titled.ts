import type { Viewer } from "@louvain/engine-core";
import type { documentOrder } from "../ask/document-order.js";
import { pageOf } from "../ask/evidence.js";
import { telemetryOf } from "../given.js";
import type { ReadContext } from "../kg/read/fence.js";
import { hooksOf } from "../kg/read/hooks.js";
import type { SearchOptions } from "./document.js";
import type { Staged } from "./stage.js";

type Ranked = Awaited<ReturnType<typeof documentOrder>>["order"];

/**
 * Where a titled document goes, and how many: a search's 24-deep head is paged by the caller's `limit`, so a share of
 * `limit`'s last places can be past the first page an agent reads. Titled documents take FIXED places instead, 7 to 9,
 * among the full hits of the default page, whatever `limit` the caller paged with, so every page of one search builds
 * the same head. The head grows by as many as were added.
 */
const TITLED_AT = 7;
const TITLED_PLACES = 3;
/** Titled candidates read, so ones the legs already ranked still leave enough to fill the places. */
const TITLED_READ = TITLED_PLACES * 3;

/**
 * A document the search names is found by its title, where the build keeps a second matcher's title read
 * (`keyword-index.ts` `titles`; the open build's index holds a title as its document's header, and has none): readable
 * documents whose title shares the search's stemmed words, fenced and bounded, ties to the newer current revision,
 * each shown by its opening passage. The legs rank passages by words and meaning, and a title is in neither, so a named
 * document could sit off the page while a rival answered. A failure is `titles:unavailable`, never a failed search.
 */
export async function titledDocuments(search: TitledSearch): Promise<Staged<Ranked>> {
  const { context, reader, query, options } = search;
  const { titles } = hooksOf(context).keyword;
  if (!titles) return { value: [], degraded: [] };
  try {
    const found = await titles(context, reader, query, {
      limit: TITLED_READ,
      strict: true,
      filters: { ...(options.narrow ?? {}), ...(options.asOf ? { asOf: options.asOf } : {}) },
    });
    const page = pageOf(found.map((hit) => ({ evidence: hit, score: 0 })));
    const value = page.rows.map((row) => [row.eventId ?? row.id, { score: 0, best: row }] as const);
    return { value, degraded: [] };
  } catch (err) {
    // swallowed: the titled documents are added to the page, never its only leg; their failure is named, not thrown.
    telemetryOf(context).error("ask.search.titles", err);
    return { value: [], degraded: ["titles:unavailable"] };
  }
}

/** What a title is searched with: who reads, the search's words, and its narrowing and as-of. */
type TitledSearch = {
  context: ReadContext;
  reader: Viewer;
  query: string;
  options: Pick<SearchOptions, "asOf" | "narrow">;
};

/**
 * The ranked order with up to `TITLED_PLACES` titled documents the legs did not already rank into the page placed from
 * `TITLED_AT` (or the page's end, for a shorter one); every ranked document keeps its turn after them, and `added` says
 * how far the head grows. A titled copy of a document already on the page is collapsed after this. Pure.
 */
export function withTitled(
  order: Ranked,
  titled: Ranked,
  limit: number,
): { order: Ranked; added: number } {
  if (titled.length === 0) return { order, added: 0 };
  const head = new Set(order.slice(0, limit).map(([recordId]) => recordId));
  const added = titled.filter(([recordId]) => !head.has(recordId)).slice(0, TITLED_PLACES);
  const taken = new Set(added.map(([recordId]) => recordId));
  const rest = order.filter(([recordId]) => !taken.has(recordId));
  const at = Math.min(rest.length, TITLED_AT, Math.max(0, limit - added.length));
  return { order: [...rest.slice(0, at), ...added, ...rest.slice(at)], added: added.length };
}
