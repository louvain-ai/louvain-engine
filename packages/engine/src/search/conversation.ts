import type { Viewer } from "@louvain/engine-core";
import { environment } from "../config/environment.js";
import type { ReadContext } from "../read/fence.js";
import { passages } from "../read/passages/index.js";
import type { ConversationOptions, SearchedDocument, SearchOptions } from "./document.js";

/**
 * A chat hit is shown with its conversation (`passages.around`): the `k` messages either side of each of the first
 * `hits` documents that is a chat message, at most `maxChars` across them, read under the search's own fence, narrowing
 * and as-of. A message found alone ("I moved it to Thursday") does not say what it answers; the messages beside it put
 * the answer's facts in hand. Ranking is untouched. `LOUVAIN_CHAT_NEIGHBOURS=off` is the kill switch, read per call;
 * on by default.
 *
 * FILL (`LOUVAIN_CHAT_NEIGHBOURS=fill`): a hit an unthreaded message is GHOST-LINKED back from
 * (the caller's `ancestry`, its own ancestry in its container as the build links it, at most 8; none passed, no links) also gets
 * those linked messages, listed first, in
 * the budget the window leaves, under the same fence. Links exist only where the build wrote them, so
 * elsewhere fill is the window. `window` (the default) is unchanged; fill becomes the default only after
 * a judged agent-arm run of window against fill says so.
 *
 * Where the limit is: context beside a hit adds little when the fact's own message does not reach the first few hits,
 * and embedding a message with the messages before it raises its vector rank but not its place: the reranker scores
 * the message's text alone.
 */
const CHAT_NEIGHBOURS = { hits: 5, k: 3, maxChars: 4_000 } as const;
type ChatNeighbours = "off" | "window" | "fill";
export const chatNeighboursMode = (): ChatNeighbours => {
  const v = (environment("LOUVAIN_CHAT_NEIGHBOURS") ?? "").trim().toLowerCase();
  return v === "off" ? "off" : v === "fill" ? "fill" : "window";
};

/** Each of the first chat hits given its conversation, in place; what the read could not do, as degradations. */
export async function withConversations(
  context: ReadContext,
  viewer: Viewer,
  documents: SearchedDocument[],
  opts: SearchOptions,
  told: ConversationOptions = {},
): Promise<string[]> {
  const neighbours = chatNeighboursMode();
  if (neighbours === "off") return [];
  const hits = documents.slice(0, CHAT_NEIGHBOURS.hits).map((d) => d.recordId);
  const linkedBack = told.ancestry;
  // The ancestry is ids to try, nearest first; `passages.around` reads each under the search's own fence.
  const ancestry =
    neighbours === "fill" && linkedBack
      ? new Map(
          await Promise.all(
            hits.map(
              async (id) =>
                [id, (await linkedBack(viewer.orgId, id)).reverse()] as [string, string[]],
            ),
          ),
        )
      : undefined;
  const { around, degraded } = await passages.around(context, viewer, hits, {
    k: CHAT_NEIGHBOURS.k,
    maxChars: CHAT_NEIGHBOURS.maxChars,
    filters: { ...(opts.narrow ?? {}), ...(opts.asOf ? { asOf: opts.asOf } : {}) },
    ...(ancestry ? { ancestry } : {}),
    ...(told.names ? { names: told.names } : {}),
  });
  for (const d of documents) {
    const conversation = around.get(d.recordId);
    if (conversation) d.conversation = conversation;
  }
  return degraded;
}
