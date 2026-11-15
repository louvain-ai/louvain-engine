import type { Viewer } from "@louvain/engine-core";
import { bm25Configured } from "../../kg/read/bm25.js";
import { fence, type ReadContext } from "../../kg/read/fence.js";
import { hooksOf } from "../../kg/read/hooks.js";
import { bm25Tiers, type Tiers } from "../../kg/read/keyword/tiers.js";
import { telemetry } from "../../telemetry.js";

/**
 * A WORD NO READABLE DOCUMENT HOLDS IS SEARCHED ANOTHER WAY, AND THE PAGE SAYS SO. The keyword index asks such a word
 * as a clause of the search itself (`kg/read/keyword/tiers.ts`): the last word as the start of a longer one, as Meilisearch and
 * Elasticsearch's `match_bool_prefix` read it, and a word as the held words a typo away from it; one that finds
 * nothing readable even so is left out. The search runs as typed; this names the words, never what they matched, so
 * nothing is said about a document the reader cannot read. One fenced call, where the build's index has tiers.
 */
type Unheld = { from: string; completed?: true; dropped?: true };

/** What a page says it is: whether it matched, its note, and how it was read. */
type Page = { note?: string | null; matched?: boolean; degraded?: readonly string[] };

/**
 * The page as searched: naming each word searched another way, in its note and in `corrected`, and saying it is
 * incomplete when it found nothing while the keyword index was down (`indexDown`).
 */
type Said = <P extends Page>(page: P) => P | (P & { corrected: Unheld[] });

export async function unheldWords(
  context: ReadContext,
  owner: Viewer,
  query: string,
  scope: readonly string[] | undefined,
): Promise<Said> {
  const tiers =
    query.trim() && hooksOf(context).keyword.tiers && bm25Configured()
      ? await tiersOrNone(context, owner, query, scope)
      : null;
  const unheld = tiers ? unheldIn(tiers) : [];
  return (page) => (unheld.length === 0 ? indexDown(page) : saidOn(indexDown(page), unheld));
}

/** The search's tiers under the reader's fence, narrowed to its scope; none when the index cannot answer. */
async function tiersOrNone(
  context: ReadContext,
  owner: Viewer,
  query: string,
  scope: readonly string[] | undefined,
) {
  const reader = await fence(context, owner);
  const containers = reader?.containers.filter((c) => !scope || scope.includes(c)) ?? [];
  if (!reader || containers.length === 0) return null;
  try {
    return await bm25Tiers({ orgId: reader.orgId, containers, query, limit: 1 });
  } catch (err) {
    telemetry.error("search.unheld_words", err, {});
    return null;
  }
}

const unheldIn = (tiers: Tiers): Unheld[] => [
  ...tiers.completed.map((from) => ({ from, completed: true as const })),
  ...tiers.corrected.map((from) => ({ from })),
  ...tiers.dropped.map((from) => ({ from, dropped: true as const })),
];

function saidOn<P extends { note?: string | null }>(page: P, unheld: Unheld[]) {
  const said = unheld.map(
    (u) =>
      `No document holds "${u.from}"; searched ${u.completed ? "for what begins with it" : u.dropped ? "without it" : "for words like it"}.`,
  );
  const note = [...said, ...(page.note ? [page.note] : [])].join(" ");
  return { ...page, corrected: unheld, note };
}

/** When the keyword index could not be read: nothing was searched by its words, so nothing is said about them. */
const INDEX_DOWN =
  "Nothing was found, and the search is incomplete: the keyword index could not be read, so no document was searched by its words.";

/**
 * A PAGE THAT FOUND NOTHING WHILE ITS KEYWORD INDEX WAS DOWN SAYS SO (`degraded` `keyword:index`), never that no
 * document holds the search's words or what it names: nothing was asked of them.
 */
const indexDown = <P extends Page>(page: P): P =>
  page.matched === false && page.degraded?.includes("keyword:index")
    ? { ...page, note: INDEX_DOWN }
    : page;
