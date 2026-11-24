import type { SourceSummary } from "@louvain/engine-core";
import type { PendingQuery, Row } from "postgres";
import type { Queryable } from "../../store/sql.js";
import type { ContainerSetShape } from "../fenced.js";
import type { Scope, SourceRow } from "./core.js";
import type { SearchInput } from "./input.js";
import type { Narrow } from "./narrow.js";
import type { ListingWords } from "./words-seam.js";

type Fragment = PendingQuery<Row[]>;

/** The reader a predicate narrows for: its org and the containers its fence admits. */
type Reader = { orgId: string; containers: string[] };

/** What a page's row names beside it: its other readable copies, and a series' other occurrences. */
type BesideRow = {
  copies?: SourceSummary[];
  occurrences?: SourceSummary[];
  occurrencesBounded?: true;
};

/** An identifier a record names, and the participant roles it may hold (`null`: any). */
export type Named = { orgId: string; value: Fragment; roles: string[] | null };

/**
 * The app a listing row shows as (`shown`, over `r` and `d`), and as a filter or a facet reads it (`filtered`). Absent
 * (`AddedFilters.app` null): the service its presentation names, else its connector's declared app, else the connector.
 */
export type ShownApp = { shown(): Fragment; filtered(): Fragment };

/**
 * Predicates an application adds after the fence, handed to its reads in their context (`ReadHooks.filters`) and by a
 * read to each fragment it builds; a write that names a record's app reads `app` from its own hooks (`writes.ts`).
 * Each is a boolean expression the open filters AND (a participant: OR beside the record's actor) inside a statement
 * whose fence already holds, so it only narrows what the reader may read; what a page names beside its rows is read
 * under the same fence. A read handed none reads `noAddedFilters`: a filter member that is null refuses the filter that
 * needs it, a grouping member that is null adds nothing to the statement, a `narrow` keeps nothing, and nothing is
 * named beside a row.
 */
export type AddedFilters = {
  /** Only what `principal` marked, over the listing's `d` (document) and `ce` (its current event). */
  markedBy: ((s: Reader, principal: string) => Fragment) | null;
  /** Whether `e` (an `event_log` row) names this identifier as a participant; null: only its actor is matched. */
  participant: ((sql: Queryable, named: Named) => Fragment) | null;
  /**
   * Who sent a message, over the listing's `e` (its event) and `r` (its revision), for `principal`: `mine`, sent by one
   * of their own identities or addresses; `told`, a message whose sender the reader can be told from at all (a
   * connector they hold an identity on, or mail where they have an address). Never by a display name. Null: a build
   * that knows no one's identities, and `direction` is refused.
   */
  sentBy:
    | ((sql: Queryable, orgId: string, principal: string) => { mine: Fragment; told: Fragment })
    | null;
  /** Whether `e` (an `event_log` row) carries one of these genres. */
  genreIn: ((sql: Queryable, orgId: string, genres: string[]) => Fragment) | null;
  /** Whether `e` (the event) and `r` (its revision) are what an arrivals view counts (`SearchInput.news`). */
  arrived: ((sql: Queryable, alias: string, revision: string) => Fragment) | null;
  /** The documents a `narrow` keeps, over the listing's `d` (document), with the read's handle. */
  narrowed(sql: Queryable, s: Reader, n: Narrow): Fragment;
  /** The documents a `narrow` keeps when they are few, read first so a listing need not walk the tenant; else null. */
  narrowedReach(s: Reader, n: Narrow): Promise<string[] | null>;
  /**
   * One document of each group of copies, over the listing's `d`: the one that leads the walk among those readable.
   * Null: no document has copies, and the listing adds nothing.
   */
  leadsItsCopies:
    | ((orgId: string, containers: string[], shape?: ContainerSetShape) => Fragment)
    | null;
  /**
   * One document of each series among the rows the same query returns, over the listing's `lead_row`. Null: no
   * document has a series, and the listing adds nothing.
   */
  leadsItsSeries: ((s: Scope, input: SearchInput, withApp: boolean) => Fragment) | null;
  /** The app a row shows as and is filtered by (`ShownApp`); null: the open build's own rule. */
  app: ShownApp | null;
  /**
   * When an item happens and whether it took place (`SourceSummary.occursAt`, `held`), over the summary's `r`
   * (revision). Null: no item has either.
   */
  occurrence: { at: Fragment; held: Fragment } | null;
  /**
   * Whether the listing's `d` (document) is a page (`type:page`), when no media type, extension or format decided its
   * type. Null: no document is a page.
   */
  page: Fragment | null;
  /**
   * Whether the listing's row is of the kind `kind=meeting` names, over its `d` (document), `r` (revision) and `e`
   * (event): what the build's recording connectors and their attached files declare, beyond a revision's own kind. A
   * narrowing after the fence, never an access input. Null: only a revision whose own kind is that one.
   */
  meeting: Fragment | null;
  /**
   * What a ranked document order keeps one of (`search/original.ts`): the group a readable summary belongs to. Null: each
   * document is its own.
   */
  groupOf: ((summary: SourceSummary) => string) | null;
  /**
   * The keys of a record change's `presentation` that declare it re-rendered whole, so its newest version stands for
   * the record (`read/passages/filter.ts`, the version rule). The open build's: `whole`.
   */
  wholeKeys: readonly string[];
  /** A second matcher's words over the listing (`ListingWords`); null: the build's index answers them. */
  words: ListingWords | null;
  /** What each of a page's rows names beside it: its other readable copies. */
  copiesOf(s: Scope, page: SourceRow[]): Promise<(row: SourceRow) => BesideRow>;
  /** What each of a page's rows names beside it: its series' other readable occurrences. */
  occurrencesOf(s: Scope, page: SourceRow[]): Promise<(row: SourceRow) => BesideRow>;
};

/** A filter this build has nothing to read for: refused with a sentence, never answered unfiltered. */
export class FilterUnsupported extends Error {
  constructor(filter: string) {
    super(`this build has no ${filter} filter: nothing it loads records what that filter reads`);
    this.name = "FilterUnsupported";
  }
}

/**
 * The open build's: no marks, no arrivals view, no participants or genres beyond a record's own actor, a `narrow` keeps
 * nothing, and no document has copies or a series.
 */
export const noAddedFilters: AddedFilters = {
  markedBy: null,
  participant: null,
  sentBy: null,
  genreIn: null,
  arrived: null,
  narrowed: (sql) => sql`false`,
  narrowedReach: async () => [],
  leadsItsCopies: null,
  leadsItsSeries: null,
  app: null,
  occurrence: null,
  page: null,
  meeting: null,
  groupOf: null,
  wholeKeys: ["whole"],
  words: null,
  copiesOf: async () => () => ({}),
  occurrencesOf: async () => () => ({}),
};
