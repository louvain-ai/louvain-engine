"""`/search` under `strategy: "last"` (`bm25.py`): Meilisearch's matching strategy, Elasticsearch's relevance recipe
within each tier, completion and typo correction for a word no readable document holds, and the phrase a listing asks
with `phrase: true` (`bm25_listing.py`)."""

import tantivy
from analyzer import keys, outside
from bm25_query import MAX_LIMIT, _fence, _highlight, _narrowing, _snippet, _snippets, _text_query
from bm25_store import Store

# Meilisearch's matching strategy, Elasticsearch's relevance recipe within each tier (`strategy: "last"`).
# Every word of the search first, then the words less the last, and so on (Meilisearch `matchingStrategy: "last"`),
# each tier a bool of MUST clauses, one per word, ranked by BM25 with a match-phrase-with-slop SHOULD for closeness
# (Elasticsearch, "proximity for relevance"). Held-ness comes from the fenced tiers alone: no unfenced statistic decides
# anything or shortens any path, so a word only hidden documents hold costs the same calls as one nobody holds.
MAX_WORDS = 10
PROXIMITY_SLOP = 50
# The Snowball English stop list (snowballstem.org; PostgreSQL ships it as `english.stop` for its `english` text search
# configuration, the keyword path's stop words all along), never tantivy's built-in "english", Lucene's shorter list.
SNOWBALL_ENGLISH_STOP = (
    "i", "me", "my", "myself", "we", "our", "ours", "ourselves", "you", "your", "yours", "yourself", "yourselves",
    "he", "him", "his", "himself", "she", "her", "hers", "herself", "it", "its", "itself", "they", "them", "their",
    "theirs", "themselves", "what", "which", "who", "whom", "this", "that", "these", "those", "am", "is", "are",
    "was", "were", "be", "been", "being", "have", "has", "had", "having", "do", "does", "did", "doing", "a", "an",
    "the", "and", "but", "if", "or", "because", "as", "until", "while", "of", "at", "by", "for", "with", "about",
    "against", "between", "into", "through", "during", "before", "after", "above", "below", "to", "from", "up",
    "down", "in", "out", "on", "off", "over", "under", "again", "further", "then", "once", "here", "there", "when",
    "where", "why", "how", "all", "any", "both", "each", "few", "more", "most", "other", "some", "such", "no", "nor",
    "not", "only", "own", "same", "so", "than", "too", "very", "s", "t", "can", "will", "just", "don", "should",
    "now",
)
_STOP = (
    tantivy.TextAnalyzerBuilder(tantivy.Tokenizer.simple())
    .filter(tantivy.Filter.lowercase())
    .filter(tantivy.Filter.custom_stopword(list(SNOWBALL_ENGLISH_STOP)))
    .build()
)


def _held(ix: Store, fence: list, query: tantivy.Query) -> bool:
    """Whether a readable document matches: always asked under the fence, so the answer says nothing about the rest."""
    fenced = tantivy.Query.boolean_query([*fence, (tantivy.Occur.Must, query)])
    return len(ix.index.searcher().search(fenced, limit=1, count=False).hits) > 0


# Meilisearch's `minWordSizeForTypos` defaults: a word this long may carry one typo, two from the second.
ONE_TYPO_FROM = 5
TWO_TYPOS_FROM = 9
# Exact > prefix > typo. Prefix and fuzzy term queries score a constant, so the boosts alone order them.
PREFIX_BOOST = 2.0
TYPO_BOOST = 1.0
MIN_PREFIX = 3
# The unstemmed fields a prefix may complete in (words, keys and the runs inside keys) and a typo may correct in.
_PREFIX_FIELDS = ("exact", "header_exact", "terms", "header_terms", "runs")
_TYPO_FIELDS = ("exact", "header_exact")


def _typos(word: str) -> int:
    return 2 if len(word) >= TWO_TYPOS_FROM else 1 if len(word) >= ONE_TYPO_FROM else 0


def _any(queries: list[tantivy.Query]) -> tantivy.Query:
    return tantivy.Query.boolean_query([(tantivy.Occur.Should, q) for q in queries])


def _on(ix: Store, fields: tuple[str, ...], query) -> tantivy.Query:
    return _any([query(f) for f in fields if ix.has[f]])


def _form(ix: Store, chunk: str) -> tuple[str | None, bool]:
    """The word as the index holds it, and whether it is a key: a key as its joined form, a word as its one token."""
    asked = keys(chunk)
    plain = ix.exact.analyze(chunk)
    if len(asked) == 1:
        return "".join(asked[0]), True
    return (plain[0], False) if not asked and len(plain) == 1 else (None, False)


def _widened(ix: Store, chunk: str, last: bool) -> tuple[tantivy.Query | None, tantivy.Query | None]:
    """A word no readable document holds, as a clause of the one query, the way Elasticsearch's `match_bool_prefix`
    reads a search and Meilisearch its last word: the last word as a prefix of the held terms, and any word as a fuzzy
    term within Meilisearch's typo allowance. A key is never edited. Returns the clause and its prefix part."""
    form, key = _form(ix, chunk)
    if form is None:
        return None, None
    prefix = typo = None
    if last and len(form) >= MIN_PREFIX:
        prefix = _on(ix, _PREFIX_FIELDS, lambda f: tantivy.Query.fuzzy_term_query(ix.schema, f, form, 0, True, True))
    if not key and form.isalpha() and _typos(form):
        typo = _on(
            ix, _TYPO_FIELDS, lambda f: tantivy.Query.fuzzy_term_query(ix.schema, f, form, _typos(form), True, False)
        )
    clauses = [tantivy.Query.boost_query(q, b) for q, b in ((prefix, PREFIX_BOOST), (typo, TYPO_BOOST)) if q]
    return (_any(clauses) if clauses else None), prefix


SAID = ("completed", "corrected", "dropped")


def _resolved(ix: Store, fence: list, words: list[tuple]) -> tuple[list, dict]:
    """When no readable document holds every word, each word is checked under the fence (the term suggester's
    `suggest_mode: missing`), and one nobody readable holds is asked as its clause (`_widened`). A clause that finds
    nothing readable either is not asked, and the page says so. A word the documents hold is never widened."""
    groups: list = []
    said: dict[str, list[str]] = {k: [] for k in SAID}
    for i, (chunk, asked, stems) in enumerate(words):
        if _held(ix, fence, asked):
            groups.append((asked, stems))
            continue
        clause, prefix = _widened(ix, chunk, i == len(words) - 1)
        if clause is not None and _held(ix, fence, clause):
            groups.append((clause, []))
            said["completed" if prefix is not None and _held(ix, fence, prefix) else "corrected"].append(chunk)
        else:
            said["dropped"].append(chunk)
    return groups, said


def _tier(ix: Store, fence: list, groups: list, narrow: dict) -> tantivy.Query:
    """One tier: every word a MUST, ranked by BM25 with a match-phrase-with-slop SHOULD for words close together."""
    tier = [(tantivy.Occur.Must, q) for q, _ in groups]
    stems = [s for _, words in groups for s in words]
    if len(stems) > 1:
        tier.append((tantivy.Occur.Should, tantivy.Query.phrase_query(ix.schema, "text", stems, PROXIMITY_SLOP)))
    return tantivy.Query.boolean_query([*fence, *tier, *_narrowing(ix, narrow)])


def _phrase_query(ix: Store, query: str) -> tantivy.Query | None:
    """Elasticsearch's `match_phrase`, for a listing that asks `phrase: true` (the documents that mention an
    identifier): every word held, a key as its joined form (`_words`, as a tier asks it), and the words, where there are
    more than one, side by side (slop 0) in the text or the header. None when the search has no word."""
    words = _words(ix, query)
    if not words:
        return None
    must = [(tantivy.Occur.Must, q) for _, q, _ in words]
    stems = [s for _, _, word_stems in words for s in word_stems]
    if len(stems) > 1:
        fields = ["text", *(["header"] if ix.has["header"] else [])]
        side = [(tantivy.Occur.Should, tantivy.Query.phrase_query(ix.schema, f, stems, 0)) for f in fields]
        must.append((tantivy.Occur.Must, tantivy.Query.boolean_query(side)))
    return tantivy.Query.boolean_query(must)


def _words(ix: Store, query: str) -> list[tuple]:
    """The search's words in order, at most `MAX_WORDS`, each with its query and its stems; a stop word is no word. A
    key is always asked as its joined form, whatever `LOUVAIN_BM25_ANALYZER` says for the plain `/search`: a key asked
    as its parts would match every sibling that shares one ("SUP-1042" as sup and 1042)."""
    chunks = [c for c in query.replace('"', " ").split() if keys(c) or _STOP.analyze(c)][:MAX_WORDS]
    return [
        (c, q, ix.query.analyze(outside(c)))
        for c in chunks
        if (q := _text_query(ix, c, ix.knobs.title_boost, 0, True))
    ]


def search_last(
    ix: Store, org: str, containers: list[str], query: str, limit: int, as_of: str | None, narrow: dict
) -> dict:
    """`/search` under `strategy: "last"`: every word, then the words less the last, each tier ranked by its own BM25,
    until `limit` are found. When the first tier finds something every word is held and nothing is checked word by
    word. The answer names the words completed, corrected or dropped, never the terms they matched, and `asked`, how
    many words the first tier asked for: a hit whose `words` is `asked` holds every word searched (the caller's match)."""
    words = _words(ix, query)
    if not containers or not words:
        return {"hits": [], "asked": 0, **{k: [] for k in SAID}}
    limit = max(1, min(limit, MAX_LIMIT))
    fence = _fence(ix, org, containers, as_of)
    groups, said = [(q, stems) for _, q, stems in words], {k: [] for k in SAID}
    searcher = ix.index.searcher()
    first = searcher.search(_tier(ix, fence, groups, narrow), limit=limit).hits
    if not first:
        groups, said = _resolved(ix, fence, words)
    seen: set[str] = set()
    hits: list[dict] = []
    for n in range(len(groups), 0, -1):
        found = first if first and n == len(groups) else searcher.search(
            _tier(ix, fence, groups[:n], narrow), limit=limit + len(seen)
        ).hits
        searched = " ".join(c for c, _, _ in words[:n])
        generator = _snippets(ix, searcher, _highlight(ix, searched, _tier(ix, fence, groups[:n], narrow)))
        for score, addr in found:
            doc = searcher.doc(addr)
            doc_id = doc.get_first("id")
            if doc_id not in seen and len(hits) < limit:
                seen.add(doc_id)
                hits.append({"id": doc_id, "score": float(score), "words": n, "snippet": _snippet(generator, doc)})
        if len(hits) >= limit:
            break
    return {"hits": hits, "asked": len(groups), **said}

