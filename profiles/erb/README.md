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
- **The embedder:** `Louvain/embed-4b-erb` (Qwen3-Embedding-4B with a merged adapter), last-token pooling, 768
  dimensions, a query instruction. It was tuned on this corpus's documents with synthetic questions, none of the
  benchmark's questions or answers. Its weights are not public yet.
- **The reranker:** Cohere's Rerank API, `rerank-v4.0-pro`, over the first 150 documents, each sent whole up to 16,000
  characters, its order used as it is. **Every search sends up to 150 documents' text to Cohere.**
- **The index:** the corpus loaded as records with no model reading it, less the 976 documents the scored build's
  screening held out of search as instruction-like (`data/held-out.txt`, by dsid; none is an answer document for any of
  the 100 questions). `--keep-held-out` loads them.

## Running it

You need Docker, Node and Python, and `ANTHROPIC_API_KEY` and `COHERE_API_KEY` in your environment. Nothing here
holds a key or any of the benchmark's text: `prepare` fetches the evaluator at its commit and the corpus archive, which
it checks by its sha256. **Until the 4B weights are public, these steps index with the engine's default embedder,
which is not the scored configuration, and `check` cannot tell:** the scored index needs the 4B built into the
embedding service's image, and a GPU for its about 3.5 million passages.

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

## What differs

| What | Scored | This build |
|---|---|---|
| The search | our build at `fb9af3c97` | this build's search: its fusion, and keyword tiers on |
| The keyword service | `apps/nlp/bm25.py` at `e3816ceeac` (the `exact` field, `EXACT_BOOST=2`, `VARIANTS=on`, the English stemmer) | this build's analyzer; the Compose file sets neither boost nor variants |
| Search results | our build's fields (`louvainUrl`, `app`, `url`) | this server's fields (`container`, `kind`); the relevance split turned off |
| Arguments | the scored schema's `app`, `space`, `client`, `knownAt` | not taken: `run.ts` removes and counts them. In v4b `app` was a no-op (every listed document had the same app) and `client` came once |
| Index vectors | the passage's text only | the passage's text searched; its context's vector also written, and not read |
| The embedder | the 4B, float16 index, float32 queries | the service's model is a build argument of its image; float32 on both sides |
| A mail's header and thread | kept, so a read listed the thread | the same text; no header or thread kept |
| The agent | our build's harness | `run/agent/`, the same loop reduced to the scored flags, until the engine has its own |
