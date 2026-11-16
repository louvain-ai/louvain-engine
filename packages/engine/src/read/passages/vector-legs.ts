/** What a vector read takes. */

import type { Reader } from "../fence.js";
import type { AddedFilters } from "../listing/filter-seam.js";
import type { VectorSpace } from "../vector-space.js";
import type { PassageFilters } from "./types.js";

export type VectorRead = {
  fence: Reader;
  filters: PassageFilters;
  /** The build's filters after the fence, which a record filter reads (`ReadHooks.filters`). */
  added: AddedFilters;
  columns: VectorSpace["columns"];
  /** The query's vector, as a `vector` literal. */
  vector: string;
  limit: number;
};
