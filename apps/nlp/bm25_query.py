"""The keyword index's query (`bm25.py`): the fence every read carries, the narrowings beside it, the search's words
over the text fields, and a hit's snippet. `search` is the plain `/search`; `bm25_last.py` the tiers of `strategy: "last"`,
`bm25_listing.py` the document listing. Each takes the open index as a `Store`."""

import time

import tantivy
from analyzer import _DELIMITER, _tokens, keys, outside
from bm25_schema import DOCUMENT, _joined, _split
from bm25_store import Store, _to_unix_seconds

MAX_LIMIT = 200
DEFAULT_LIMIT = 20


class FilterUnsupported(Exception):
    """A filter this index cannot apply: one built before the field it needs. Never ignored: the caller is told."""


def _range(ix: Store, lo: int | None, hi: int | None, field: str = "occurred_at") -> tantivy.Query:
    return tantivy.Query.range_query(
        ix.schema, field, tantivy.FieldType.Integer, lo, hi, include_lower=True, include_upper=True
    )


def _between(ix: Store, narrow: dict, field: str) -> list[tuple[tantivy.Occur, tantivy.Query]]:
    """`from`/`to` on a date field, inclusive, in whole seconds wider than asked (from rounded down, to up) so the
    engine's exact re-check in SQL decides the edges."""
    lo = narrow.get("from")
    hi = narrow.get("to")
    if not lo and not hi:
        return []
    return [
        (
            tantivy.Occur.Must,
            _range(ix, 
                _to_unix_seconds(str(lo)) if lo else None,
                _to_unix_seconds(str(hi)) + 1 if hi else None,
                field,
            ),
        )
    ]


def _narrowing(ix: Store, narrow: dict) -> list[tuple[tantivy.Occur, tantivy.Query]]:
    """The narrowings a search may carry, each a must clause beside the fence: `ids` (these entries only, which of them
    hold the search's words), `apps` (any of these, `app` field), `figures` (those that state a figure) and a
    time range `from`/`to` in whole seconds, wider than asked (from rounded down, to up) so the engine's exact re-check
    in SQL decides the edges. Only narrows; an index without the `app` or `figures` field refuses that filter rather than
    ignore it."""
    out: list[tuple[tantivy.Occur, tantivy.Query]] = []
    ids = narrow.get("ids")
    if ids is not None:
        # Elasticsearch's `ids` query: these entries only, by the raw `id` field the fence's reads already trust.
        out.append((tantivy.Occur.Must, tantivy.Query.term_set_query(ix.schema, "id", [str(i) for i in ids])))
    apps = narrow.get("apps")
    if apps is not None:
        if not ix.has["app"]:
            raise FilterUnsupported("app")
        out.append((tantivy.Occur.Must, tantivy.Query.term_set_query(ix.schema, "app", [str(a) for a in apps])))
    if narrow.get("figures") is True:
        if not ix.has["figures"]:
            raise FilterUnsupported("figures")
        out.append((tantivy.Occur.Must, tantivy.Query.term_query(ix.schema, "figures", "1")))
    return [*out, *_between(ix, narrow, "occurred_at")]


def _fence(
    ix: Store, org: str, containers: list[str], as_of: str | None, documents: bool = False
) -> list[tuple[tantivy.Occur, tantivy.Query]]:
    """THE FENCE, as MUST clauses: the org, the caller's readable containers and (when given) the as-of cutoff. One
    builder for every read, so `/search` and `/list` cannot hold two definitions of it. A read is of one
    grain: the passages, or (`documents`) the document entries, so neither counts the other."""
    must = [
        (tantivy.Occur.Must, tantivy.Query.term_query(ix.schema, "org", org)),
        (tantivy.Occur.Must, tantivy.Query.term_set_query(ix.schema, "container", containers)),
    ]
    if as_of:
        cutoff = tantivy.Query.range_query(
            ix.schema, "occurred_at", tantivy.FieldType.Integer, None, _to_unix_seconds(as_of), include_upper=True
        )
        must.append((tantivy.Occur.Must, cutoff))
    if ix.kind:
        # A read is of one grain; an earlier build's document entries are never a passage hit either.
        kind = tantivy.Query.term_query(ix.schema, "kind", DOCUMENT)
        must.append((tantivy.Occur.Must if documents else tantivy.Occur.MustNot, kind))
    return must


def _exact_should(ix: Store, query: str, boost: float) -> list[tuple[tantivy.Occur, tantivy.Query]]:
    """The query's surface forms against the unstemmed field, boosted: SHOULD, so they only ever add."""
    return [
        (tantivy.Occur.Should, tantivy.Query.boost_query(tantivy.Query.term_query(ix.schema, "exact", tok), boost))
        for tok in dict.fromkeys(ix.exact.analyze(query))
    ]


def _snippets(ix: Store, searcher: tantivy.Searcher, query: tantivy.Query) -> tantivy.SnippetGenerator | None:
    """tantivy's own snippet generator over the stored `text`, for the words `query` asks of it, or None where the
    index stores no text. Built per search, from the hits' searcher, so a snippet is only ever of a fenced hit."""
    return tantivy.SnippetGenerator.create(searcher, query, ix.schema, "text") if ix.snippets else None


def _highlight(ix: Store, query: str, matched: tantivy.Query) -> tantivy.Query:
    """The query a hit's snippet is drawn by (Elasticsearch's `highlight_query`), apart from the one that matched it:
    the search's plain words on `text` as the match asks them, and each key or figure as a phrase of its parts on
    `text`, where prose writes it ("SUP-1042" as sup then 1042), since the match asks a key of the joined-form fields,
    which the generator does not read. It only marks: it never finds or ranks. The matching query where there is no key."""
    parts = keys(query)
    if not parts:
        return matched
    should = []
    words = _text_query(ix, outside(query), 0, 0, False)
    if words is not None:
        should.append((tantivy.Occur.Should, words))
    for key in parts:
        tokens = [t for part in key for t in ix.query.analyze(part)]
        if len(tokens) > 1:
            should.append((tantivy.Occur.Should, tantivy.Query.phrase_query(ix.schema, "text", tokens)))
        elif tokens:
            should.append((tantivy.Occur.Should, tantivy.Query.term_query(ix.schema, "text", tokens[0])))
    return tantivy.Query.boolean_query(should) if should else matched


def _snippet(generator: tantivy.SnippetGenerator | None, doc: tantivy.Document) -> dict | None:
    """A hit's snippet: the fragment of its text where the search's words fell (tantivy's default length) and the
    marked words, as `[start, end)` character offsets into the fragment. None without one: no stored text, or no word
    of the search in the text (a match on another field)."""
    if generator is None:
        return None
    snippet = generator.snippet_from_doc(doc)
    marks = [[h.start, h.end] for h in snippet.highlighted()]
    fragment = snippet.fragment()
    return {"text": fragment, "marks": marks} if fragment and marks else None


def search(
    ix: Store,
    org: str,
    containers: list[str],
    query: str,
    limit: int,
    as_of: str | None,
    title_boost: float | None = None,
    narrow: dict | None = None,
    exact_boost: float | None = None,
    order: str = "relevance",
) -> tuple[list[dict], int]:
    """The fenced matches, ranked by BM25, or with `order: "newest"` SORTED by when the record was said
    (`occurred_at`, newest first; a record entry's date, as `modified` is a document entry's): a sort, not a ranking, so
    each hit's score is 0. The fence and the narrowings are the same either way."""
    started = time.perf_counter()
    boost = ix.knobs.title_boost if title_boost is None else max(0.0, float(title_boost))
    if not containers:
        # Fail closed: no readable containers is not "search everything",
        # it is nothing to search — the same rule every other retrieval leg
        # of the engine applies.
        return [], 0
    text_query = _text_query(ix, query, boost, exact_boost)
    if text_query is None:
        return [], 0
    limit = max(1, min(limit, MAX_LIMIT))

    must = [*_fence(ix, org, containers, as_of), (tantivy.Occur.Must, text_query)]
    must.extend(_narrowing(ix, narrow or {}))
    fenced = tantivy.Query.boolean_query(must)

    # A fresh searcher per call, per tantivy's own guidance: it is the cheap
    # handle that pins a consistent segment set for this query, not a shared
    # resource to hold onto — which is also what makes concurrent searches
    # safe against a write committing in another thread.
    searcher = ix.index.searcher()
    generator = _snippets(ix, searcher, _highlight(ix, query, text_query))
    if order == "newest":
        result = searcher.search(fenced, limit=limit, order_by_field="occurred_at", order=tantivy.Order.Desc)
        found = [(0.0, addr) for _, addr in result.hits]
    else:
        result = searcher.search(fenced, limit=limit)
        found = [(float(score), addr) for score, addr in result.hits]
    hits = []
    for score, addr in found:
        doc = searcher.doc(addr)
        hits.append({"id": doc.get_first("id"), "score": score, "snippet": _snippet(generator, doc)})
    took_ms = int(round((time.perf_counter() - started) * 1000))
    return hits, took_ms


def _text_query(
    ix: Store, query: str, boost: float, exact_boost: float | None, analyzer: bool | None = None
) -> tantivy.Query | None:
    """The search's words as one SHOULD query over the text fields, or None when it has none. With `analyzer` (the
    server's `LOUVAIN_BM25_ANALYZER` unless the caller says), a key or figure is asked of the analyzer's fields as its
    joined form, never of English text as its parts."""
    if analyzer is None:
        analyzer = ix.knobs.analyzer
    tokens = ix.query.analyze(query or "")
    if not tokens:
        return None
    text_should = _asked(ix, "text", query, tokens, None, analyzer)
    # `minimum_number_should_match=1`: OR semantics — at least one query term
    # has to match. Measured redundant (a should-only clause already refuses
    # a doc matching none of them, nested or not) but stated explicitly
    # because the clause sits inside an outer MUST and "at least one term
    # matches" is the contract a reviewer should be able to read off the code
    # rather than infer from tantivy's defaults.
    if boost > 0:
        # BM25F by hand: the same terms scored against the title field, the
        # whole clause boosted. SHOULD, so a document with no title match is
        # still a candidate on its body — the title only ever ADDS.
        title_should = _asked(ix, "title", query, tokens, boost, analyzer)
        text_should = [*text_should, *title_should]
    if ix.has["header"] and ix.knobs.header_boost > 0:
        # The header the same way: SHOULD, boosted, so it only ever ADDS to a document the body already names —
        # or makes a candidate of one whose header alone names what was asked (the contract by its title).
        header_should = _asked(ix, "header", query, tokens, ix.knobs.header_boost, analyzer)
        text_should = [*text_should, *header_should]
    if ix.knobs.variants and ix.has["variants"]:
        text_should = [*text_should, *_variant_should(ix, query)]
    if analyzer and ix.has["terms"]:
        text_should = [*text_should, *_terms_should(ix, query, "terms")]
    if analyzer and ix.has["runs"]:
        text_should = [*text_should, *_keys_should(ix, query, "runs")]
    if analyzer and ix.has["header_terms"] and ix.knobs.header_boost > 0:
        text_should = [*text_should, *_terms_should(ix, query, "header_terms", ix.knobs.header_boost)]
    exact = ix.knobs.exact_boost if exact_boost is None else max(0.0, float(exact_boost))
    if ix.has["exact"] and exact > 0:
        text_should = [*text_should, *_exact_should(ix, query, exact)]
    return tantivy.Query.boolean_query(text_should, minimum_number_should_match=1)

def _asked(
    ix: Store, field: str, query: str, tokens: list[str], boost: float | None, analyzer: bool
) -> list[tuple[tantivy.Occur, tantivy.Query]]:
    """The query against one English field (`text`, `title`, `header`), SHOULD, boosted when `boost` is given. With the
    analyzer on, its plain words only: a key or figure is asked of the analyzer's fields (`terms`, `header_terms`),
    never of English text, where its parts are two common words ("NOTE5" is not a search for prose saying "note 5")
    and where its spellings are held differently ("FS-4471" as fs and 4471, "fs4471" whole). So every spelling of a
    key is one query. With it off, the query's own tokens, as the field was always asked."""
    words = ix.query.analyze(outside(query)) if analyzer and ix.has["terms"] else tokens
    return [
        (
            tantivy.Occur.Should,
            tantivy.Query.term_query(ix.schema, field, tok)
            if boost is None
            else tantivy.Query.boost_query(tantivy.Query.term_query(ix.schema, field, tok), boost),
        )
        for tok in dict.fromkeys(words)
    ]


def _terms_should(
    ix: Store, query: str, field: str, boost: float | None = None
) -> list[tuple[tantivy.Occur, tantivy.Query]]:
    """The query through the same word-delimiter step, on one of its fields (`terms`, or `header_terms` boosted as the
    header is): its plain words as terms, and each key or figure as
    its joined form alone (never a part, never a phrase of parts, which prose can hold), so "2400" finds a document that
    wrote "2,400", "sup1042" and "note5" ones that wrote "SUP-1042" and "note-05", and "notes-5" one ending
    "...notes-5" (a document holds every run of its key's parts joined). SHOULD: they only ever add."""
    should = [
        (tantivy.Occur.Should, tantivy.Query.term_query(ix.schema, field, tok))
        for tok in dict.fromkeys(ix.exact.analyze(outside(query)))
    ]
    should.extend(_keys_should(ix, query, field))
    return should if boost is None else [(occur, tantivy.Query.boost_query(q, boost)) for occur, q in should]


def _keys_should(ix: Store, query: str, field: str) -> list[tuple[tantivy.Occur, tantivy.Query]]:
    """Each key or figure of the query as its joined form, on `field`, as one SHOULD each. A key of digits alone is
    also asked as written ("2.03" as 23 or 203), since a document holds its digit chain as written
    (`catenate_numbers`) beside its parts with their zeros dropped. Exact terms scored by BM25, never a part."""
    should: list[tuple[tantivy.Occur, tantivy.Query]] = []
    for token, parts in _tokens(query):
        forms = ["".join(parts)]
        if all(p.isdigit() for p in parts) and _DELIMITER.sub("", token) not in forms:
            forms.append(_DELIMITER.sub("", token))
        # One term query per form, never a set query: a TermSetQuery scores a constant, with no BM25, and a key the
        # search names must weigh by its frequency and rarity like any word.
        either = [(tantivy.Occur.Should, tantivy.Query.term_query(ix.schema, field, form)) for form in forms]
        should.append((tantivy.Occur.Should, either[0][1] if len(either) == 1 else tantivy.Query.boolean_query(either)))
    return should


def _variant_should(ix: Store, query: str) -> list[tuple[tantivy.Occur, tantivy.Query]]:
    """The query's compounds as the index holds them: each joined spelling a term on `variants`, each letters-and-digits
    word's parts a phrase on `text`. SHOULD, beside the query's own terms: they only ever add."""
    should: list[tuple[tantivy.Occur, tantivy.Query]] = []
    for joined in _joined(query):
        for tok in dict.fromkeys(ix.query.analyze(joined)):
            # Both fields: a document that wrote "SOC2" holds `soc2` in its text; one that wrote "seat-hours" holds
            # `seathour` only in `variants`.
            for field in ("text", "variants"):
                should.append((tantivy.Occur.Should, tantivy.Query.term_query(ix.schema, field, tok)))
    for parts in _split(query):
        toks = [t for p in parts for t in ix.query.analyze(p)]
        if len(toks) > 1:
            should.append((tantivy.Occur.Should, tantivy.Query.phrase_query(ix.schema, "text", toks)))
    return should