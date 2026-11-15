/**
 * What runs with no engine.config.ts, and what a configuration replaces kind by kind: the two file readers, the folder
 * and records sources (no HTTP door), the tools at `/mcp` and the app at `/app/` as the server's surfaces, no answerer,
 * and the search's three legs (vector, keyword, figures, fused by `search/fused.ts`), which no configuration names yet.
 */

import {
  figuresRetriever,
  folder,
  keywordRetriever,
  mcp,
  records,
  vectorRetriever,
} from "@louvain/engine";
import { app } from "@louvain/engine-app";
import { defineEngine } from "@louvain/engine-core";
import { documents } from "@louvain/reader-documents";
import { text } from "@louvain/reader-text";

export const defaults = {
  ...defineEngine({
    readers: [documents(), text()],
    sources: [folder(), records()],
    surfaces: [mcp(), app()],
  }),
  retriever: [vectorRetriever(), keywordRetriever(), figuresRetriever()],
};
