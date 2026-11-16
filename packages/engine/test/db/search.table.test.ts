import { runTable } from "./search-table.js";

/** The search results table's `keyword-index` rows (`search-table.ts`), with the keyword index running, as the open stack runs it. A process of its own, since the engine reads its settings once. */
runTable("keyword-index");
