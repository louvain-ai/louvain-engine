import { type ExactTier, openExactTier } from "../../open/source-tools/exact-seam.js";
import {
  openPresentation,
  type SourceToolPresentation,
} from "../../open/source-tools/presentation-seam.js";
import { plainReading, type ReadingExpression } from "../../reading-effective.js";
import { type DetailHooks, plainDetail } from "../../sources/detail-seam.js";
import { type AddedFilters, noAddedFilters } from "../../sources/filter-seam.js";
import type { ReadContext } from "./fence.js";
import { type KeywordIndex, OPEN_KEYWORD_INDEX } from "./keyword-index.js";
import { ONE_SPACE, type VectorSpaces } from "./space.js";

/**
 * WHAT A BUILD ADDS TO THE OPEN READS, carried by the read's context (`ReadContext.hooks`) and asked through `hooksOf`
 * alone. A member a build leaves out is the open build's own answer, so the open build passes none and no read branches
 * on a missing hook. A hook is here because a read asks it; what only a write asks is not. `fence()` never reads them:
 * a hook narrows or presents what the fence admitted, and none decides who may read what.
 */
export type ReadHooks = {
  /** How a record is read (knowledge, reference or excluded), over an `event_log` alias (`reading-effective.ts`). */
  readonly reading?: ReadingExpression;
  /** What a source's detail needs: a saved file's document, a generated document's byline (`detail-seam.ts`). */
  readonly detail?: DetailHooks;
  /** The predicates a search adds after the fence, and what a page names beside a row (`filter-seam.ts`). */
  readonly filters?: AddedFilters;
  /** What the source tools' pages name: connections, app links, the cursor key, clients (`presentation-seam.ts`). */
  readonly presentation?: SourceToolPresentation;
  /** What the keyword index answers, holds and asks (`keyword-index.ts`). */
  readonly keyword?: KeywordIndex;
  /** The vector space a workspace is searched in (`space.ts`). */
  readonly spaces?: VectorSpaces;
  /** What a second matcher adds to the exact tier: key spelling, title keys, whole tokens (`exact-seam.ts`). */
  readonly exact?: ExactTier;
};

/**
 * Each hook of a read's context (or of a write's, `writes.ts`, whose own hooks hold these too): its build's, else the
 * open build's own (the same constant, not a copy).
 */
export function hooksOf(on: Pick<ReadContext, "hooks">): Required<ReadHooks> {
  const hooks = on.hooks;
  return {
    reading: hooks?.reading ?? plainReading,
    detail: hooks?.detail ?? plainDetail,
    filters: hooks?.filters ?? noAddedFilters,
    presentation: hooks?.presentation ?? openPresentation,
    keyword: hooks?.keyword ?? OPEN_KEYWORD_INDEX,
    spaces: hooks?.spaces ?? ONE_SPACE,
    exact: hooks?.exact ?? openExactTier,
  };
}
