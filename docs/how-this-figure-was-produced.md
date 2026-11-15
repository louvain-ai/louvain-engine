# How this figure was produced

**The figure:** EnterpriseRAG-Bench, **91.32%** (preliminary) on the benchmark evaluator's corrected scoring, and
**90.47%** without the correction, for Louvain's scored configuration.

- **The sample:** a 100-question sample we drew from the benchmark's 500 (every fifth question in file order). Prompt
  guidance, the reading floor and the loop settings were developed against these same 100. We developed on 100 of the
  500 and did not tune on the other 400.
- **One run,** answered on 13 November 2026 in two sittings, because a provider outage interrupted the first. No
  question was answered twice.
- **The judge:** the benchmark's own evaluator, unmodified (its judge prompts and its consensus document-correction
  step), with Claude Haiku 5.5 as the judge model. On three answer sets judged by both, Claude Haiku 5.5 and the public
  board's judge model agreed within about 1.3 points, with no consistent sign.
- **Six re-judged rows:** six rows came back with empty reasoning when the judge's provider failed, and scored 0. The
  rule, written before they were asked again, was that no row failed by the outage is kept. Re-judged, five scored 100
  and one 0. Without them the corrected figure is 86.32%.
- **What it is not:** this is our run and our judge; it is not an entry on the benchmark's public board.
- **Repeatability:** another run of the same configuration, the same day, scored 89.83% (90.54% without the
  correction).

## What the scored configuration is

It ran on Louvain's own build, not on this repository's. A profile in `profiles/` records it and runs it from this
repository, and its README lists every known difference; the figure does not reproduce on this build yet:

- **Its tools:** that build's tool descriptions. The profile offers them verbatim; this repository's tool server serves
  its own.
- **Its index:** one bare-text vector per passage. This repository's search also ranks by the bare vector; its loader
  writes a second vector, from each passage's context, that nothing reads.
- **Its screening:** that build held 976 documents whose text reads like instructions to a model out of search. None
  is a document any of the 100 questions is answered from. This repository's engine screens nothing; the profile leaves
  those 976 out of its load.
- **Its retrieval settings** differ from this repository's defaults (below).

## Index

- **The corpus:** the benchmark's own export. You fetch it under its own terms; it is not redistributed. It was
  ingested as records only. **No model reads a document at ingestion.**
- **Embedder:** `Louvain/embed-4b-erb`. This is Qwen3-Embedding-4B, tuned with a LoRA adapter (rank 64) that is merged
  into the weights, on the benchmark corpus's documents with synthetic questions; no benchmark question, answer, or
  label of which document answers a question.
  - **Its weights:** `model.safetensors`, sha256 `771b1d5b1419e49b588febfc655e469e27ebd3d72031a5a00624f711cade530b`.
  - **How it is served:** at 768 dimensions (Matryoshka), with last-token pooling.
  - **The query instruction:** `Instruct: Given a question about a company's work, retrieve the passages that answer it\nQuery: `.
  - **Its model card** says how it was trained.
- **Keyword leg:** the BM25 sidecar (`apps/nlp/bm25.py`). These options are on: best passage per document, titles
  indexed, and the lexical ladder.

## Search

- **Each search ran hybrid retrieval:** vector and BM25 legs, fused, then reranked.
- **The question is passed in:** every search receives the person's question verbatim alongside the agent's query.
- **Reranker:** Cohere's Rerank API, model `rerank-v4.0-pro`, called on Cohere's own endpoint
  (`https://api.cohere.com`, `/v2/rerank`). It reranks the top **150** documents, fed as whole documents of up to
  16,000 characters, so every search sends that text to Cohere. The reranker's order is used as is (blend 1).
  - **About 3.4 rerank calls a question:** one per search.
- **Exclude-seen:** each search after the first leaves out every document an earlier search in the same question
  already listed.

## Agent

- **Model:** Claude Sonnet 5.5 (`claude-sonnet-5-5`), with adaptive thinking at effort **medium** and at most 4,000
  output tokens a turn.
- **Tools:** `louvain_search_sources` and `louvain_read_source`, with that build's descriptions.
  `louvain_lookup_source` was not offered.
- **Limits:**
  - at most **12 turns** and **180 s** a question;
  - once a question is within 45 s of its limit, the next turn must answer, with tools withheld.
- **Reading floor:** an answer offered before 3 distinct searches and 3 documents read is set aside, and the agent is
  told what is still owed. This happens at most twice a question, never on the last two turns.
- **Guidance:** the system prompt is the harness's base instruction (answer only from the tools, cite every source),
  plus the guidance text `prec-v3`, sha256 `5902ecacc9add4be…`. The guidance text is not in this repository; its
  sha256 is given here.
- **Dates:** every search and read is made as of 2031-01-01, a date after the whole corpus, so nothing is hidden for
  being in the future.

## Cost and effort, per question (means over the 100, this run)

- **Agent spend:** about **$0.16** ($16.31 for the 100).
- **Effort:** 3.4 searches, 3.6 reads and 6.7 turns.
- **Judging:** extra, and not included in these figures.

## What varies between runs

Two runs of this exact configuration scored 91.32% and 89.83% corrected, about 1.5 points apart. No change tested so
far is separable from that spread on one run. **Read any single figure with that spread.**
