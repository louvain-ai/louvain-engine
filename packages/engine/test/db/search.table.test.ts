import { runTable } from "./search-table.js";

/** THE SEARCH RESULTS TABLE's `keyword-index` rows (`search-table.ts`), with the keyword index running, as the open stack runs it. A process of its own, since the engine reads its settings once. */
runTable("keyword-index");
