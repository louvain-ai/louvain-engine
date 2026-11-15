import { createReadStream, existsSync } from "node:fs";
import { basename, extname, resolve } from "node:path";
import {
  definePlugin,
  type IngestItem,
  type ItemProblem,
  itemOf,
  source,
} from "@louvain/engine-core";
import { z } from "zod";

/**
 * A records file: one JSON item a line, from a file or standard input (`-`). It is read a line at a time, and a line
 * past the bound is refused while it is read, so no file or line is held whole. A line that is not an item is
 * reported by its number and the rest go on. It removes only a line `{"key": …, "removed": true}`.
 */

/** The longest line read: an item's longest text, with room for its fields. */
const MAX_LINE_CHARS = 2_100_000;

const RecordsRequest = z
  .object({
    records: z
      .string()
      .min(1)
      .describe("the JSON Lines file to read, one item a line; - reads standard input"),
    collection: z
      .string()
      .optional()
      .describe("the collection's name; the file's own name by default"),
  })
  .refine((s) => s.records === "-" || existsSync(s.records), {
    path: ["records"],
    error: (issue) =>
      `${String((issue.input as { records?: unknown }).records)} is not a file that exists`,
  })
  .refine((s) => s.records !== "-" || s.collection, {
    path: ["collection"],
    message: "records read from standard input need a collection named",
  });

/** `./engine ingest records --records <file | -> [--collection <name>]`. */
export const records = definePlugin({
  kind: "source",
  name: "records",
  create: () =>
    source({
      request: RecordsRequest,
      open: ({ records, collection }) => ({
        collection: collection ?? basename(records, extname(records)),
        origin: records === "-" ? "standard input" : resolve(records),
        lists: "some",
        items: () =>
          items(
            records === "-" ? process.stdin.setEncoding("utf8") : createReadStream(records, "utf8"),
          ),
        complete: () => true,
      }),
    }),
});

async function* items(input: NodeJS.ReadableStream): AsyncGenerator<IngestItem | ItemProblem> {
  let n = 0;
  for await (const line of lines(input)) {
    n += 1;
    const at = `line ${n}`;
    if (line === null) yield { at, problem: `longer than ${MAX_LINE_CHARS} characters` };
    else if (line.trim()) yield parsed(line, at);
  }
}

function parsed(line: string, at: string): IngestItem | ItemProblem {
  try {
    return itemOf(JSON.parse(line), at);
  } catch {
    // swallowed: the line is reported by its number; the file goes on.
    return { at, problem: "not JSON" };
  }
}

/** Each line, or null for one past the bound, whose characters are dropped as they arrive. */
async function* lines(input: NodeJS.ReadableStream): AsyncGenerator<string | null> {
  let line = "";
  let over = false;
  for await (const chunk of input) {
    const parts = String(chunk).split("\n");
    for (const [i, part] of parts.entries()) {
      if (!over) line += part;
      if (line.length > MAX_LINE_CHARS) [line, over] = ["", true];
      if (i === parts.length - 1) break;
      yield over ? null : line.replace(/\r$/, "");
      [line, over] = ["", false];
    }
  }
  if (over) yield null;
  else if (line) yield line.replace(/\r$/, "");
}
