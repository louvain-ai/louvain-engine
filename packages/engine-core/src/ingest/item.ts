import { z } from "zod";

/**
 * One item as every ingest source emits it: a key, then its text or a file to read, or the removal of the key. An
 * unknown field is refused rather than ignored, so a misspelt `tilte` is said, not loaded untitled. What the engine
 * then accepts of it is the engine's to decide (`ingest/check-item.ts`).
 */

const KINDS = ["document", "message", "record"] as const;
export type ItemKind = (typeof KINDS)[number];

/** How much of an item's date its source knows: all of it (`instant`, the default), a day, a month, a year, or none. */
const PRECISIONS = ["instant", "day", "month", "year", "unknown"] as const;
export type ItemPrecision = (typeof PRECISIONS)[number];

/** The most text one item carries: a longer document is sent as several items. */
export const MAX_ITEM_TEXT_CHARS = 2_000_000;

const name = (max: number) => z.string().trim().min(1).max(max);
/** An instant with any offset (`+00:00`, `Z`, `+02:00`), kept in UTC so one moment is always written one way. */
const instant = z.iso.datetime({ offset: true }).transform((at) => new Date(at).toISOString());

const ItemFields = z.strictObject({
  /** The same key is the same document across edits, so it is taken exactly as written. */
  key: z.string().min(1).max(1000),
  text: z.string().max(MAX_ITEM_TEXT_CHARS).optional(),
  /** A path read through the file readers, inside the folder the host allows. */
  file: name(4096).optional(),
  title: z.string().max(1000).optional(),
  kind: z.enum(KINDS).optional(),
  /** A folder inside the collection: a file's directory, a channel, a project. */
  container: name(500).optional(),
  /** When it was written or happened. */
  date: instant.optional(),
  precision: z.enum(PRECISIONS).optional(),
  /** When the source last changed it. */
  updated: instant.optional(),
  author: name(200).optional(),
  url: z
    .url({ protocol: /^https?$/ })
    .max(4096)
    .optional(),
  /** Where it came from (a wiki, a tracker): the app the document shows as. */
  app: z.string().max(60).optional(),
  /** The source's own fingerprint of this version; without one, the engine hashes the item. */
  revision: name(200).optional(),
  removed: z.literal(true).optional(),
});

type Meta = Omit<z.infer<typeof ItemFields>, "key" | "text" | "file" | "removed">;

export type IngestItem =
  | ({ key: string; text: string; file?: never; removed?: never } & Meta)
  | ({ key: string; file: string; text?: never; removed?: never } & Meta)
  | { key: string; removed: true };

/** What a source could not make into an item, where, and the key it would have had when it knows one. */
export type ItemProblem = { problem: string; at: string; key?: string };

export const IngestItemSchema = ItemFields.superRefine((item, ctx) => {
  const carries = [item.text, item.file].filter((c) => c !== undefined).length;
  const message = item.removed
    ? "a removed item carries no text or file"
    : "an item needs exactly one of text or file";
  if (carries !== (item.removed ? 0 : 1))
    ctx.addIssue({ code: "custom", path: [item.removed ? "removed" : "text"], message });
}).transform((item) => item as IngestItem);

/**
 * A value as an item, or the first way it is not one, as a sentence naming the field and placed `at` where the source
 * found it (a line or an item of a request), with the item's key when it names one. What a source yields; the engine then applies
 * its own rules to every item, whoever wrote the source.
 */
export function itemOf(value: unknown, where: string): IngestItem | ItemProblem {
  const key = (value as { key?: unknown } | null)?.key;
  const at = typeof key === "string" && key ? `${where} (${key})` : where;
  const parsed = IngestItemSchema.safeParse(value);
  if (parsed.success) return parsed.data;
  const issue = parsed.error.issues[0];
  if (issue?.code === "unrecognized_keys")
    return { at, problem: `unknown field ${issue.keys.map((k) => `"${k}"`).join(", ")}` };
  const field = issue?.path.length ? `${issue.path.join(".")}: ` : "";
  return { at, problem: `${field}${issue?.message ?? "not an item"}` };
}
