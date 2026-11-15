# How search works

**In short:** a search returns a page of documents ranked by words and meaning together, and says which ones match.
Agents call `louvain_search_sources`; `./engine search` and the app make the same call.

The examples below ran over the sample corpus plus a `support` folder: three tickets (`SUP-1042`, `SUP-1043`,
`SUP-1044`), a weekly review that mentions `SUP-1042`, and a hardware budget of "GBP 12,500".

## Search

1. Call **`louvain_search_sources`** with a `query`: words, a question, an identifier or a figure.
2. Read the page's `sources` (the matches, best first) and `note`.
3. Open a hit with **`louvain_read_source`** and its `id`. It returns the whole text in pages of up to 40,000
   characters (`textLength`, `nextOffset`) and `related.versions`.

To find the document that IS an identifier (a key, URL, id, file name or path), call **`louvain_lookup_source`**. It
matches exactly, with no model, and keeps the documents that are it apart from those that mention it:

```json
{"identifier":"SUP-1042"}
{"is":[{"title":"SUP-1042 Printer queue stalls","matchedOn":"titleKey", …}],"mentions":[{"title":"weekly-review", …}],
 "note":"One source IS \"SUP-1042\" (`is`, with `matchedOn` saying how): open it with louvain_read_source by its `id`. One source mentions it (`mentions`, newest first): every one the keyword index found."}
```

A search with no letter and no digit is refused, and so is an argument the tool does not declare or that does not fit
its schema:

```text
{"query":"?!"} → A search needs a word or a figure to look for, and this one has neither.
{"query":"lease","limit":"20"} → louvain_search_sources: "limit" must be a number, not the text "20".
```

## What the page tells you

Each hit's `match` says why it is there. A document matches for one of four reasons; the rest are listed under
`looselyRelated`, which is not evidence.

### It is what the search names

`match.exact: true`: the search is its id, its whole title, a key its title opens with, or its URL. These lead the
page (at most 20, newest first), then the documents that hold it, as the keyword index ranks them. A key is compared
as the index's analyzer joins it, so a key typed joined, hyphenated or in another case is the same key:

```json
{"query":"sup1042"}
{"sources":[["SUP-1042 Printer queue stalls",{"words":true,"meaning":null,"exact":true}],
            ["weekly-review",{"words":true,"meaning":null}]],"loose":[],"matched":true}
```

### It holds the search's words, keys or figures

`match.words: true`. Documents and searches pass through the same analyzer, so:

- Stemming and stop words apply: `renewing` matches "renews"; "the" matches nothing.
- Accents fold: "cafe" matches "Café".
- A key is one term however it is spelled: `sup1042` and `SUP-1042` match either spelling, `NOTE5` and `note05` match
  "note-05", `notes-5` matches "field-service-scheduling-notes-5", and `4471` matches "PO-4471".
- A key never matches its neighbour: `SUP-1042` does not match `SUP-1043`, and prose that says "Note: 5" does not
  hold `note-5`.
- `12500` and `12,500` are one figure; "12 500", split by a space, is two numbers.

```json
{"query":"12500"}
{"sources":[["hardware-budget",{"words":true,"meaning":null}]],"loose":[],"matched":true}
{"query":"2026"}
{"sources":[["lease-renewal",…],["facilities-agreement",…],["calibration-rig",…],["hiring-plan",…]],"matched":true}
```

The analyzer is the keyword index's, the one matcher: English stemming with Lucene's word-delimiter and shingle filters
(preserve original, catenate all, catenate numbers, split on numerics; runs of up to 8 parts that begin with a letter),
after case and accent folding (`apps/nlp/analyzer.py`, held to `packages/engine/test/analyzer-cases.json`). Catenating
numbers holds a chain of digits separated by delimiters joined too, so `2.3.1` finds a document that wrote `v2.3.1`; a
date inside a key gives only its whole chain (`2029031407`), so no short number such as `314` finds it. The open
database runs no analyzer of its own. An index built before this needs `./engine reindex`.

### It is close in meaning

`match.meaning` is its nearest passage's cosine similarity to the search; it matches at or above the embedder's floor
(0.57 for `Xenova/bge-base-en-v1.5`; a model with no recorded floor matches by words alone). A paraphrase with no
shared word matches this way:

```json
{"query":"how much money is set aside for computer equipment"}
{"sources":[["hardware-budget",{"words":false,"meaning":0.7}],["facilities-agreement",{"words":false,"meaning":0.59}]],
 "loose":[["hiring-plan",{"words":false,"meaning":0.55}], …],"matched":true}
```

`meaning` ranks; it is not a confidence. It is `null` when meaning was not measured:

- **A search that only names things** (every word an identifier or a figure). Its page is the document it names, then
  the documents that hold it, then nothing; a look-alike never takes a place. A GUID counts.
- **A word the embedder does not know** (split into five or more pieces, and held by no passage) is left out. With no
  word left, the page is a note alone.
- **Keyword mode**, `mode: "keyword"`.

```json
{"query":"SUP-1042"}
{"sources":[["SUP-1042 Printer queue stalls",{"words":true,"meaning":null,"exact":true}],
            ["weekly-review",{"words":true,"meaning":null}]],"loose":[],"matched":true}
{"query":"SUP-9999"}
{"sources":[],"loose":[],"matched":false,"note":"Nothing in your documents matches this search: none holds what it names."}
{"query":"8f14e45f-ceea-467a-9575-0d1c3b6b0a21"}
{"sources":[],"loose":[],"matched":false,"note":"Nothing in your documents matches this search: none holds what it names."}
{"query":"qwxzvkjhgf"}
{"sources":[],"loose":[],"matched":false,"note":"Nothing in your documents matches this search. It holds no word your documents or the language model know, so nothing is close to it in meaning either."}
```

### The reranker scores it at or above its cut-off

Only when `engine.config.ts` names a reranker ([Configuration](configuration.md)). `match.relevance` is its score from
0 to 1. A low score never hides a document or stops another reason matching.

### When nothing matches

`matched: false`, and `note` says why. Anything under `looselyRelated` is only the nearest:

```json
{"query":"highfield"}
{"sources":[],"loose":[["hiring-plan",{"words":false,"meaning":0.45}], …],"matched":false,
 "note":"Nothing in your documents matches this search: none holds its words or comes close to it in meaning. Any listed under looselyRelated are only the nearest."}
```

### Words no document holds

The keyword index ranks as Meilisearch does (its matching strategy `last`): the documents holding every word first,
then those holding the words less the last, and so on, each group by its own relevance. A document matches by its
words when it holds every word searched. A word no readable document holds is not dropped silently: it is asked as
part of the same search, and `corrected` and `note` name it, never what it matched:

- **The last word, key or number completes.** Three characters or more, it is searched as the start of longer held
  terms, as Meilisearch and Elasticsearch's `match_bool_prefix` read it: `firm` finds `firmware`, `SUP-102` finds
  SUP-1020 to SUP-1029, `FS-44` finds FS-4471, `240` finds a document that says "2,400". `corrected` holds
  `{ "from": "SUP-102", "completed": true }`; the note says `No document holds "SUP-102"; searched for what begins with it.`
- **A word is read as the held words a typo away.** None under 5 letters, one from 5, two from 9 (Meilisearch's word
  sizes); a swap of two letters is one, and a typo in the first letter counts like any other. The last word takes a
  typo as well as its completion. `corrected` holds `{ "from": "firmwre" }`; the note says
  `No document holds "firmwre"; searched for words like it.` A real word can be read as one it nearly spells; the note
  is how you tell.
- **A word nothing readable comes near is searched without.** `corrected` holds `{ "from": "zzzz", "dropped": true }`;
  the note says `No document holds "zzzz"; searched without it.`
- **Exact before completed before typo:** a document holding the word as typed ranks above one holding a completion,
  and that above one holding a typo.
- **Never edited:** an identifier or figure (`SUP-1043` never becomes `SUP-1042`), or a word or key some readable
  document holds whole, which is never widened. Stop words are not words.
- **Only words you can read** count: whether a word is held is asked inside the reader's fence, so a word held only by a
  document you cannot read is searched without.
- **Only with the keyword sidecar.** Without `LOUVAIN_BM25_URL`, a search runs as typed.

```json
{"query":"firmwre engineers"}
{"sources":[["hiring-plan",{"words":true,"meaning":0.73}],["calibration-rig",{"words":true,"meaning":0.49}]], …,
 "corrected":[{"from":"firmwre"}],
 "note":"No document holds \"firmwre\"; searched for words like it."}
```

### When the keyword index does not answer

The engine requires its keyword index, as it requires its database: no second matcher answers in its place. When the
index is down (or was built by an older release), a search finds by meaning alone and lists `keyword: "index"` in
`degraded`; a filter the index does not carry (a figure, knowledge time, a record filter) does the same with
`keyword: "filter"`. A listing with words is empty until the index answers. The engine says so once in its log, with
the fix: **`./engine logs bm25`**, and **`./engine reindex`** for an index an older release built.

### What a hit carries

A full hit, from `{"query":"SUP-1042"}`:

```json
{
  "id": "b02fb8ed2b689c8a9c0f9ad915daf0dd45c16e2bb3aeb822899af7fd38e8dbea",
  "title": "SUP-1042 Printer queue stalls",
  "app": "ingest",
  "kind": "document",
  "author": null,
  "modifiedAt": "2026-11-14T14:47:31.297Z",
  "excerpt": "SUP-1042 Printer queue stalls after the driver update\n\nThe floor 2 printer queue stalls after the March driver update. Rolling back the driver clears it.",
  "url": null,
  "match": { "words": true, "meaning": null, "exact": true, "ranks": { "words": 1, "meaning": null }, "by": "exact" },
  "container": { "id": "ingest/support/_", "name": "(top folder)" }
}
```

| Field | What it is |
| --- | --- |
| `id` | What `louvain_read_source` opens |
| `title`, `app`, `kind`, `author`, `url` | The document, as it was loaded |
| `modifiedAt`, or `dateMonth`, `dateYear`, `dateUnknown` | Its date, only as precisely as it is known |
| `excerpt` | The passage that ranked it, with its line breaks |
| `match.words`, `match.meaning`, `match.exact`, `match.relevance` | The reasons above |
| `match.by` | The strongest reason: `exact`, `words`, `relevance`, then `meaning`; absent on a loosely related document |
| `match.ranks` | Its place in the keyword search (`words`) and the meaning search (`meaning`) before fusion, or `null` |
| `container` | Its folder; `container.id` lists the folder whole |
| `matchedVersion` | The version that matched, when it is not the current one |
| `compact` | A hit past the first 10 on a default page: no URL, a 200-character excerpt |
| `writtenByAgent`, `generatedBy` | Present when an agent wrote the document |
| `conversation` | The messages beside a chat message |

The page also carries `sources`, `looselyRelated`, `matched`, `note`, `hasMore`, `nextCursor`, and when they apply
`corrected`, `outsideWindow` and `degraded` (a leg that could not answer, such as `keyword: "missed"`).

## Filters

| Argument | What it does |
| --- | --- |
| `limit` | Hits on the page. With none, the page is 24 documents, the first 10 in full |
| `cursor` | The previous page's `nextCursor`, sent with the same arguments, for the next page |
| `exclude` | Up to 200 ids already shown; the page reads further down the same order |
| `after`, `before` | `YYYY-MM-DD`: keep documents written or last changed in that range. A first page also lists up to five strong matches the range left out, under `outsideWindow` |
| `view: "list"` | Every match newest first, up to 100 a page, with `total` and `end` |
| `container` | One folder; with an empty `query`, lists it whole |
| `mode: "keyword"` | Words, identifiers and figures only; no meaning |
| `question` | The person's question, searched beside the query (up to 2,000 characters) |

```json
{"query":"office","limit":2}                   → ["facilities-agreement","lease-renewal"], hasMore: true
{"query":"office","limit":2,"cursor":"c1.…"}   → ["hiring-plan"], looselyRelated ["SUP-1044 Wi-Fi drops"], hasMore: true
{"query":"office","exclude":["<facilities-agreement's id>"],"limit":2} → ["lease-renewal","hiring-plan"]
```

Past the ranked head the page is filled from the listing, so a document with no passage is still found by its title.
A listing with words (`view: "list"`, or the fill past the head) is read from the keyword index, one entry per
document, matched the same way as the search and counted exactly; each page is read again from the database under
your fence. A listing with no words is the documents in date order, read from the database.

## Tune

1. Set one of these in **`engine.config.ts`**'s `settings` ([Configuration](configuration.md)), or the last in **`.env`**,
   then run **`./engine down`** and **`./engine up`**:

| Setting | Default | What it does |
| --- | --- | --- |
| `LOUVAIN_SEARCH_RELEVANCE` | on | `off`: one ranked list, with no `match`, `looselyRelated`, `matched` or exact tier, and excerpts on one line |
| `LOUVAIN_SEARCH_QUESTION` | on | `off` removes the `question` argument |
| `LOUVAIN_BM25_BEST_PASSAGE` | on | `off` shows a keyword hit by its first passage, not its best |
| `LOUVAIN_AGENT_SEARCH_CHUNK_BONUS` | 0 | 1 ranks a document by the sum of its passages, not its best one |

2. The search's own settings (the question leg, best passage, the reranker's window and blend)
   are `settings` in `engine.config.ts` ([Configuration](configuration.md)).
3. To reorder the page with a model, add a reranker ([Configuration](configuration.md)).

### How the ranking is made

`search` in `packages/engine/src/search/search.ts` runs one stage a line. Each is timed as `search.<name>` and reports
what it could not do in `degraded`:

| Stage | What it does |
| --- | --- |
| legs | Resolves the reader's fence, runs each retriever on a reading narrowed to it, re-checks every row, and fuses the legs by reciprocal rank (`1 / (60 + rank)`) |
| documents | Groups passages into documents, each ranked by its best passage; a reranker reorders them |
| titled | Documents whose title the search names, placed 7 to 9; off in this release |
| originals | Folds copies of one original into one hit; this release keys no copies |
| named | Reads each document's title, date and folder through the same fence |
| (unshown) | Leaves out `exclude`'s documents |
| conversation | Adds the messages beside a chat message among the first hits |

The `vector` retriever reads passages by meaning and the `keyword` retriever by words, each three passages deep per
document asked for, and the engine fuses their legs by reciprocal rank. The
`figures` retriever reads only for a search that asks for a figure ("how much", "total", "budget", a currency sign).

## Check a change to search

The search results table, `packages/engine/test/db/search-table/`, states what each search must return over a fixed
invented corpus of about 150 documents (`corpus.json`), one row per search (`table.json`), run through
`louvain_search_sources` itself.

1. Install the keyword index's Python:
   **`python3 -m venv apps/nlp/.venv && apps/nlp/.venv/bin/pip install -r apps/nlp/requirements-bm25.txt`**.
2. Run it against a test database server:
   **`TEST_AUTH_DATABASE_URL=postgres://… pnpm --filter @louvain/engine test:table`**.

```text
search table [keyword-index]: 77 rows; 60 hold, 0 broken, 17 pending, 0 to promote, 0 skipped
```

To add a row, add the query to `table.json`, run with `LOUVAIN_TEST_TABLE_PRINT=1` to print each page, and write down
what the page must hold. A row whose expectation the engine does not meet yet is `pending`, with the rule it follows;
a `pending` row that starts passing fails with "promote this row" until its status is `holds`. Keep new documents
invented, and check that no number or word they add moves another row.

| Field | What it claims |
| --- | --- |
| `query`, `args` | The search, and further arguments (`limit` is 10 unless set) |
| `must`, `within`, `only` | Documents that must be among the first `within` matches; with `only`, exactly those |
| `first` | The first match |
| `mustNot` | Documents that must appear nowhere on the page |
| `notMatched` | Documents that must not be matches |
| `note`, `nothing`, `corrected` | The page's note, that nothing matches, and its corrections, exactly |
| `class`, `why` | What kind of search it is, and the rule or published default it follows |
| `status` | `holds`, or `pending` with `pending.reason` and `pending.rule` |
| `stack` | `keyword-index` (default), `keyword-index-down`, `no-keyword-index` or `meaning` |

Each stack runs in its own file (`search.table*.test.ts`). `keyword-index` needs the Python above
(`LOUVAIN_TEST_BM25_PYTHON`) or an empty index of its own at `LOUVAIN_TEST_BM25_URL`; `meaning` needs a real
embedding sidecar at `LOUVAIN_TEST_EMBEDDINGS_URL` (and `LOUVAIN_TEST_SIDECAR_TOKEN`). A stack that cannot run is
skipped and counted; `LOUVAIN_TEST_TABLE_REQUIRE=1` makes a missing keyword index a failure.
