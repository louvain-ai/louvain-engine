# reranker-cohere

A third-party reranker: Cohere's Rerank API. The search and each candidate passage go to Cohere (or a gateway serving the
same shape, named by its full rerank URL), and a relevance from 0 to 1 per passage comes back.

```ts
// engine.config.ts
import { defineEngine } from "@louvain/engine-core";
import { cohere } from "@louvain/reranker-cohere";

export default defineEngine({ reranker: cohere({ model: "rerank-v3.5" }) });
```

Settings: `model` (default `rerank-v3.5`), `url` (default `https://api.cohere.com`), `timeoutMs` (default 4000) and
`apiKey`, read from `COHERE_API_KEY` when the configuration passes none, so the key never has to be written into a file.
With no key the start stops in one sentence. It spends your own key, and the open engine meters nothing: no call is counted or capped
on its side, so set any limit you want on Cohere's.

This model has no cut-off set, so the page shows each document's `relevance` and decides what
matches by its other signals (the exact document, its words, its meaning). A refusal or a timeout is a named failure,
and the search is then ranked without it and says so.
