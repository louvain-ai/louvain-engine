# retriever-keyword

One leg, `keyword`: passages by the search's words alone, in their own rank order. The fused search reads the vector
leg beside it and joins the two.

**How it reads.** It asks the reading for passages in `keyword` mode, as `retriever-vector` asks in `vector` mode. The
reading runs the engine's keyword read (`kg/read/keyword/`) under its fence, filters and decay: the keyword index, the
tantivy sidecar (`apps/nlp/bm25.py`), carries the fence as must clauses and the read's narrowings where it can hold
them, and every hit is re-read as a passage row under the fence. The engine requires its keyword index: a read the
index cannot answer (down, or a filter it does not carry) has no keyword leg and says so in `degraded`.

This plugin owns none of that: it is the leg, over the reading every retriever is handed (`FencedReading`), and the
engine imports nothing from it. A read that fails is reported in `degraded` and costs this leg only.

It takes no settings. The engine runs it by default, beside the vector and figures retrievers, and fuses their legs.
