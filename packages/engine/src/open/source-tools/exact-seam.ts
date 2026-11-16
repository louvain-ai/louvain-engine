import type { PendingQuery, Row } from "postgres";
import { telemetryOf } from "../../given.js";
import { endpointOf } from "../../kg/read/bm25.js";
import type { ReadContext } from "../../kg/read/fence.js";
import { bm25Leads, documentsListedFor } from "../../sources/index-list.js";
import type { Scope } from "../../sources/read-core.js";
import type { Identifier, Stored } from "./identifier.js";

/**
 * WHAT A BUILD THAT KEEPS A SECOND MATCHER ADDS TO THE EXACT TIER (`search-exact.ts`, `lookup.ts`), handed to their
 * reads in their context (`ReadHooks.exact`): how a word typed as a key is spelled (`spelled`, "sup1042" as
 * "sup-1042"), which documents' titles OPEN with a key (`titleKey`: a read of their ids for `exactCandidates`, and
 * the test `matchedOn`'s rule reads, `keyed`), and which documents hold an identifier as a whole token (`holding`, a
 * search's mentions and a lookup's). The open build's (`openExactTier`): a word searched as typed, the titles its
 * keyword index lists for the key that open with it in the index's own analyzed form (`titleKeyListed`), and no
 * whole-token test, its index's first tier already holding a key as one token.
 */
/** The documents whose title opens with a key: a read of their ids, and the test of a stored source. */
type TitleKeyed = { leg: PendingQuery<Row[]>; keyed: (source: Stored) => boolean };

export type ExactTier = {
  spelled(word: string): string;
  /** A query is a thenable, so it is handed in a box (`leg`): an async function returning it would run it. */
  titleKey: (context: ReadContext, s: Scope, i: Identifier) => Promise<TitleKeyed | null>;
  holding:
    | ((context: ReadContext, s: Scope, i: Identifier, ids: string[]) => Promise<Set<string>>)
    | null;
};

/** How many documents the index lists for a key: its own cap, as many as the lookup reads candidates. */
const TITLE_KEY_LISTED = 200;

/**
 * THE OPEN BUILD'S TITLE KEYS: of the readable documents its keyword index lists for the identifier (the one matcher,
 * best first: a title holding the key ranks by its header), those whose current title opens with it as the index's
 * analyzer reads a key (`bm25Leads`: "SUP-1042", "sup1042" and "Sup-1042" are one key), so a document that only
 * mentions it is never one and never counts toward the lookup's cap. None for an identifier of more than one word, or
 * when the index is not configured or cannot answer, which the search's own keyword leg reports.
 */
async function titleKeyListed(
  context: ReadContext,
  s: Scope,
  i: Identifier,
): Promise<TitleKeyed | null> {
  if (!endpointOf(context).configured() || s.containers.length === 0 || /\s/.test(i.text))
    return null;
  try {
    const listed = await documentsListedFor(s, i.text, TITLE_KEY_LISTED);
    const ids = await openingWith(context, i, { orgId: s.orgId, ids: listed });
    if (ids.size === 0) return null;
    return {
      leg: context.sql`select unnest(${[...ids]}::text[]) as id`,
      keyed: (src) => ids.has(src.id),
    };
  } catch (err) {
    telemetryOf(context).error("lookup.title_key_index", err, {});
    return null;
  }
}

/** Which of these documents' current titles open with the identifier's key, in the index's analyzed form. */
async function openingWith(
  { sql }: ReadContext,
  i: Identifier,
  { orgId, ids: listed }: { orgId: string; ids: string[] },
): Promise<Set<string>> {
  if (listed.length === 0) return new Set();
  const titled = await sql<{ id: string; title: string | null }[]>`
    select d.id, r.title from source_document d join source_revision r on r.event_id = d.current_event_id
    where d.org_id = ${orgId} and d.id = any(${listed}::text[])`;
  const [key, ...leads] = await bm25Leads([i.text, ...titled.map((t) => t.title ?? "")]);
  return new Set(key ? titled.filter((_, at) => leads[at] === key).map((t) => t.id) : []);
}

/** The open build's: a word searched as typed, title-key candidates from its index, no whole-token test. */
export const openExactTier: ExactTier = {
  spelled: (word) => word,
  titleKey: titleKeyListed,
  holding: null,
};
