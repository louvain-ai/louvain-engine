"""`/list` (`bm25.py`): the readable document entries as a page, its exact total and its facets, from the index."""

import tantivy
from bm25_last import _phrase_query
from bm25_query import DEFAULT_LIMIT, MAX_LIMIT, _between, _fence, _highlight, _snippet, _snippets, _text_query
from bm25_store import Store

MAX_FACETS = 1_000


class ListingUnsupported(Exception):
    """An index built before the document entries: it cannot list. Said, never answered empty."""


def listing(ix: Store, org: str, containers: list[str], ask: dict) -> dict:
    """THE LISTING FROM THE ix.index: the readable document entries, matching the search's words when it has any, as a page
    (`order`: `newest` by `modified`, or `relevance`), its exact total and its facets by app and container, the
    fence's own values: the engine names a container's connection for each reader. Two narrowings are must clauses
    beside the fence: `from`/`to` on `modified` (`_between`), and `ids`, the entries the client names (Elasticsearch's
    `ids` query: a term set on `id`, which scores every entry alike and so leaves the order as it was). The facets
    count everything but the app filter, so a click on an app leaves them as they were. Fenced like every read; no
    readable container is an empty listing."""
    if not ix.has["listing"]:
        raise ListingUnsupported("listing")
    empty = {"ids": [], "snippets": [], "total": 0, "facets": [], "facetsBounded": False}
    if not containers:
        return empty
    must = [*_fence(ix, org, containers, ask.get("asOf"), documents=True)]
    query = str(ask.get("query") or "")
    if query:
        phrase = ask.get("phrase") is True
        text_query = _phrase_query(ix, query) if phrase else _text_query(ix, query, ix.knobs.title_boost, 0)
        if text_query is None:
            return empty
        must.append((tantivy.Occur.Must, text_query))
    must.extend(_between(ix, ask, "modified"))
    ids = ask.get("ids")
    if ids is not None:
        must.append((tantivy.Occur.Must, tantivy.Query.term_set_query(ix.schema, "id", [str(i) for i in ids])))
    unfiltered = tantivy.Query.boolean_query(must)
    apps = ask.get("apps")
    if apps is not None:
        must.append((tantivy.Occur.Must, tantivy.Query.term_set_query(ix.schema, "facet_app", [str(a) for a in apps])))
    page_query = tantivy.Query.boolean_query(must)
    searcher = ix.index.searcher()
    limit = max(1, min(int(ask.get("limit") or DEFAULT_LIMIT), MAX_LIMIT))
    offset = max(0, int(ask.get("offset") or 0))
    by_relevance = query != "" and ask.get("order") == "relevance"
    result = (
        searcher.search(page_query, limit=limit, offset=offset, count=True)
        if by_relevance
        else searcher.search(
            page_query, limit=limit, offset=offset, count=True, order_by_field="modified", order=tantivy.Order.Desc
        )
    )
    agg = searcher.aggregate(
        unfiltered,
        {"apps": {"terms": {"field": "facet_app", "size": MAX_FACETS},
                  "aggs": {"containers": {"terms": {"field": "facet_container", "size": MAX_FACETS}}}}},
    )
    facets = [
        {"app": app["key"], "container": box["key"], "count": box["doc_count"]}
        for app in agg["apps"]["buckets"]
        for box in app["containers"]["buckets"]
    ]
    facets.sort(key=lambda f: (-f["count"], f["app"], f["container"]))
    # A terms aggregation returns its top `MAX_FACETS` buckets and counts the rest apart: said, never dropped silently.
    rest = agg["apps"].get("sum_other_doc_count", 0) + sum(
        app["containers"].get("sum_other_doc_count", 0) for app in agg["apps"]["buckets"]
    )
    # A listing searched by words shows each entry's snippet where they fell; a listing without words, none.
    generator = _snippets(ix, searcher, _highlight(ix, query, text_query)) if query else None
    docs = [searcher.doc(addr) for _, addr in result.hits]
    return {"ids": [d.get_first("id") for d in docs], "snippets": [_snippet(generator, d) for d in docs],
            "total": result.count,
            "facets": facets, "facetsBounded": rest > 0}
