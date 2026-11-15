import { authorOf, firstLine, occurredAt, titleOf } from "./fields.js";
import { type Doc, kindOf } from "./source.js";
import { type Part, splitDocument } from "./split.js";

/** One record as `./engine ingest records --records` reads it (the engine's ingest item), one line of the records file. */
export type Item = {
  key: string;
  text: string;
  kind: "message" | "document" | "record";
  container: string;
  date: string;
  precision: "instant" | "day" | "year" | "unknown";
  title?: string;
  author?: string;
};

/** A document as the items it is sent as, dated and attributed as the scored load did it. */
export function documentItems(doc: Doc, raw: string): Item[] {
  const text = raw.includes("\u0000") ? raw.replaceAll("\u0000", "") : raw;
  const title = titleOf(doc.source, text);
  return splitDocument(doc.source, text, doc.dsid).map((part) => ({
    key: part.key,
    text: textOf(part, title ?? firstLine(text)),
    kind: kindOf(doc.source),
    container: doc.container,
    ...dateOf(doc, part),
    ...(title ? { title } : {}),
    ...authored(doc, part, text),
  }));
}

/** A mail is sent as its envelope line, its subject and its body; any other part as its own text. */
function textOf(part: Part, subject: string): string {
  if (part.kind !== "mail") return part.body;
  const { from, to, cc } = part.header;
  const envelope = `Email from ${from}${to ? ` to ${to}` : ""}${cc ? `, copied to ${cc}` : ""}.`;
  return [envelope, part.header.subject ?? subject, part.body].join("\n\n");
}

/** A message's own `Date:` where it parses, else the document's date plus a minute per place in it. */
function dateOf(doc: Doc, part: Part): Pick<Item, "date" | "precision"> {
  const { at, precision } = occurredAt(doc.source, doc.slug);
  if (part.kind === "whole") return { date: at, precision };
  const stated =
    part.kind === "mail" && part.header.date
      ? Date.parse(part.header.date.replace(/ at /, " "))
      : Number.NaN;
  if (!Number.isNaN(stated)) return { date: new Date(stated).toISOString(), precision: "instant" };
  return { date: new Date(Date.parse(at) + part.index * 60_000).toISOString(), precision };
}

function authored(doc: Doc, part: Part, text: string): { author?: string } {
  const author =
    part.kind === "mail"
      ? authorOf("gmail", `From: ${part.header.from}`)
      : part.kind === "chat"
        ? part.speaker.slice(0, 200)
        : authorOf(doc.source, text);
  return author ? { author } : {};
}
