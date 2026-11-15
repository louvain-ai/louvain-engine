# The erb-oss profile

`erb-louvain` with an open answerer: Qwen3-235B-A22B-Instruct-2507 through an OpenAI-compatible endpoint, OpenRouter's by default (`ANSWERER_BASE_URL`, `ANSWERER_MODEL`, `ANSWERER_API_KEY`). The reranker is [`Louvain/rerank-4b-erb`](https://huggingface.co/Louvain/rerank-4b-erb) in the rerank sidecar; the judge is still Claude Haiku 5.5. Not scored.

Its run is `profiles/erb`'s, with `npx tsx run.ts <step>` from this folder. `../erb/README.md` ("The other two
profiles") says how to start the reranker, which keys each step reads and the `op run` lines for each step.
