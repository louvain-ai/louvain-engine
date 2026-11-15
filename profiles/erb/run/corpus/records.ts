import { createWriteStream, readFileSync } from "node:fs";
import { documentItems } from "./items.js";
import { kindOf, walk } from "./source.js";

/**
 * The corpus as one records file, a line an item, with what was written counted. Documents whose dsid is in `heldOut`
 * are left out, as the scored index left them out of search. What the engine's item has no field for is counted too:
 * a mail's header and thread, a channel as a location, a tracker record presented as a document.
 */
export type CorpusCount = {
  documents: number;
  items: number;
  heldOut: number;
  bySource: Record<string, number>;
  notCarried: { mailHeaders: number; chatLocations: number; recordsAsDocuments: number };
};

export async function writeRecords(
  corpusRoot: string,
  out: string,
  heldOut: ReadonlySet<string>,
): Promise<CorpusCount> {
  const count: CorpusCount = {
    documents: 0,
    items: 0,
    heldOut: 0,
    bySource: {},
    notCarried: { mailHeaders: 0, chatLocations: 0, recordsAsDocuments: 0 },
  };
  const file = createWriteStream(out, "utf8");
  for (const doc of walk(corpusRoot)) {
    if (heldOut.has(doc.dsid)) {
      count.heldOut += 1;
      continue;
    }
    const items = documentItems(doc, readFileSync(doc.path, "utf8"));
    count.documents += 1;
    count.bySource[doc.source] = (count.bySource[doc.source] ?? 0) + 1;
    if (doc.source === "gmail") count.notCarried.mailHeaders += items.length;
    if (doc.source === "slack") count.notCarried.chatLocations += items.length;
    if (kindOf(doc.source) === "record") count.notCarried.recordsAsDocuments += 1;
    for (const item of items) {
      count.items += 1;
      if (!file.write(`${JSON.stringify(item)}\n`)) await drained(file);
    }
  }
  await new Promise<void>((done, failed) =>
    file.end((err?: Error | null) => (err ? failed(err) : done())),
  );
  return count;
}

const drained = (file: NodeJS.WritableStream) =>
  new Promise<void>((done) => file.once("drain", () => done()));
