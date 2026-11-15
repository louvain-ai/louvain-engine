import { runTable } from "./search-table.js";

/** THE SEARCH RESULTS TABLE's `no-keyword-index` rows (`search-table.ts`), with no keyword index configured: the keyword leg is Postgres's own full-text search. A process of its own, since the engine reads its settings once. */
runTable("no-keyword-index");
