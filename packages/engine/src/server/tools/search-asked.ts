import { asOf, str } from "./arguments.js";
import { excludedOf } from "./search-exclude.js";

/**
 * A search's arguments, read once into the shape every step takes. A schema check confirms a value's type but keeps
 * its spelling, and some callers send arguments no schema has checked, so the reading here is the whole one: text
 * trimmed, a blank filter absent, a date in ISO form or none, the excluded ids capped.
 */
export type SearchAsked = {
  query: string;
  question: string | undefined;
  mode: "hybrid" | "keyword";
  /** The apps a row may come from, any of them; empty is every app. */
  apps: string[];
  /** Messages the reader sent or received (`SearchInput.direction`); answered by the listing alone. */
  direction: "sent" | "received" | undefined;
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
    apps: strs(args.app),
    direction: directionOf(args.direction),
    after: str(args.after) || undefined,
    before: str(args.before) || undefined,
    at: asOf(args.asOf),
    excluded: excludedOf(args),
  };
}

/** `sent` or `received`, or none: any other value is no direction. */
export const directionOf = (value: unknown): "sent" | "received" | undefined =>
  value === "sent" || value === "received" ? value : undefined;

/** A filter of several values, any of which a row may match: one string or a list, trimmed, blanks and repeats gone, at most 20. */
export const strs = (value: unknown): string[] =>
  [...new Set((Array.isArray(value) ? value : [value]).map((v) => str(v)).filter(Boolean))].slice(
    0,
    20,
  );
