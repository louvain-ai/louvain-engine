# retriever-keyword

One leg, `keyword`: passages by the search's words alone, in their own rank order. The fused search reads the vector
leg beside it and joins the two.

**How it reads.** It asks the reading for passages in `keyword` mode, which runs the keyword leg under the reading's
fence, filters and decay:

- **`keyword-leg.ts`** asks the keyword index first, the tantivy sidecar (`apps/nlp/bm25.py`). The index carries the
  fence as must clauses and the read's narrowings, where it can hold them.
- **`bm25-rows.ts`** turns the index's hits into passage rows, re-stating every filter in SQL.
- **`bm25-tiers.ts`** is the index's client for matching tiers.
- **No second matcher.** The engine requires its keyword index: a read the index cannot answer (down, or a filter it
  does not carry) has no keyword leg and says so in `degraded`. A build that keeps a second matcher binds its own
  Postgres passes behind the keyword index's seam (`kg/read/keyword-index.ts`).

A read that fails is reported in `degraded` and costs this leg only.

It takes no settings. The engine runs it by default, beside the vector and figures retrievers, and fuses their legs.
