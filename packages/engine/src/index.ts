/**
 * The engine's shipped plugins, by the package's name: what an `engine.config.ts` names from the engine itself. The
 * folder and records sources and MCP as the tool server's surface; the readers, the rerankers, the HTTP door and the
 * app are packages of their own (`@louvain/reader-documents`, `@louvain/reranker-cohere`, `@louvain/engine-app`, …).
 */
export { folder } from "./plugins/source-folder/index.js";
export { records } from "./plugins/source-records/index.js";
export { mcp } from "./plugins/surface-mcp/index.js";
