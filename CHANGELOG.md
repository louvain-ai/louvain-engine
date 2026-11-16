# Changelog

Every notable change to this project is recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). Until 1.0.0, a minor version may change a command, a
tool's output or the configuration; its entry says how.

## [Unreleased]

## [0.1.0] - 2026-11-16

The first release: a search engine you run over your own documents, with a permission check on every read and
tools an AI agent calls over MCP.

### Added

- **Install and run.** `./engine up` builds the workspace, makes this install's secrets (never printed), starts
  Postgres with pgvector and the embedding and keyword sidecars with Docker Compose, loads the schema and starts the
  tool server. `ingest`, `search`, `reindex`, `status`, `app`, `logs` and `down` cover the rest of an install's life.
- **Ingest.** Folders, structured records and an HTTP ingest endpoint (off unless configured). Files are read by
  `reader-documents` (PDF, Word, Excel, PowerPoint, OpenDocument, EPUB, RTF, HTML, CSV, mail) and `reader-text`
  (plain text, Markdown), cut into passages, embedded and indexed for keywords. Running it again on a folder adds
  new files, updates changed ones, moves moved ones and removes deleted ones.
- **Search.** Meaning (vector) and words (BM25) searched together and fused, with an optional reranker: a local
  sidecar (`BAAI/bge-reranker-v2-m3`) or Cohere's Rerank API. A search with no matching document says so
  (`matched: false`) rather than returning the nearest noise.
- **A permission fence on every read.** Each read resolves the reader's readable collections first and applies them
  inside every statement it sends, so no document outside them is ranked, counted or returned. This release binds one
  reader, who reads everything loaded: it is not multi-user.
- **Agent tools over MCP**, at `/mcp` behind a bearer token: `louvain_search_sources` (rank documents),
  `louvain_lookup_source` (open the document an identifier names) and `louvain_read_source` (read one document whole,
  in pages).
- **A browser app** at `/app/` for searching and asking over the loaded documents.
- **Configuration as code.** `engine.config.ts` names the plugins and their settings; profiles keep separate
  configurations, each with its own corpus and index. Plugins are plain functions: readers, sources, retrievers,
  rerankers, answerers and surfaces. `./engine plugin new <kind> <name>` writes a new reader, source or reranker
  package with a passing test.
- **Safety limits.** Every file is treated as hostile input (regular files only, 32 MB and 1,000,000 characters per
  file, a 60-second deadline per reader); services listen on `127.0.0.1`; no service starts with a default credential.
- **Documentation** in `docs/`: configuration, ingest, search, permissions, the security model, limits, operations
  and how the benchmark figure was measured.

[Unreleased]: https://github.com/louvain-ai/louvain-engine/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/louvain-ai/louvain-engine/releases/tag/v0.1.0
