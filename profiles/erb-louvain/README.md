# The erb-louvain profile

`erb` with Cohere's reranker swapped for [`Louvain/rerank-4b-erb`](https://huggingface.co/Louvain/rerank-4b-erb), served by the rerank sidecar you start yourself. The answerer is still Claude Sonnet 5.5. Not scored.

Its run is `profiles/erb`'s, with `npx tsx run.ts <step>` from this folder. `../erb/README.md` ("The other two
profiles") says how to start the reranker, which keys each step reads and the `op run` lines for each step.
