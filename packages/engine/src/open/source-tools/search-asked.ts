import { excludedOf } from "./search-exclude.js";
import { asOf, str } from "./tool-helpers.js";

/**
 * A search's arguments, read once into the shape every step takes. A schema check confirms a value's type but keeps
 * its spelling, and some callers send arguments no schema has checked, so the reading here is the whole one: text
 * trimmed, a blank filter absent, a date in ISO form or none, the excluded ids capped.
 */
export type SearchAsked = {
  query: string;
  question: string | undefined;
  mode: "hybrid" | "keyword";
  app: string | undefined;
  after: string | undefined;
  before: string | undefined;
  /** The moment the search reads as of, or undefined for now. */
  at: string | undefined;
  excluded: Set<string>;
};

/** Reads a search's arguments once. */
export function searchAskedOf(args: Record<string, unknown>): SearchAsked {
  return {
    query: str(args.query),
    question: str(args.question) || undefined,
    mode: args.mode === "keyword" ? "keyword" : "hybrid",
    app: str(args.app) || undefined,
    after: str(args.after) || undefined,
    before: str(args.before) || undefined,
    at: asOf(args.asOf),
    excluded: excludedOf(args),
  };
}
