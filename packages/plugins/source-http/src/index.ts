import { definePlugin, itemOf, source } from "@louvain/engine-core";
import { z } from "zod";

/**
 * The HTTP door: `POST /ingest` on the tool server, `{ "collection": …, "items": [ … ] }`, with its own token. It is
 * open only when a configuration names this source, and the token is no one else's: never the read token agents hold.
 * A request lists only what it sends, so it removes only an item marked `removed`; each item is checked on its own and
 * answered on its own.
 *
 *   sources: [folder(), records(), http({ token: process.env.LOUVAIN_ENGINE_INGEST_TOKEN })]
 */

/** The most items one request carries: a page of work a request can finish well inside its deadline. */
const MAX_REQUEST_ITEMS = 500;

const DoorSettings = z.object({
  token: z
    .string({ error: "the ingest door opens only with its own token: http({ token: … })" })
    .trim()
    .min(32, "the ingest door's token is at least 32 characters"),
});

const Request = z.strictObject({
  collection: z.string(),
  items: z.array(z.unknown()).min(1).max(MAX_REQUEST_ITEMS),
});

export const http = definePlugin({
  kind: "source",
  name: "http",
  settings: DoorSettings,
  create: ({ token }) =>
    source({
      request: Request,
      door: { token },
      open: ({ collection, items }) => ({
        collection,
        origin: "http",
        lists: "some",
        items: async function* () {
          for (const [i, value] of items.entries()) yield itemOf(value, `item ${i + 1}`);
        },
        complete: () => true,
      }),
    }),
});
