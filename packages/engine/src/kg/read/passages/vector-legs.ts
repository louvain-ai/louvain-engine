/** What a vector read takes. */

import type { AddedFilters } from "../../../sources/filter-seam.js";
import type { Reader } from "../fence.js";
import type { PassageFilters } from "../passages-types.js";
import type { VectorSpace } from "../space.js";

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
