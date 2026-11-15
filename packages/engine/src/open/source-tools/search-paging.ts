import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * PAGING `louvain_search_sources`: an opaque cursor, and the walk that fills a page from the listing.
 *
 * A RANKED order has no key to resume from — it is recomputed per call (the legs fused, the cross-encoder) — so the
 * cursor records WHERE in the order it stopped, and the order is made reproducible instead: the answer path's head is
 * always ranked at its full depth, whatever page is asked for, and the listing's documents follow it in the listing's
 * own deterministic order. Once a page has passed the head, the cursor carries the head's document ids, so the later
 * pages page the listing alone, skipping what the head already showed, and never rank again.
 *
 * The cursor carries a key of the search it belongs to (the query and every filter), and a cursor presented with a
 * different search is refused rather than read as a position in it. It names documents the caller was already shown
 * and a position; it grants nothing, and every page is read through the same fenced functions as the first.
 *
 * SEALED, NOT ENCODED: a cursor is text an agent logs, shares or pastes into another agent, and the head's document
 * ids inside it are a list of what the original viewer could see. So it is AES-256-GCM under a key derived for this
 * purpose alone, which the build binds (`presentation-seam.ts` `cursorKey`: the product derives it from its credentials
 * key, the open engine from its bearer token): nobody holding a cursor reads it, and one altered by a byte fails its
 * tag and is refused.
 */

export type SearchCursor =
  /** In the answer path's head, at offset `o`. */
  | { v: 1; k: string; p: "ranked"; o: number }
  /**
   * Past the head: at raw index `j` of the listing, skipping the head's documents `r`, each by its id's first
   * `ID_PREFIX` characters (`idPrefix`): a wide head is up to 100 documents, and 100 whole ids sealed are past the
   * cursor's 8,192 characters. A cursor sealed before carries whole ids, which `idPrefix` cuts the same way. `m`: the
   * head matched the search, so every page past it says so too (`search-read.ts` `splitHead`).
   */
  | { v: 1; k: string; p: "listing"; j: number; r: string[]; m?: true }
  /**
   * The list view: at raw index `j` of the listing, newest first. `w`: nothing in the date range matched the query,
   * so this pages the range itself.
   */
  | { v: 1; k: string; p: "list"; j: number; w?: true };

/**
 * HOW MUCH OF A DOCUMENT ID A LISTING CURSOR KEEPS: its first 16 characters. The ids the listing returns are
 * `source_document` ids, 64 lower-case hex characters of a digest, so 16 of them are 64 random bits (a UUID v4, as a
 * space file's id is, keeps 13 random hex digits in its first 16 characters: 52 bits). A prefix only ever HIDES a row
 * (it is the skip set, matched against the listing's rows), never shows one: two distinct documents sharing a prefix
 * would hide the second, at odds of about 2^-64 a pair, with at most 128 + 200 skipped ids a page.
 */
const ID_PREFIX = 16;
export const idPrefix = (id: string): string => id.slice(0, ID_PREFIX);
/** The most head documents a listing cursor may name: the wide head and its titled places, with room to spare. */
const HEAD_IDS_MAX = 128;

/** A cursor that is not this server's, or belongs to another search: refused, never guessed at. */
export class CursorRefused extends Error {}

/** The search a cursor belongs to: the query and every filter, in a fixed order. */
export function searchKey(search: Record<string, string | undefined>): string {
  const fixed = Object.keys(search)
    .sort()
    .map((k) => [k, search[k] ?? ""]);
  return createHash("sha256").update(JSON.stringify(fixed)).digest("hex").slice(0, 16);
}

const VERSION = "c1";

/** The cursor sealed under `seal`, the build's cursor key (`SourceToolPresentation.cursorKey`). */
export function encodeCursor(cursor: SearchCursor, seal: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", seal, iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(cursor), "utf8"), cipher.final()]);
  return `${VERSION}.${Buffer.concat([iv, cipher.getAuthTag(), data]).toString("base64url")}`;
}

const CURSOR_SHAPE = /^c1\.[A-Za-z0-9_-]{40,8192}$/;

/** The cursor's JSON, or null when this server did not seal it under `seal` (or a byte of it was changed). */
function openCursor(text: string, seal: Buffer): string | null {
  if (!CURSOR_SHAPE.test(text)) return null;
  try {
    const raw = Buffer.from(text.slice(VERSION.length + 1), "base64url");
    const decipher = createDecipheriv("aes-256-gcm", seal, raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
  } catch {
    // swallowed: a cursor whose tag does not verify was not sealed here, or was altered; it is refused by the caller.
    return null;
  }
}

const index = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 100_000;

/** The cursor `encodeCursor` sealed under `seal` for the search `key` names, else refused. */
export function decodeCursor(text: string, key: string, seal: Buffer): SearchCursor {
  const opened = openCursor(text, seal);
  if (opened === null) throw new CursorRefused("That cursor is not one this search returned.");
  let c: Record<string, unknown>;
  try {
    c = JSON.parse(opened) as Record<string, unknown>;
  } catch {
    // swallowed: a cursor that does not parse is not this server's, and is refused as such below.
    throw new CursorRefused("That cursor is not one this search returned.");
  }
  if (!c || typeof c !== "object" || c.v !== 1 || typeof c.k !== "string")
    throw new CursorRefused("That cursor is not one this search returned.");
  if (c.k !== key)
    throw new CursorRefused(
      "That cursor belongs to a different search. Pass the same query and filters, or start again without a cursor.",
    );
  if (c.p === "ranked" && index(c.o)) return { v: 1, k: key, p: "ranked", o: c.o };
  if (c.p === "list" && index(c.j) && (c.w === undefined || c.w === true))
    return { v: 1, k: key, p: "list", j: c.j, ...(c.w ? { w: true as const } : {}) };
  if (
    c.p === "listing" &&
    index(c.j) &&
    Array.isArray(c.r) &&
    c.r.length <= HEAD_IDS_MAX &&
    c.r.every((id) => typeof id === "string" && id.length <= 200) &&
    (c.m === undefined || c.m === true)
  )
    return {
      v: 1,
      k: key,
      p: "listing",
      j: c.j,
      r: c.r as string[],
      ...(c.m ? { m: true as const } : {}),
    };
  throw new CursorRefused("That cursor is not one this search returned.");
}

/** One page of the listing, at a raw offset. */
export type ListingPage<T> = { rows: T[]; hasMore: boolean };

/**
 * FILL A PAGE FROM THE LISTING: `want` rows from raw index `from`, skipping the ids in `skip`, reading the listing's
 * own pages in order. Returns the rows, the raw index to resume from, and whether the listing holds more past it.
 * Bounded: at most enough listing pages for `want` rows plus two, so a page of skips cannot walk the tenant.
 */
export async function fillFromListing<T extends { id: string }>(
  page: (offset: number) => Promise<ListingPage<T>>,
  opts: { from: number; want: number; skip: ReadonlySet<string>; pageSize: number },
): Promise<{ rows: T[]; next: number; hasMore: boolean }> {
  const rows: T[] = [];
  let next = opts.from;
  // MORE MEANS A ROW THE NEXT PAGE WILL SHOW: a row it would skip (already shown) is passed over, never counted, so a
  // page never says there is more and leaves the next one empty. Past `want`, the walk looks ahead for one such row.
  let hasMore = false;
  const calls = Math.ceil(opts.want / opts.pageSize) + 2;
  for (let call = 0; call < calls && !hasMore; call++) {
    const got = await page(next);
    for (const row of got.rows) {
      if (!opts.skip.has(row.id) && rows.length >= opts.want) {
        hasMore = true;
        break;
      }
      next++;
      if (!opts.skip.has(row.id)) rows.push(row);
    }
    if (hasMore || !got.hasMore || got.rows.length === 0) break;
    // The look-ahead's budget spent: what is left is unknown, so it is offered.
    if (call === calls - 1) hasMore = true;
  }
  return { rows, next, hasMore };
}
