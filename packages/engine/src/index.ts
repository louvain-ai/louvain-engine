/**
 * The engine's one door, `@louvain/engine`: everything a configuration, an entry and a surface take from the engine, and
 * nothing else. Importing it opens nothing and reads nothing from disk: an entry opens its store (`openStore`) and
 * builds its engine (`createEngine`), and nothing this door reaches does I/O while it loads.
 */

export { databaseUrl, storeSettings } from "./config/engine.js";
export { departures, type Settings, settingsOf } from "./config/settings.js";
// The engine, the store it runs on, its settings and its host.
export { createEngine, type Engine, type EngineParts } from "./engine.js";
export { openHost } from "./kg/read/open-readable-set.js";
export { embedderFor } from "./open/embedder.js";
// Ingest: the sources, their file readers, the run and what it prints.
export { fileReaderLane } from "./open/file-readers/index.js";
export { IngestRefused, OriginRefused } from "./open/ingest/ownership.js";
export { ingestFrom } from "./open/ingest/run.js";
export { itemLine, summaryLines } from "./open/ingest/terminal.js";
export { IngestDoorRefused, ingestDoor } from "./open/ingest-http.js";
export { IngestSourceRefused, openSource, sourceNamed } from "./open/ingest-sources/index.js";
export type { ToolResult } from "./open/mcp-protocol.js";

// Serving: the tool server, its HTTP door, its routes, and the tools it serves.
export { ServerRefused, startToolServer } from "./open/mcp-server.js";
export { openSearch, poolOf } from "./open/mcp-tools.js";
export { NoKeywordIndex, PASSES, reindexKeywords } from "./open/reindex.js";
export { RouteClash } from "./open/routes.js";
// Search from a terminal: its arguments, its lines.
export { SEARCH_USAGE, type SearchArgs, searchArgs } from "./open/search-args.js";
export { type SearchLineHit, searchLine } from "./open/search-line.js";
export { serve } from "./open/serve.js";
export { counted, printable } from "./open/terminal-text.js";
export { figuresRetriever } from "./plugins/retriever-figures/index.js";
export { keywordRetriever } from "./plugins/retriever-keyword/index.js";
export { vectorRetriever } from "./plugins/retriever-vector/index.js";
// The shipped plugins a configuration names: sources, retrievers and the MCP surface.
export { folder } from "./plugins/source-folder/index.js";
export { records } from "./plugins/source-records/index.js";
export { mcp } from "./plugins/surface-mcp/index.js";
export { openStore } from "./store.js";
