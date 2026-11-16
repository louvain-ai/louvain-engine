import type { SourceSearch } from "@louvain/engine-core";
import type { PendingQuery, Row } from "postgres";
import type { ReadContext } from "../kg/read/fence.js";
import type { Owner } from "./read-core.js";
import type { SearchInput } from "./search-input.js";

type Fragment = PendingQuery<Row[]>;

/**
 * A second matcher's words over the listing, where a build keeps one in its database: whether the listing's `r` (the
 * current revision) holds the words (`matches`, true where there are none), the row's excerpt for them (`excerpt`, a
 * column named `excerpt`), the column and the rank a page by relevance orders by (`column`, `rank`), and the whole
 * listing with words (`listing`: words and meaning). The open build has none: its keyword index answers a listing's
 * words (`read-index-listing.ts`), and a listing without words names none.
 */
export type ListingWords = {
  matches(s: { orgId: string; containers: string[] }, q: string): Fragment;
  excerpt(q: string): Fragment;
  column(): Fragment;
  rank(q: string): Fragment;
  listing(
    context: ReadContext,
    owner: Owner,
    input: SearchInput,
    embed: (query: string) => Promise<number[] | null>,
  ): Promise<SourceSearch>;
};
