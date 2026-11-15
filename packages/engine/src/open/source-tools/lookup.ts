import type { SourceSummary, Viewer } from "@louvain/engine-core";
import { instructionLikeField } from "../../ingest/quarantine.js";
import type { ReadContext } from "../../kg/read/fence.js";
import { hooksOf } from "../../kg/read/hooks.js";
import type { Byline } from "../../sources/detail-seam.js";
import { type Scope, scope, summary } from "../../sources/read-core.js";
import { searchSources } from "../../sources/read-search.js";
import { containersOf, placed } from "./containers.js";
import { datedAs } from "./dated.js";
import { type Identifier, identifierOf, type MatchedOn, matchedOn } from "./identifier.js";
import { CANDIDATES_READ, type Candidate, exactCandidates } from "./lookup-reads.js";
import type { LinkTo } from "./presentation-seam.js";
import { authorOf } from "./search-hits.js";
import { clamp, connectionOf, str, ToolInputError } from "./tool-helpers.js";

/**
 * `louvain_lookup_source`: a document points at ENG-4902, so open ENG-4902. Which sources ARE the identifier (a rule
 * in `identifier.ts` holds, a copy counted once) and which MENTION it (keyword matches holding it as a whole token,
 * newest first) are two answers, never mixed, with no embedding and no model. Every read is fenced, so a record the
 * reader cannot read gets the answer an unknown identifier gets: nothing returned, counted or hinted at.
 */
const IS_SHOWN = 20;
const MENTIONS_DEFAULT = 20;
const MENTIONS_MAX = 50;
/** Keyword pages (24 rows each) read for mentions at most; past them the search tool lists the rest. */
const MENTION_PAGES = 3;

type Match = { source: SourceSummary; matchedOn: MatchedOn };

type Found = {
  is: Match[];
  /** More sources may be it than `is` holds: a read stopped at its bound, or more matched than are shown. */
  isAtLeast: boolean;
  mentions: SourceSummary[];
  moreMentions: boolean;
};

const NOTHING: Found = {
  is: [],
  isAtLeast: false,
  mentions: [],
  moreMentions: false,
};

export async function lookupSource(
  context: ReadContext,
  owner: Viewer,
  args: Record<string, unknown>,
) {
  const identifier = identifierOf(writtenIdentifier(args));
  const limit = clamp(args.limit, MENTIONS_DEFAULT, MENTIONS_MAX);
  const s = await scope(context, { orgId: owner.orgId, principal: owner.principal });
  const found =
    s.containers.length === 0 ? NOTHING : await lookUp({ context, owner, s }, identifier, limit);
  return presented(context, owner, identifier, found);
}

function writtenIdentifier(args: Record<string, unknown>): string {
  const written = str(args.identifier);
  if (!written) throw new ToolInputError("An identifier is required.");
  // As long as the longest URL a source keeps (`safeSourceUrl`), so any stored address can be looked up.
  if (written.length > 4096)
    throw new ToolInputError("That identifier is too long (4,096 characters at most).");
  return written;
}

/** Who asks: what their reads run on, the reader and the scope already resolved for them. */
type Asker = { context: ReadContext; owner: Viewer; s: Scope };

async function lookUp(asker: Asker, i: Identifier, limit: number): Promise<Found> {
  const candidates = await exactCandidates(asker.context, asker.s, i);
  const matches = oneCopyEach(matchesAmong(candidates, i, hooksOf(asker.context).detail.byline));
  const is = matches.slice(0, IS_SHOWN);
  // Every match is kept out of the mentions, shown or not: a record past `IS_SHOWN` is still the record.
  const mentions = await mentionsOf(asker, i, { is: matches, limit });
  return {
    is,
    isAtLeast: candidates.length === CANDIDATES_READ || matches.length > IS_SHOWN,
    mentions: mentions.rows,
    moreMentions: mentions.more,
  };
}

/** The candidates a rule holds for, in the order they were read: each document once, newest first. */
function matchesAmong(candidates: readonly Candidate[], i: Identifier, byline: Byline): Match[] {
  return candidates.flatMap((row) => {
    const rule = matchedOn(row, i);
    return rule ? [{ source: summary(row, byline), matchedOn: rule }] : [];
  });
}

/**
 * A copy is not a second source: one file reached through two connections shares its origin, and is one match, the
 * newest readable copy. Every row here is already fenced, so a copy the reader cannot read never hides one they can.
 */
function oneCopyEach(matches: Match[]): Match[] {
  const seen = new Set<string>();
  return matches.filter(({ source }) => {
    if (!source.origin) return true;
    if (seen.has(source.origin)) return false;
    seen.add(source.origin);
    return true;
  });
}

/**
 * Mentions: keyword phrase matches holding the identifier, as a whole token where the build tests one, never the record
 * or a copy of it.
 */
async function mentionsOf(
  { context, owner, s }: Asker,
  i: Identifier,
  { is, limit }: { is: readonly Match[]; limit: number },
): Promise<{ rows: SourceSummary[]; more: boolean }> {
  const isIt = (src: SourceSummary) =>
    is.some((m) => m.source.id === src.id || (!!src.origin && m.source.origin === src.origin));
  const rows: SourceSummary[] = [];
  let offset = 0;
  let more = false;
  for (let page = 0; page < MENTION_PAGES && rows.length <= limit; page += 1) {
    const got = await searchSources(context, owner, {
      q: `"${i.text.replace(/"/g, " ")}"`,
      mode: "keyword",
      sort: "newest",
      offset,
      facets: "skip",
      count: "skip",
    });
    const candidates = got.sources.filter((src) => !isIt(src));
    // A second matcher's whole-token test narrows its phrase matches (`exact-seam.ts`); the open build's index
    // already matches a key as one token, so its phrase matches are the mentions.
    const { holding: holds } = hooksOf(context).exact;
    const holding = holds
      ? await holds(
          context,
          s,
          i,
          candidates.map((src) => src.id),
        )
      : null;
    rows.push(...candidates.filter((src) => !holding || holding.has(src.id)));
    offset += got.sources.length;
    more = got.hasMore;
    if (!got.hasMore) break;
  }
  return { rows: rows.slice(0, limit), more: more || rows.length > limit };
}

/** One source as a lookup row: what the list view says of it. */
function rowOf(source: SourceSummary, names: ReadonlyMap<string, string>, linkTo: LinkTo) {
  return {
    id: source.id,
    title: source.title,
    app: source.app,
    ...connectionOf(source.connectionId, names),
    kind: source.kind,
    ...authorOf(source),
    ...datedAs("modifiedAt", source.sourceUpdatedAt, source.datePrecision),
    url: source.url,
    ...linkTo(source.id),
    ...instructionLikeField(source.instructionLike),
  };
}

async function presented(context: ReadContext, owner: Viewer, i: Identifier, found: Found) {
  const sources = [...found.is.map((m) => m.source), ...found.mentions];
  const [names, where] = await Promise.all([
    hooksOf(context).presentation.connectionNames(
      owner.orgId,
      owner.principal,
      sources.flatMap((src) => (src.connectionId ? [src.connectionId] : [])),
    ),
    containersOf(
      context,
      owner,
      sources.map((src) => src.id),
    ),
  ]);
  const { linkTo } = hooksOf(context).presentation;
  return {
    identifier: i.text,
    is: placed(
      found.is.map((m) => ({ ...rowOf(m.source, names, linkTo), matchedOn: m.matchedOn })),
      where,
    ),
    ...(found.isAtLeast ? { isAtLeast: true as const } : {}),
    mentions: placed(
      found.mentions.map((src) => rowOf(src, names, linkTo)),
      where,
    ),
    hasMoreMentions: found.moreMentions,
    note: noteOf(i.text, found),
  };
}

function noteOf(identifier: string, found: Found): string {
  return [isSaid(identifier, found), mentionsSaid(identifier, found)].filter(Boolean).join(" ");
}

function isSaid(identifier: string, { is, isAtLeast }: Found): string {
  const said = JSON.stringify(identifier);
  if (is.length === 0)
    return `No source you can read IS ${said}: none has it as its id, its own id in its app, its URL, its whole title, the key its title opens with, or its file name.`;
  if (isAtLeast)
    return `At least ${is.length} sources ARE ${said} by an exact match, and more may (\`is\` holds the newest ${is.length}, each with \`matchedOn\`): titles are not unique, so check which one the document meant.`;
  if (is.length === 1)
    return `One source IS ${said} (\`is\`, with \`matchedOn\` saying how): open it with louvain_read_source by its \`id\`.`;
  return `${is.length} sources ARE ${said} by an exact match (\`is\`, each with \`matchedOn\`): titles are not unique, so check which one the document meant.`;
}

function mentionsSaid(identifier: string, { mentions, moreMentions }: Found): string {
  if (mentions.length === 0) return "No other source you can read mentions it.";
  if (moreMentions)
    return `${mentions.length} sources that MENTION it are in \`mentions\`, newest first, and more do: list them all with louvain_search_sources, query ${JSON.stringify(`"${identifier}"`)}, mode "keyword", view "list".`;
  const count =
    mentions.length === 1 ? "One source mentions" : `${mentions.length} sources mention`;
  return `${count} it (\`mentions\`, newest first): every one the keyword index found.`;
}
