import type { GeneratedBy } from "@louvain/engine-core";
import type { Scope } from "./read-core.js";

/**
 * What reading a source needs from its build, handed to its reads in their context (`ReadHooks.detail`): what a saved
 * file's id names, for a build that keeps saved files, and how a generated document names its writer. A read handed
 * none reads `plainDetail`, which keeps none and names nobody.
 */
export type DetailHooks = {
  /** A saved file's id: the document its newest accepted version became, at its current version, fenced by `s`. */
  documentOfFile(s: Scope, id: string): Promise<{ documentId: string; recordId: string } | null>;
  /**
   * A generated document's byline (`SourceSummary.generatedBy`), from what its version stored: how it arrived, the
   * writer it named and the person it wrote for. Null names nobody: the document still says it was generated.
   */
  byline(written: {
    via: string | null;
    agent: string | null;
    onBehalfOf: string | null;
  }): GeneratedBy | null;
};

/** How a generated document names its writer (`DetailHooks.byline`): what a row mapper is handed. */
export type Byline = DetailHooks["byline"];

/** The open build's: no saved files, and no writer named. */
export const plainDetail: DetailHooks = {
  documentOfFile: async () => null,
  byline: () => null,
};
