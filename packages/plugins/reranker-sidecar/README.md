# reranker-sidecar

The local reranker: an open-weights cross-encoder that reads the search and each candidate passage together and scores
how well the passage answers it, from 0 to 1. It runs in the rerank sidecar on your own
machine; nothing leaves the machine.

```ts
// engine.config.ts
import { defineEngine } from "@louvain/engine-core";
import { sidecar } from "@louvain/reranker-sidecar";

export default defineEngine({ reranker: sidecar({ url: "http://localhost:8096", timeoutMs: 30_000 }) });
```

Settings: `url` (required), `model` (default `BAAI/bge-reranker-v2-m3`), `timeoutMs` (default 4000, at least 500),
`blend` (how much of the order is the reranker's, 0 to 1; the shipped model's own when left out) and `token` (the
sidecars' bearer, `LOUVAIN_SIDECAR_TOKEN` by default). `./engine up` builds and starts the sidecar with the model named
here.

The shipped model, `BAAI/bge-reranker-v2-m3` (Apache-2.0), is pinned in `src/models.ts` with its hub commit, its
cut-off (0.5: a document it scores at or above that is a match) and its blend (1: its order alone). It is a
large download, and on a CPU scoring ten passages takes many seconds, so give it a GPU (the
sidecar uses Metal or CUDA when it runs outside a container) or a `timeoutMs` to match. Another cross-encoder runs by
its hub name, its scores shown, with no cut-off.

What it is good at, and what it is not: it puts the answer to a question asked in other words first far more often
than the engine alone does, and it scores a passage that uses the search's own words very high. It scores an answer
worded differently from its question near zero, as low as a word no document holds, so its score is never a filter:
it adds a match and never hides one.

The sidecar answers a raw score per text, which this plugin squashes into [0, 1] with the logistic function, and names
its model: a sidecar running another model than the one configured is a failure, never scores. A sidecar that does not
answer is a named failure too, and the search is then ranked without it and says so (`degraded: ["rerank:documents"]`).
