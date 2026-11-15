import { fillFromListing, idPrefix, type SearchCursor } from "./search-paging.js";
import type { ClientNarrow } from "./tool-helpers.js";

/**
 * Sources the caller has already shown (`exclude`), filled by the caller and never asked of the model, are left out
 * of the ranked head and the listing's fill, so a second search for one question brings documents not yet seen.
 * Applied after the fence, to ids the search found: it can only remove what this person could already read. At most
 * `EXCLUDE_MAX`; a cursor carries only the head's ids, and the excluded ones come again with every page.
 */
const EXCLUDE_MAX = 200;
export function excludedOf(args: Record<string, unknown>): Set<string> {
  const given = Array.isArray(args.exclude) ? args.exclude : [];
  return new Set(
    given
      .filter((x): x is string => typeof x === "string" && x.length > 0 && x.length <= 200)
      .slice(0, EXCLUDE_MAX),
  );
}

/** The ranked head as shown: narrowed to the app and the client, less what the caller already showed. */
export function headOf<D extends { recordId: string; summary: { id: string; app: string } }>(
  documents: readonly D[],
  app: string | undefined,
  client: ClientNarrow | undefined,
  excluded: ReadonlySet<string>,
): D[] {
  return documents.filter(
    (d) =>
      (!app || d.summary.app === app) &&
      (!client?.records || client.records.has(d.recordId)) &&
      !excluded.has(d.summary.id),
  );
}

/** A page past the head: the listing from the cursor's place, skipping the head's and the excluded documents by id prefix. */
export function listingPast<D extends { summary: { id: string } }>(
  cursor: Extract<SearchCursor, { p: "listing" }>,
  limit: number,
  excluded: ReadonlySet<string>,
  page: (offset: number) => Promise<{ rows: D[]; hasMore: boolean }>,
) {
  return fillFromListing(
    async (offset) => {
      const got = await page(offset);
      // Matched by id prefix, as the cursor keeps them (`idPrefix`).
      return {
        rows: got.rows.map((d) => ({ ...d, id: idPrefix(d.summary.id) })),
        hasMore: got.hasMore,
      };
    },
    {
      from: cursor.j,
      want: limit,
      skip: new Set([...cursor.r, ...excluded].map(idPrefix)),
      pageSize: 24,
    },
  );
}
