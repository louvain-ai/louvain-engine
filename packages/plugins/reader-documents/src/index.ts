import { extractText, readableExtensions } from "@louvain/doctext";
import { definePlugin } from "@louvain/engine-core";
import { z } from "zod";

/** Every extension doctext reads, lower case, without the dot. */
const READS = readableExtensions().map((e) => e.replace(/^\./, "")) as [string, ...string[]];

/**
 * The general file reader: PDF, the office and OpenDocument formats, EPUB, RTF, HTML, CSV, mail, calendars, subtitles
 * and plain text, through `@louvain/doctext`. It is a `fallback` for every extension it claims, so a specific reader of
 * the same format wins, and it keeps its own bounds (pages, archive members, a deadline) besides the engine's.
 * `extensions` narrows what it claims to some of the formats it reads.
 */
export const documents = definePlugin({
  kind: "fileReader",
  name: "documents",
  settings: z.object({ extensions: z.array(z.enum(READS)).default([...READS]) }),
  create: ({ extensions }) => ({
    name: "documents",
    claims: { extensions: [...new Set(extensions)], rank: "fallback" },
    read: async (bytes, fileName) => {
      const doc = await extractText(bytes, { filename: fileName });
      if (doc.reason) return { refused: doc.reason };
      const pages = typeof doc.meta.pages === "number" ? doc.meta.pages : undefined;
      return pages === undefined ? { text: doc.text } : { text: doc.text, pages };
    },
  }),
});
