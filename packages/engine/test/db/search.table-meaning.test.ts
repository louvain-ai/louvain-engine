import { runTable } from "./search-table.js";

/** The search results table's `meaning` rows (`search-table.ts`), with a real embedding sidecar (`LOUVAIN_TEST_EMBEDDINGS_URL`); skipped, and saying so, without one. A process of its own, since the engine reads its settings once. */
runTable("meaning");
