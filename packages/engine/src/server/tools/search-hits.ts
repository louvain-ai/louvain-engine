import type { SourceSummary } from "@louvain/engine-core";
import { hooksOf } from "../../read/hooks.js";
import type { Neighbour } from "../../read/passages/search.js";
import { instructionLikeField } from "../../store/quarantine.js";
import { connectionOf } from "./arguments.js";
import { datedAs } from "./dated.js";
import type { LinkTo } from "./presentation.js";

/**
 * Who wrote a source, for a model. A person's source names its author. An agent's is flagged
 * `writtenByAgent` and names which agent and on whose behalf (`generatedBy`) — never its record's author,
 * which for a saved file is Louvain's uploader and never the person, and never the person alone as though
 * they wrote it. `generatedBy` is absent on a file read before it was stamped.
 */
export function authorOf(source: Pick<SourceSummary, "author" | "generated" | "generatedBy">) {
  if (!source.generated) return { author: source.author };
  return {
    author: null,
    writtenByAgent: true as const,
    ...(source.generatedBy ? { generatedBy: source.generatedBy } : {}),
  };
}

/**
 * With no `limit`, the ranked page is the whole head (`searchHeadDepth`), the first `FULL_HITS` in full and the rest
 * compact: the id, title, app, kind, date, author, the matched version, `instructionLike`, a short excerpt of the same
 * passage and its link, never a source URL or connection. A full hit is about a thousand characters, so the compact
 * tail keeps a whole head a third larger rather than three times. A `limit` the caller asks for is returned in full.
 */
export const FULL_HITS = 10;
const COMPACT_EXCERPT = 200;

/** The excerpt's first `COMPACT_EXCERPT` UTF-16 units, never ending inside a surrogate pair. */
function shortExcerpt(excerpt: string): string {
  if (excerpt.length <= COMPACT_EXCERPT) return excerpt;
  const code = excerpt.charCodeAt(COMPACT_EXCERPT - 1);
  const cut = code >= 0xd800 && code <= 0xdbff ? COMPACT_EXCERPT - 1 : COMPACT_EXCERPT;
  return `${excerpt.slice(0, cut)}…`;
}

export type ShownHit = {
  recordId: string;
  summary: SourceSummary;
  excerpt: string;
  conversation?: Neighbour[];
};

/** A hit in full: everything the ranked view says about one document. */
export function fullHit(
  { recordId, summary, excerpt, conversation }: ShownHit,
  names: ReadonlyMap<string, string>,
  linkTo: LinkTo,
) {
  return {
    id: summary.id,
    title: summary.title,
    app: summary.app,
    ...connectionOf(summary.connectionId, names),
    kind: summary.kind,
    ...authorOf(summary),
    ...datedAs("modifiedAt", summary.sourceUpdatedAt, summary.datePrecision),
    excerpt,
    url: summary.url,
    ...linkTo(summary.id, {
      version: summary.versionId === recordId ? null : recordId,
    }),
    // The version that matched, when it is not the one `louvain_read_source` opens by `id` (the current one).
    ...(summary.versionId === recordId ? {} : { matchedVersion: recordId }),
    ...instructionLikeField(summary.instructionLike),
    // A chat message among the first results comes with its conversation: context, not more results.
    ...(conversation
      ? {
          conversation: conversation.map((n) => ({
            sourceId: n.recordId,
            // A linked message is an earlier one this message continues, not one beside it in the channel.
            ...(n.linked ? { linked: true as const } : { offset: n.offset }),
            author: n.generated ? null : n.author,
            ...(n.generated ? { writtenByAgent: true as const } : {}),
            at: n.occurredAt,
            text: n.text,
            ...instructionLikeField(n.instructionLike),
          })),
        }
      : {}),
  };
}

/** A compact hit (past `FULL_HITS` on a default page): what opens it, what it is, what fences it, a short excerpt. */
export function compactHit({ recordId, summary, excerpt }: ShownHit, linkTo: LinkTo) {
  return {
    id: summary.id,
    title: summary.title,
    app: summary.app,
    kind: summary.kind,
    ...authorOf(summary),
    ...datedAs("modifiedAt", summary.sourceUpdatedAt, summary.datePrecision),
    excerpt: shortExcerpt(excerpt),
    // Its link stays (where the build has an app to link to): a cited hit needs it.
    ...linkTo(summary.id, {
      version: summary.versionId === recordId ? null : recordId,
    }),
    ...(summary.versionId === recordId ? {} : { matchedVersion: recordId }),
    ...instructionLikeField(summary.instructionLike),
    compact: true as const,
  };
}

/**
 * What a date window left out. A window compares the document's own date (when it was recorded or changed, or a
 * stand-in), so it can exclude the very document that answers. A first ranked page with a window also runs the same
 * search without it, in parallel, and lists beside the page, compact and marked, the strongest few the window dropped.
 */
export const OUTSIDE_WINDOW_READ = 10;
const OUTSIDE_WINDOW_SHOWN = 5;
export function outsideWindowOf(
  wider: readonly ShownHit[],
  inWindow: ReadonlySet<string>,
  apps: readonly string[],
  clientRecords: ReadonlySet<string> | null | undefined,
): ShownHit[] {
  return wider
    .filter(
      (d) =>
        !inWindow.has(d.summary.id) &&
        (!apps.length || apps.includes(d.summary.app)) &&
        (!clientRecords || clientRecords.has(d.recordId)),
    )
    .slice(0, OUTSIDE_WINDOW_SHOWN);
}

/** What a date window left out, beside the page (`outsideWindowOf`): compact, marked, with the note that says why. */
export function outsideWindowField(outside: readonly ShownHit[], linkTo: LinkTo) {
  return outside.length > 0
    ? {
        outsideWindow: outside.map((d) => ({
          ...compactHit(d, linkTo),
          outsideWindow: true as const,
        })),
        note: `${outside.length} of this search's strongest matches are dated outside the after/before range, or have no known date, and are listed in outsideWindow. A document's date is when it was recorded or last changed, not when the events it describes happened: a question's date is not a reason to leave these out.`,
      }
    : {};
}
