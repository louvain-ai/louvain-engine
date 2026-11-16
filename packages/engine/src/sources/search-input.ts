/** What a source listing or search asks for. Every filter narrows inside the reader's fence; none of them widens it. */
import type { FileSearchType } from "@louvain/engine-core";
import type { Queryable } from "../kg/core/sql.js";
import type { AddedFilters } from "./filter-seam.js";
import type { Narrow } from "./narrow.js";
import type { Scope } from "./read-core.js";

/** What a listing or a search asks: the words, the filters, the date window, the page and the mode. */
export type SearchInput = {
  q: string;
  app?: string | undefined;
  /** One connection's sources: two connections of one app are two filters (`facets`). */
  connection?: string | undefined;
  kind?: string | undefined;
  author?: string | undefined;
  /** A file's type (`type:` in the search box): `typeOf` over the shared table in `@louvain/engine-core`. */
  type?: FileSearchType | undefined;
  /**
   * Only what THIS principal marked, by the predicate an application binds (`filter-seam.ts` `markedBy`); a build
   * that binds none refuses it. The caller passes its own principal, never one from a request; a mark grants nothing,
   * and the fence still decides every row.
   */
  starredBy?: string | undefined;
  /**
   * Only the documents a narrowing keeps, by the predicate an application binds (`filter-seam.ts` `narrowed`): who
   * fills it and what it keeps are the application's. A narrowing inside the fence, never a widening; the open build
   * keeps nothing, and nothing in it matches nothing.
   */
  narrow?: Narrow | undefined;
  /** A day (whole days in `timeZone`) or an instant (`…T…Z`, exact): `dateWindow`. */
  after?: string | undefined;
  before?: string | undefined;
  timeZone?: string | undefined;
  /** Only what an arrivals view counts, by the predicate an application binds (`filter-seam.ts` `arrived`). */
  news?: "1" | undefined;
  offset: number;
  /** `skip`: no facet read; the client keeps the ones it has (they do not depend on the app filter). */
  facets?: "skip" | undefined;
  count?: "skip" | undefined; // no count read: the total is what the page read, a floor (`pageTotal`)
  mode?: "hybrid" | "keyword";
  sort?: "relevance" | "newest" | "oldest";
  /**
   * The least cosine similarity a meaning match needs (default 0.62, what Search shows a person). A caller that seeds a
   * model with the hits and has no person to judge them asks for more ("What's changed since this brief?": 0.75).
   */
  semanticFloor?: number | undefined;
  /**
   * A scope (an agent's "this space"): these containers only, INTERSECTED with the owner's readable set —
   * a narrowing, never the fence. A container outside it contributes nothing, so a scope the person cannot
   * read is an empty page, never an error.
   */
  containers?: string[] | undefined;
};

/**
 * One listing: what was asked, the reader's scope, the build's predicates after the fence (`AddedFilters`) and the handle
 * of the read it serves (`sql`), which every fragment of it is written with. A listing's statements and filters take it
 * whole (`read-filter.ts`, `read-listing.ts`).
 */
export type Listing = {
  readonly sql: Queryable;
  readonly s: Scope;
  readonly added: AddedFilters;
  readonly input: SearchInput;
};
