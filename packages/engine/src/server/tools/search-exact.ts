import type { SourceSummary, Viewer } from "@louvain/engine-core";
import { knownAtScope } from "../../read/context.js";
import { narrow, type ReadContext, readsNothing } from "../../read/fence.js";
import { hooksOf } from "../../read/hooks.js";
import { type Scope, scope, summary } from "../../read/listing/core.js";
import { searchSources } from "../../read/listing/search.js";
import type { ClientNarrow } from "./arguments.js";
import { type Identifier, identifierOf, isKeyShaped, matchedOn } from "./identifier.js";
import { exactCandidates } from "./lookup-reads.js";

/**
 * An identified thing outranks an unidentified reference to it. A search for "SUP-1042" among eighty tickets put the
 * ticket 18th: the keyword leg ranked it first, but an identifier means nothing to the embedder, whose nearest passages
 * were the other tickets (cosine 0.58 to 0.59 against the ticket's own 0.53), and fusion preferred "decent in both" to
 * "first in one". So the documents that ARE what the search names lead the page, in a tier of their own: the lookup's
 * own exact reads (`lookup-reads.ts`, indexed equality on the id, the source's own id, the whole title, the key a
 * title opens with, the URL), never the query's shape. The documents that MENTION a key the search names follow, in
 * the keyword listing's order, each holding it as a whole token; then the fused rest. A search no document IS is
 * unchanged.
 *
 * What a search names: the whole query, and each key in it ("SUP-1042", "web#14"), a key typed joined ("sup1042") also
 * as its hyphenated spelling, as the cut-off's literals already compare them (`relevance.ts` `literalsOf`). Each tier
 * passes the search's own narrowing (app, dates, collection, client, already shown) after the fence; as Louvain knew
 * it on a day, nothing is put in, as the listing does not fill.
 */

/** A document on the ranked page; `exact` when it IS what the search names. */
export type Placed = {
  recordId: string;
  summary: SourceSummary;
  excerpt: string;
  exact?: true;
};

/** The search's own narrowing, applied to what the exact reads find (the head is already narrowed by it). */
export type Narrowing = {
  app: string | undefined;
  after: string | undefined;
  before: string | undefined;
  containers: string[] | undefined;
  client: ClientNarrow | undefined;
  excluded: ReadonlySet<string>;
  /** A search as of a date: the exact reads know only what is current, so they put nothing in. */
  asOf: string | undefined;
};

/** At most this many keys of a query are looked up: a search is a few words, not a list of keys. */
const KEYS_READ = 3;
/** At most this many documents lead as what the search names, newest first, as the lookup shows (titles are not unique). */
const EXACT_SHOWN = 20;
/** The mentions read: one keyword page. */
const MENTIONS_READ = 24;

/** The search's words with each key spelled as the build spells a key, for the keyword read of its mentions. */
const keysSpelled = (query: string, spelled: (word: string) => string): string =>
  query.trim().split(/\s+/).map(spelled).join(" ");

/** The identifiers a search names: the whole query, then each key in it, spelled as the build spells a key. */
function namedIn(query: string, spelled: (word: string) => string): Identifier[] {
  const whole = query.trim();
  const keys = whole
    .split(/\s+/)
    .map((w) => spelled(w.replace(/^[^\p{L}\p{N}[(]+|[^\p{L}\p{N}\])]+$/gu, "")))
    .filter((w) => isKeyShaped(w) && w !== whole);
  return [whole, ...new Set(keys)].slice(0, KEYS_READ + 1).map(identifierOf);
}

/**
 * The head with the documents the search names first, then those mentioning its keys, then the rest in their order;
 * unchanged when no document is what it names.
 */
export async function exactFirst<D extends Placed>(
  context: ReadContext,
  owner: Viewer,
  query: string,
  head: readonly D[],
  narrowing: Narrowing,
): Promise<(D | Placed)[]> {
  if (!query.trim() || narrowing.asOf || knownAtScope() !== undefined) return [...head];
  const s = narrowed(
    await scope(context, { orgId: owner.orgId, principal: owner.principal }),
    narrowing,
  );
  if (s.containers.length === 0) return [...head];
  const tier = hooksOf(context).exact;
  const named = namedIn(query, tier.spelled);
  const exact = oneEach(
    (await Promise.all(named.map((i) => isIt(context, s, i))))
      .flat()
      .filter((src) => passes(src, narrowing)),
  ).slice(0, EXACT_SHOWN);
  if (exact.length === 0) return [...head];
  // A key's mentions are a second matcher's whole-token test (`exact-seam.ts`); the open build reads none.
  const keys = tier.holding ? named.filter((i) => i.keyShaped) : [];
  const ofHead = new Map(head.map((d) => [d.summary.id, d]));
  const listed =
    keys.length > 0 || exact.some((src) => !ofHead.has(src.id))
      ? await mentionsOf(context, owner, s, query, keys, exact, narrowing)
      : { mentions: [], all: [] };
  const place = (src: SourceSummary, excerpt: string): D | Placed =>
    ofHead.get(src.id) ?? { recordId: src.versionId, summary: src, excerpt };
  const excerptOf = new Map(listed.all.map((d) => [d.summary.id, d.excerpt]));
  const lead = [
    ...exact.map((src) => ({ ...place(src, excerptOf.get(src.id) ?? ""), exact: true as const })),
    ...listed.mentions.map((d) => place(d.summary, d.excerpt)),
  ];
  return ledFirst(lead, head);
}

/** The lead, then the head without what the lead already shows, a copy of it included. */
function ledFirst<D extends Placed>(lead: (D | Placed)[], head: readonly D[]): (D | Placed)[] {
  const led = new Set(
    lead.flatMap((d) => [d.summary.id, ...(d.summary.origin ? [d.summary.origin] : [])]),
  );
  return [
    ...lead,
    ...head.filter(
      (d) => !led.has(d.summary.id) && !(d.summary.origin && led.has(d.summary.origin)),
    ),
  ];
}

/** The reader's containers narrowed to the search's collection: a narrowing of the fence, never a widening. */
function narrowed(s: Scope, n: Narrowing): Scope {
  return n.containers ? (narrow(s, n.containers) ?? readsNothing(s.orgId)) : s;
}

/** The documents that ARE this identifier, by the lookup's own rules (its id, its source's id, its title, its URL). */
async function isIt(context: ReadContext, s: Scope, i: Identifier): Promise<SourceSummary[]> {
  if (!i.text) return [];
  const candidates = await exactCandidates(context, s, i);
  const { byline } = hooksOf(context).detail;
  return candidates.filter((row) => matchedOn(row, i) !== null).map((row) => summary(row, byline));
}

/** Within the search's app, dates, client and not already shown. */
function passes(src: SourceSummary, n: Narrowing): boolean {
  return (
    (!n.app || src.app === n.app) &&
    (!n.after || src.sourceUpdatedAt >= n.after) &&
    (!n.before || src.sourceUpdatedAt <= `${n.before}T23:59:59.999Z`) &&
    (!n.client?.records || n.client.records.has(src.versionId)) &&
    !n.excluded.has(src.id)
  );
}

/** Each document once, and A COPY IS NOT A SECOND SOURCE: one per origin, the first read. */
function oneEach(sources: SourceSummary[]): SourceSummary[] {
  const seen = new Set<string>();
  return sources.filter((src) => {
    const key = src.origin ?? src.id;
    if (seen.has(key) || seen.has(src.id)) return false;
    seen.add(key).add(src.id);
    return true;
  });
}

type Listed = { summary: SourceSummary; excerpt: string };

/**
 * One keyword page for the search's own words, in the keyword listing's order: the documents in it holding one of the
 * search's keys as a whole token, none that IS what the search names, are its mentions; every document it read lends
 * its excerpt to an exact one the head did not hold. Not read when there is neither to find.
 */
async function mentionsOf(
  context: ReadContext,
  owner: Viewer,
  s: Scope,
  query: string,
  keys: readonly Identifier[],
  exact: readonly SourceSummary[],
  narrowing: Narrowing,
): Promise<{ mentions: Listed[]; all: Listed[] }> {
  const { spelled, holding: holds } = hooksOf(context).exact;
  const got = await searchSources(context, owner, {
    q: keysSpelled(query, spelled),
    mode: "keyword",
    sort: "relevance",
    offset: 0,
    facets: "skip",
    count: "skip",
    ...(narrowing.containers ? { containers: narrowing.containers } : {}),
  });
  const all = got.sources
    .slice(0, MENTIONS_READ)
    .map((src) => ({ summary: src, excerpt: src.excerpt }));
  const isExact = new Set(exact.flatMap((src) => [src.id, ...(src.origin ? [src.origin] : [])]));
  const others = all.filter(
    (d) =>
      !isExact.has(d.summary.id) &&
      !(d.summary.origin && isExact.has(d.summary.origin)) &&
      passes(d.summary, narrowing),
  );
  const ids = others.map((d) => d.summary.id);
  const holding = holds ? await Promise.all(keys.map((k) => holds(context, s, k, ids))) : [];
  return { mentions: others.filter((d) => holding.some((h) => h.has(d.summary.id))), all };
}
