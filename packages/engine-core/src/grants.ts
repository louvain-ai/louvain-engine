/**
 * Readers and their grants. A reader is a name a token reads as; a grant is the collections that reader may read. The
 * engine's own token reads as the default reader, who reads every collection and takes no grant. A reader no grant
 * names reads nothing: the absence of a grant is never a wider read.
 */
import { z } from "zod";
import { DEFAULT_READER } from "./caller.js";
import { CollectionNameSchema } from "./ingest/source.js";
import { refuse } from "./plugins/plugin.js";

/** A reader's name: kept as a file name and as an id exactly as written, so one alphabet, and never the default's. */
export const ReaderNameSchema = z
  .string()
  .regex(
    /^[a-z0-9][a-z0-9_-]{0,63}$/,
    "a reader's name is lower-case letters, digits, dashes and underscores, at most 64, starting with a letter or digit",
  )
  .refine((name) => name !== DEFAULT_READER, {
    message: `"${DEFAULT_READER}" is the default reader, who reads every collection and takes no grant`,
  });

/** Which collections each named reader may read: `{ alice: ["handbook", "desk"] }`. */
export type Grants = Readonly<Record<string, readonly string[]>>;

const CollectionsSchema = z.array(CollectionNameSchema);

/** The configuration's grants, checked: every key a reader's name and every value a list of collections' names. */
export function grantsOf(value: Grants): Grants {
  const checked = Object.entries(value).map(([reader, collections]) => {
    const name = ReaderNameSchema.safeParse(reader);
    if (!name.success)
      refuse(`the configuration's grants name "${reader}": ${name.error.issues[0]?.message}`);
    const listed = CollectionsSchema.safeParse(collections);
    if (!listed.success)
      refuse(`the configuration's grants for "${reader}": ${listed.error.issues[0]?.message}`);
    return [reader, Object.freeze(listed.data)] as const;
  });
  return Object.freeze(Object.fromEntries(checked));
}
