# The scored benchmark configuration

This profile records the configuration we scored on [EnterpriseRAG-Bench](https://github.com/onyx-dot-app/EnterpriseRAG-Bench),
and holds the script that runs it from this repository. **This build does not reproduce the figure yet:** the scored
runs used our own build's search, tool results and index, and the table at the end lists every known difference.

## The figure

| Run | Corrected | Raw | Guidance |
|---|---|---|---|
| v4b, this profile's default | 91.30 | 91.19 | `text/guidance/prec-v4b.txt` |
| N3′ | 91.32 | 90.47 | `text/guidance/prec-v3.txt` |
| N3 | 89.83 | 90.54 | `text/guidance/prec-v3.txt` |

- **The questions:** 100 of the benchmark's 500, every fifth in file order (`data/sample-ids.txt`, `--sample
  every-fifth`). The guidance, the reading floor and the loop's settings were developed on these same 100.
- **The judge:** the benchmark's own evaluator, unmodified, with Claude Haiku 5.5 as its model. On three answer sets
  it agreed with the board's judge model within about 1.3 points.
- **The spread:** two runs of one configuration differed by about 1.5 points. v4b is one run; N3 and N3′ are two runs
  of one configuration, and N3′ includes six judge rows asked again after a provider outage (86.32 without them).

## What runs

- **The agent:** Claude Sonnet 5.5, adaptive thinking at effort medium, at most 4,000 output tokens a turn, 12 turns
  and 180 s a question; within 45 s of the limit the next turn answers with tools withheld. An answer offered before
  3 distinct searches and 3 documents read is set aside, at most twice. `run/agent/` holds the loop, rule by rule.
- **The tools:** search and read, offered under their scored names with their scored descriptions and input schemas,
  verbatim (`text/tools.json`), as a record of what the model read. They mention tools and fields this server does not
  have. Every search is made as of 2031-01-01, carries the question verbatim, and leaves out what earlier searches
  listed.
- **The embedder:** [`Louvain/embed-4b-erb`](https://huggingface.co/Louvain/embed-4b-erb) at revision
  `7b9a14bfa0e0942bfe70c525fc5261e8f0d56878` (Qwen3-Embedding-4B with a merged adapter), last-token pooling, 768
  dimensions, a query instruction. It was tuned on this corpus's documents with synthetic questions, none of the
  benchmark's questions or answers. Its weights and model card are public on Hugging Face.
- **The reranker:** Cohere's Rerank API, `rerank-v4.0-pro`, over the first 150 documents, each sent whole up to 16,000
  characters, its order used as it is. **Every search sends up to 150 documents' text to Cohere.**
- **The index:** the corpus loaded as records with no model reading it, less the 976 documents the scored build's
  screening held out of search as instruction-like (`data/held-out.txt`, by dsid; none is an answer document for any of
  the 100 questions). `--keep-held-out` loads them.

## Running it

You need Docker, Node and Python, and `ANTHROPIC_API_KEY` and `COHERE_API_KEY` in your environment. Nothing here
holds a key or any of the benchmark's text: `prepare` fetches the evaluator at its commit and the corpus archive, which
it checks by its sha256.

**Every profile indexes and queries with the tuned embedder**, `Louvain/embed-4b-erb` at commit `7b9a14bf…`, served by
the embedding sidecar on its torch backend, which you start yourself before `load`, on a GPU: the corpus is about 3.5
million passages. `./engine up`'s own embedding service keeps the default model and is not called. `up` and `load`
hand `./engine` the model's conventions (its name, last-token pooling, the cut to 768 dimensions and the query
instruction), and `check` and `load` refuse to run unless the service the engine calls reports this model, its pooling,
width and weights digest. Fetch it at its commit, check every file against its digests, and serve it as its model card
says, with the token `up` made for the profile and on a port of its own:

```bash
hf download Louvain/embed-4b-erb --revision 7b9a14bfa0e0942bfe70c525fc5261e8f0d56878 --local-dir embed-4b-erb
(cd embed-4b-erb && shasum -a 256 -c SHA256SUMS)   # model.safetensors is 771b1d5b…
LOUVAIN_EMBEDDING_BACKEND=torch LOUVAIN_EMBEDDING_MODEL=Louvain/embed-4b-erb \
LOUVAIN_EMBEDDING_TORCH_MODEL="$PWD/embed-4b-erb" LOUVAIN_EMBEDDING_MODEL_DIR="$PWD/embed-4b-erb" \
LOUVAIN_EMBEDDING_POOLING=last LOUVAIN_EMBEDDING_MATRYOSHKA=true LOUVAIN_EMBEDDING_DIM=768 \
LOUVAIN_EMBEDDING_MODEL_SHA256=771b1d5b1419e49b588febfc655e469e27ebd3d72031a5a00624f711cade530b \
LOUVAIN_SIDECAR_TOKEN="$(cat .engine/profiles/erb/sidecar-token)" PORT=8098 \
python services/embed/embed.py   # from the engine's root
```

Its Python needs what `apps/nlp/Dockerfile.gpu` installs for it: `services/embed/requirements.txt`'s onnxruntime, torch, and
`transformers==5.17.0`, the version its card names (it brings its own tokenizers and hub client; a 4.x reader embeds
this checkpoint wrong without an error).

Then set `LOUVAIN_EMBEDDINGS_URL=http://localhost:8098` and `LOUVAIN_EMBEDDINGS_BULK_URL=http://localhost:8098` in the
engine's `.env`. For `erb-louvain` or `erb-oss`, read that profile's own token.

```bash
cd profiles/erb
npx tsx run.ts prepare        # the evaluator and the corpus, into this profile's state; the corpus as one records file
npx tsx run.ts up             # ./engine profile set to this profile, then ./engine up (run ./engine down first)
npx tsx run.ts load           # ./engine ingest records --records; the keyword index is written as it loads
npx tsx run.ts check          # one tiny call to each provider, and the tools served, or nothing starts
npx tsx run.ts ask --budget-usd <cap> --price-in <$/M> --price-out <$/M>
npx tsx run.ts judge          # raw and corrected; --rejudge-failed asks again for failed judge rows
npx tsx run.ts ask --dry-run  # the whole loop on a stub model and stub tools: no key, no money
```

`up` makes this the profile every `./engine` command runs (`./engine profile set`): its `engine.config.ts`, with
the scored reranker and search settings, and a stack of its own, so its corpus and index never mix with the root's.
`./engine profile set default` returns to the root once `./engine down` has stopped it. **The cost:** v4b used 18.9 million input tokens over 100 questions (14.6 million read
from the cache, 4.3 million written to it), about 7 turns, 3.4 searches and 3.6 reads a question; `ask` takes your
prices and never assumes them, and stops before a question that could pass `--budget-usd`. Cohere bills a rerank a
search; the judge is billed on top.

## The other two profiles

Two profiles beside this one change one provider each and share everything else: the loop, the tools, the texts, the
question sample and the judge (`run/variants.ts` holds the differences). Neither has been scored.

| Profile | Embedder | Reranker | Answerer |
|---|---|---|---|
| `erb` (this one) | the tuned 4B | Cohere `rerank-v4.0-pro` | Claude Sonnet 5.5 |
| `erb-louvain` | the tuned 4B | `Louvain/rerank-4b-erb`, in the rerank sidecar | Claude Sonnet 5.5 |
| `erb-oss` | the tuned 4B | `Louvain/rerank-4b-erb`, in the rerank sidecar | Qwen3-235B-A22B-Instruct-2507, OpenAI-compatible |

Each keeps its own state and stack, so `prepare` and `load` run once per profile, from its own folder
(`cd profiles/erb-louvain`, then the same steps as above).

**The reranker** is [`Louvain/rerank-4b-erb`](https://huggingface.co/Louvain/rerank-4b-erb) at revision
`d64b19e32cd36c4a055a88d4c7e226e736a4751e`, Qwen3-Reranker-4B with a merged adapter, served by `services/rerank/rerank.py` with its model card's prompt and scored as logit("yes") − logit("no").
`./engine up` does not build it (its image is CPU-only) and says the reranker is not running. Start it yourself after
`up`, on a GPU, with the token `up` made for the profile (`erb-oss` reads its own folder), on a port of its own: `up`
refuses to start while anything holds the port it keeps for its own reranker (`LOUVAIN_RERANK_HOST_PORT`, 8096). Put
`LOUVAIN_RERANK_URL=http://localhost:8097` in the engine's `.env`, so the engine and `check` both call it there. Apple
silicon serves it for `check` and a try, but one search's 150 whole documents took about ten minutes there:

```bash
LOUVAIN_RERANK_KIND=qwen3-reranker LOUVAIN_RERANK_MODEL=Louvain/rerank-4b-erb \
LOUVAIN_RERANK_MODEL_REVISION=d64b19e32cd36c4a055a88d4c7e226e736a4751e LOUVAIN_RERANK_DTYPE=bfloat16 \
LOUVAIN_SIDECAR_TOKEN="$(cat .engine/profiles/erb-louvain/sidecar-token)" PORT=8097 \
python services/rerank/rerank.py     # from the engine's root, with services/rerank/requirements.txt installed
```

The engine refuses its scores if it names another model. Each document goes to it whole up to 8,000 characters, the
length it was tuned and measured at. bfloat16 is the precision its card's table was scored in, and takes about 8 GB; float32, the sidecar's default, removes the
near-ties bfloat16 can order differently by batch.

**The open answerer** is called through any OpenAI-compatible chat-completions endpoint. By default that is
OpenRouter's, `https://openrouter.ai/api/v1`, where the model is `qwen/qwen3-235b-a22b-2507`;
`ANSWERER_BASE_URL` and `ANSWERER_MODEL` point it elsewhere, your own vLLM or SGLang server included (which names the
model `Qwen/Qwen3-235B-A22B-Instruct-2507`), and `ANSWERER_API_KEY` holds its key. Only text and tool calls cross: the
model gets no thinking setting and no cache markers. `ask` still takes your prices; its cache prices assume
Anthropic's ratios, so give the provider's uncached input price.

**The keys**, from the environment as always. With 1Password's CLI, put the references in an env file (each line
`NAME=op://<vault>/<item>/<field>`) and run each step under `op run`, which resolves them for that command only:

```bash
# erb:         ANTHROPIC_API_KEY, COHERE_API_KEY
# erb-louvain: ANTHROPIC_API_KEY (the judge reads it too)
# erb-oss:     ANSWERER_API_KEY, and ANTHROPIC_API_KEY for the judge only
cd profiles/erb-louvain
op run --env-file=../erb-louvain.env -- npx tsx run.ts check
op run --env-file=../erb-louvain.env -- npx tsx run.ts ask --sample every-fifth --budget-usd <cap> --price-in <$/M> --price-out <$/M>
op run --env-file=../erb-louvain.env -- npx tsx run.ts judge
cd ../erb-oss
op run --env-file=../erb-oss.env -- npx tsx run.ts check
op run --env-file=../erb-oss.env -- npx tsx run.ts ask --sample every-fifth --budget-usd <cap> --price-in 0.14 --price-out 0.80
op run --env-file=../erb-oss.env -- npx tsx run.ts judge
```

(OpenRouter's listed price for the model is US$0.14 a million input tokens and US$0.80 output; check yours.)

## What differs

| What | Scored | This build |
|---|---|---|
| The search | our build at `fb9af3c97` | this build's search: its fusion, and keyword tiers on |
| The keyword service | `services/keyword-index/bm25.py` at `e3816ceeac` (the `exact` field, `EXACT_BOOST=2`, `VARIANTS=on`, the English stemmer) | this build's analyzer; the Compose file sets neither boost nor variants |
| Search results | our build's fields (`louvainUrl`, `app`, `url`) | this server's fields (`container`, `kind`); the relevance split turned off |
| Arguments | the scored schema's `app`, `space`, `client`, `knownAt` | not taken: `run.ts` removes and counts them. In v4b `app` was a no-op (every listed document had the same app) and `client` came once |
| Index vectors | the passage's text only | the passage's text searched; its context's vector also written, and not read |
| The embedder | the 4B, float16 index, float32 queries | the 4B served by the sidecar on torch, float32 on both sides |
| A mail's header and thread | kept, so a read listed the thread | the same text; no header or thread kept |
| The agent | our build's harness | `run/agent/`, the same loop reduced to the scored flags, until the engine has its own |
