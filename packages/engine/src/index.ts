/**
 * The engine's one door, `@louvain/engine`: everything a configuration, an entry and a surface take from the engine, and
 * nothing else. Importing it opens nothing and reads nothing from disk: an entry opens its store (`openStore`) and
 * builds its engine (`createEngine`), and nothing this door reaches does I/O while it loads.
 */

export { itemLine, summaryLines } from "./cli/ingest-report.js";
export { NoKeywordIndex, PASSES, reindexKeywords } from "./cli/reindex.js";
// Search from a terminal: its arguments, its lines.
export { SEARCH_USAGE, type SearchArgs, searchArgs } from "./cli/search-args.js";
export { type SearchLineHit, searchLine } from "./cli/search-line.js";
export { counted, printable } from "./cli/terminal-text.js";
export { databaseUrl, storeSettings } from "./config/engine.js";
export { departures, type Settings, settingsOf } from "./config/settings.js";
// The engine, the store it runs on, its settings and its host.
export { createEngine, type Engine, type EngineParts } from "./engine.js";
export { embedderFor } from "./host/embedder.js";
export { openHost } from "./host/standalone.js";
export { ingestFrom } from "./ingest/ingest.js";
export { IngestRefused, OriginRefused } from "./ingest/ownership.js";
export { IngestSourceRefused, openSource, sourceNamed } from "./ingest/sources/index.js";
export { figuresRetriever } from "./plugins/retriever-figures/index.js";
export { keywordRetriever } from "./plugins/retriever-keyword/index.js";
export { vectorRetriever } from "./plugins/retriever-vector/index.js";
// The shipped plugins a configuration names: sources, retrievers and the MCP surface.
export { folder } from "./plugins/source-folder/index.js";
export { records } from "./plugins/source-records/index.js";
export { mcp } from "./plugins/surface-mcp/index.js";
// Ingest: the sources, their file readers, the run and what it prints.
export { fileReaderLane } from "./readers/index.js";
export { IngestDoorRefused, ingestDoor } from "./server/ingest-route.js";
// Serving: the tool server, its HTTP door, its routes, and the tools it serves.
export { ServerRefused, startToolServer } from "./server/main.js";
export type { ToolResult } from "./server/protocol.js";
export { RouteClash } from "./server/routes.js";
export { serve } from "./server/serve.js";
export { openSearch, poolOf } from "./server/tools/run.js";
export { openStore } from "./store/pool.js";
