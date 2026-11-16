# services: the engine's sidecars

The Python services the engine's Compose file runs, each its own image:

| Service | File | Image | What it does |
|---|---|---|---|
| Embeddings | `embed.py` | `embed/Dockerfile` | Turns passages and queries into vectors. The query lane and, with `--profile bulk`, a second instance for loading. |
| Keyword index | `bm25.py` | `keyword-index/Dockerfile` | A BM25 index (Tantivy), one entry per document, searched inside the caller's fence. |
| Reranker | `rerank.py` | `rerank/Dockerfile` | A cross-encoder on the CPU that scores each candidate passage against the search. In the Compose profile `rerank`: `./engine up` starts it when engine.config.ts names the `sidecar` reranker, built with the model named there, its weights fetched once at build at a pinned hub commit. |

The reranker answers `POST /rerank` with `{ query, documents: [{ id, text }] }` and returns `{ model, results: [{ id,
score }] }`, best first, each score the model's raw logit; the engine's `reranker-sidecar` plugin squashes it into
[0, 1] and refuses an answer from a model other than the one configured.

## Authentication

`sidecar_auth.py` is shared by every service. When `LOUVAIN_SIDECAR_TOKEN` is set, every request but the health
check must carry it as a bearer token, compared in constant time. The engine's Compose file requires it: a loopback
port is reachable by every local user and by web pages in a browser, so `./engine up` makes a random token for each
install (`.engine/sidecar-token`) and hands it to the sidecars and the engine alike.

## Embeddings (`embed.py`)

The default model is the open `Xenova/bge-base-en-v1.5` (768 dimensions, mean-pooled), baked into the image at build
time. The settings that define the embedding space (the model, its pooling, its width, a Matryoshka cut) are build
arguments of `embed/Dockerfile`, so a space is never inferred at run time. A custom embedding checkpoint is the
operator's choice: an archive fetched at build time and checked against its sha256. `/healthz` reports the model,
pooling and width, and the engine's embedding client reports a sidecar whose space differs from its own.

## Keyword index (`bm25.py`)

One entry per document, with its title and text. The fence is inside the query: a search names the containers the
caller may read, and the index never returns a document outside them. The index lives in the `bm25index` volume;
`/index` adds or replaces a document and `/search` returns ranked document ids. Each workspace has an index of its
own (`bm25_orgs.py`), so another workspace's documents never move a search's ranking or snippets; an index from
before this layout asks for a rebuild, which `./engine up` makes. `bm25.py` is the server and reads the settings;
the index's fields are `bm25_schema.py`, one workspace's index on disk `bm25_store.py`, the fence and `/search`
`bm25_query.py`, `strategy: "last"` `bm25_last.py` and `/list` `bm25_listing.py`.

## One bearer check, in each service

Every service checks the same bearer (`LOUVAIN_SIDECAR_TOKEN`) through `sidecar_auth.py`. It is one module, shipped in
each service's folder so a service runs alone from its own folder (`python bm25.py`, and the test harnesses that start
it with a bare environment). The copies are the same file: the engine's export refuses a snapshot where they differ.

## Tests

`test_*.py` beside each file; run them with the service's requirements installed, for example
`python services/keyword-index/test_bm25.py` (the keyword index's).
