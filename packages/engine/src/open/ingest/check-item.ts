import { type IngestItem, type ItemProblem, itemOf } from "@louvain/engine-core";

/**
 * What the engine accepts of an item, whichever source sent it: the item's shape (`engine-core`), then the engine's
 * own rules, each refused with a sentence naming the field. Text is storable as sent, a key is taken exactly as
 * written, a revision is the tail of an idempotency key, and an app is a slug the engine does not claim.
 */

/** A lone half of a surrogate pair, or a NUL: text no database stores as sent. */
const UNSTORABLE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]|\0/;
/** An app's name, in the pattern a record's presentation takes (`engine-core` `sources.ts`). */
const APP = /^[a-z0-9][a-z0-9-]{0,59}$/;
/** Names an item may not claim: the engine's own, which a reader would take it to come from. */
const RESERVED_APPS = new Set([
  "ingest",
  "http",
  "https",
  "api",
  "import",
  "webhook",
  "file",
  "document",
  "folder",
  "records",
]);

/** The first rule the item breaks, as `[field, sentence]`, or null. */
function brokenRule(item: IngestItem): [string, string] | null {
  for (const [field, value] of Object.entries(item))
    if (typeof value === "string" && UNSTORABLE.test(value))
      return [field, "holds a broken character or a NUL, which cannot be stored"];
  if (item.key !== item.key.trim()) return ["key", "a key may not start or end with whitespace"];
  if ("revision" in item && item.revision?.includes("#"))
    return ["revision", "a revision may not contain #"];
  const app = "app" in item ? item.app : undefined;
  if (app !== undefined && !APP.test(app))
    return ["app", "an app's name is lowercase letters, digits and dashes (helpdesk, team-wiki)"];
  if (app !== undefined && RESERVED_APPS.has(app))
    return ["app", "that name belongs to the engine itself"];
  return null;
}

/** A value as an item, or its first problem as a sentence naming the field, placed `at` where the caller found it. */
export function checkItem(value: unknown, where: string): IngestItem | ItemProblem {
  const item = itemOf(value, where);
  if ("problem" in item) return item;
  const broken = brokenRule(item);
  // Where it is, and which item: a refusal a person can find in what they sent.
  return broken ? { at: `${where} (${item.key})`, problem: `${broken[0]}: ${broken[1]}` } : item;
}
