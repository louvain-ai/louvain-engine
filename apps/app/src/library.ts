import type { Reading } from "@louvain/engine-core";
import { derived, type Found, fromEngine, type Hit, type Match } from "./matches.js";

export type { Hit } from "./matches.js";

/**
 * The app reads through the engine's own two tools, as any agent does: search, then read. Nothing here touches the
 * database, so the app sees exactly what an agent would and no more.
 */

/** A page of a search: what it found (`matches.ts`), the cursor for the next page, and a refusal's sentence. */
export type Page = Found & { next: string | null; refusal?: string };
export type Document = {
  id: string;
  title: string;
  date: string | null;
  text: string;
  cut: boolean;
};

type ToolHit = {
  id: string;
  title: string | null;
  modifiedAt?: string;
  excerpt?: string;
  match?: Match;
};
type ToolPage = {
  sources?: ToolHit[];
  looselyRelated?: ToolHit[];
  matched?: boolean;
  note?: string | null;
  nextCursor?: string;
  error?: string;
};
type ToolRead = {
  title?: string | null;
  modifiedAt?: string;
  text?: string;
  nextOffset?: number;
  textTruncated?: boolean;
  error?: string;
};

/** A whole document is read page by page up to this many characters; past it the reader says it was cut. */
const DOCUMENT_CHARS = 400_000;

const hitOf = (s: ToolHit) => ({
  id: s.id,
  title: s.title ?? "Untitled",
  date: s.modifiedAt ?? null,
  passage: s.excerpt ?? "",
});
const withMatch = (s: ToolHit): Hit => ({
  ...hitOf(s),
  match: s.match ?? { words: false, meaning: null },
});

async function searchPage(run: Reading["tool"], args: Record<string, unknown>): Promise<ToolPage> {
  const page = (await run("louvain_search_sources", args)) as ToolPage;
  if (page.error) throw new Error(page.error);
  return page;
}

/** A search the engine will not run (one with no word and no figure) is its sentence, never a failure. */
const refused = (why: string): Page => ({
  sources: [],
  looselyRelated: [],
  matched: false,
  note: null,
  next: null,
  refusal: why,
});

/** One page of a search, split into matches and the loosely related, as the engine splits it or, failing that, as derived. */
export async function search(
  run: Reading["tool"],
  asked: { query: string; limit: number; cursor?: string | undefined },
): Promise<Page> {
  const { query, limit, cursor } = asked;
  let page: ToolPage;
  try {
    page = await searchPage(run, { query, limit, ...(cursor ? { cursor } : {}) });
  } catch (err) {
    if (err instanceof Error && err.name === "ToolInputError") return refused(err.message);
    throw err;
  }
  const hits = page.sources ?? [];
  const byKeyword = async () =>
    ((await searchPage(run, { query, mode: "keyword", limit: 5 })).sources ?? []).map(hitOf);
  const next = page.nextCursor ?? null;
  const engine = fromEngine(page, hits.map(withMatch), (raw) => (raw as ToolHit[]).map(withMatch));
  if (engine) return { ...engine, next };
  // Derived, a page with no match has nothing more to page through: the rest is only more resemblance.
  const found = await derived(query, hits.map(hitOf), byKeyword);
  return { ...found, next: found.matched ? next : null };
}

/** One document by a search result's id, its pages joined. Null when the engine has none by that id. */
export async function read(
  run: Reading["tool"],
  id: string,
  limit = DOCUMENT_CHARS,
): Promise<Document | null> {
  let text = "";
  let first: ToolRead | undefined;
  let offset: number | undefined = 0;
  while (offset !== undefined && text.length < limit) {
    const page = (await run("louvain_read_source", { sourceId: id, offset })) as ToolRead;
    if (page.error || page.text === undefined) return null;
    first ??= page;
    text += page.text;
    offset = page.nextOffset;
  }
  return {
    id,
    title: first?.title ?? "Untitled",
    date: first?.modifiedAt ?? null,
    text: text.slice(0, limit),
    cut: offset !== undefined || text.length > limit || first?.textTruncated === true,
  };
}
