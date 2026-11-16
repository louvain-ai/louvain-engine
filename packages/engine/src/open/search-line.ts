import { ITEM_FEED } from "./ingest/item-feed.js";

/**
 * ONE LINE OF `./engine search`, as a person reads it in a terminal (and on a phone, in the README's picture):
 * `<rank>. <title> · <date> · <id>`, with the source's app between title and date only when it names one. The engine's
 * own loader and its HTTP route record no app of their own (its feed, `ITEM_FEED`, or the older `http`), which would
 * say nothing on every line. The id is
 * its first `SHORT_ID` characters, enough to tell the page's documents apart; `--full-ids` prints it whole, as the tool
 * server's `louvain_search_sources` always returns it for `louvain_read_source` to open.
 */
export type SearchLineHit = {
  id: string;
  title?: string | null;
  app?: string | null;
  modifiedAt?: string;
  dateMonth?: string;
  dateYear?: string | number;
};

/** How many characters of an id a line shows. */
export const SHORT_ID = 12;

/** The apps the engine records for what it was handed directly (a folder, its HTTP route): nothing to show. */
const NO_APP: ReadonlySet<string> = new Set([ITEM_FEED, "http"]);

export function searchLine(
  hit: SearchLineHit,
  rank: number,
  opts: { fullIds?: boolean } = {},
): string {
  const date = hit.modifiedAt?.slice(0, 10) ?? hit.dateMonth ?? hit.dateYear ?? "—";
  const app = hit.app && !NO_APP.has(hit.app) ? ` · ${hit.app}` : "";
  const id = opts.fullIds ? hit.id : hit.id.slice(0, SHORT_ID);
  return `${rank}. ${hit.title ?? "(untitled)"}${app} · ${date} · ${id}`;
}
