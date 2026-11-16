# At scale

**In short:** on a six-core desktop CPU, 10,000 passages load in 51 minutes with the default embedder and search in
under 250 ms at the 95th percentile. 100,000 passages, loaded without the embedder, take 32 minutes and 1.6 GB of disk,
and a keyword search takes about 0.6 s. The embedder sets the load speed. Each row below was measured; no row is
estimated from another.

## The machine

An Intel Core i5-8500B at 3.0 GHz, 6 cores, 24 GB of memory, in a Linux virtual machine with Node 22 and Docker 29.
The stack is the one `./engine up` starts, in its default configuration: the CPU embedder, the keyword index and
Postgres, with no reranker and no answerer. Nothing in the run is paid for and nothing leaves the machine.

## The corpus and the queries

The corpus is made up from a fixed seed (`packages/engine/scripts/scale-bench/corpus.ts`): one document per passage,
each with a title, a key and a paragraph drawn from a seeded word list. 50 picks at random choose the targets (a document picked twice counts
once, so 10,000 has 49), and each target gets three queries:

- **keywords**: two of its rarer words;
- **key**: its key;
- **question**: "What do the *title* say?".

The first 10 queries run once as an untimed warm-up, then every query runs once, timed, one at a time. **Found**
counts the queries whose target is among the page's documents. A keywords query often misses because other documents
share the same two words, so its found count describes the corpus, not a defect.

## Loading

| Passages | Vectors | Load time | Passages a second |
| --- | --- | --- | --- |
| 10,000 | embedded by the default CPU embedder | 51 min | 3.3 |
| 100,000 | keyword-only: a stand-in vector, no embedder call | 32 min | 51.6 |

The load goes through the records source and the engine's one ingest path, in batches. At 10,000 the embedder is
the ceiling: loading runs at its pace on this CPU, and it embeds about 7 passages a second at best on a faster one. Everything else in
the load costs about 0.02 s a passage, which is what the keyword-only row measures. To load faster, serve an embedder
on a GPU at `LOUVAIN_EMBEDDINGS_URL` ([Configuration](configuration.md#how-fast-documents-are-embedded)). 1,000,000
passages were not run: this machine has neither the time nor the disk for them.

## Searching

Times are in milliseconds.

| Passages | Mode | Query | Found | p50 | p95 |
| --- | --- | --- | --- | --- | --- |
| 10,000 | hybrid | keywords | 20 of 49 | 173 | 245 |
| 10,000 | hybrid | key | 49 of 49 | 108 | 135 |
| 10,000 | hybrid | question | 49 of 49 | 185 | 242 |
| 10,000 | keyword | keywords | 25 of 49 | 84 | 141 |
| 10,000 | keyword | key | 49 of 49 | 78 | 87 |
| 10,000 | keyword | question | 49 of 49 | 93 | 159 |
| 100,000 | keyword | keywords | 15 of 50 | 568 | 1,098 |
| 100,000 | keyword | key | 50 of 50 | 544 | 581 |
| 100,000 | keyword | question | 50 of 50 | 596 | 682 |

A keyword search at 100,000 passages takes about seven times as long as one at 10,000. This run does not say which
stage the extra time goes to. The 100,000 row has no hybrid search because its vectors are stand-ins.

## Disk and memory

| Passages | Postgres | Keyword index | Peak memory while loading | Peak memory while searching |
| --- | --- | --- | --- | --- |
| 10,000 | 150 MB | 16 MB | engine 167, Postgres 181, embedder 1,023, keyword index 82 | engine 191, Postgres 255, embedder 1,024, keyword index 76 |
| 100,000 | 1,419 MB | 144 MB | engine 223, Postgres 427, embedder 1,032, keyword index 165 | engine 148, Postgres 233, embedder 1,021, keyword index 211 |

Disk is the Postgres database's total relation size plus the workspace's keyword index directory. Memory is in MiB,
the highest of samples taken every two seconds: the engine's resident set, and each service's figure from
`docker stats`. The embedder holds its model in memory whether it is called or not.

## Running it

From an install's folder:

```sh
./engine up
node --import tsx packages/engine/scripts/scale-bench.ts --scales 10000,100000
```

Each scale loads into a database of its own and prints one `RESULT` line, which holds every figure on this page.
`--embed-up-to` (10,000 by default) sets the largest scale loaded with the real embedder, `--targets` the number of
target documents, and `--seed` the corpus.
