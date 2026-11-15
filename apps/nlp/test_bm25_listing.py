"""The keyword index's DOCUMENT ENTRIES and `/list` (`bm25.py` `listing`): the listing's page, total and facets from the
index, under the fence.

Self-contained, like `test_bm25.py`, whose helpers it uses: a real server on a free port, a temporary index directory.

    apps/nlp/.venv/bin/python apps/nlp/test_bm25_listing.py

- One entry per document, as the engine sends it; a passage is never a listed document. A document entry is never a
  `/search` hit, and a word only a document entry holds is never completed or corrected.
- Newest first by `modified`, paged by `offset`; the total is exact; `relevance` ranks by the words.
- `from`/`to` narrow by `modified`, inclusive, in whole seconds wider than asked; `ids` narrows to the entries named
  (Elasticsearch's `ids` query), never past the fence. Both narrow the facets; a malformed one is a 400.
- Facets count by app and container, everything but the app filter: never a connection, which could name a collection
  the reader cannot read.
- The fence: a reader of one container never counts another container's or another org's documents, in the page, the
  total or a facet; no readable container is an empty listing.
- An index built before the listing fields refuses a document entry (409), never storing it as a passage, and an index
  an earlier build's listing made still opens and lists nothing until it is rebuilt.
"""

import subprocess
import sys
import tempfile
from pathlib import Path
from urllib.error import HTTPError

sys.path.insert(0, str(Path(__file__).parent))
from test_bm25 import HOST, check, free_port, request, stop, wait_healthy  # noqa: E402


def entry(i: str, day: int, app: str, text: str, *, container: str = "c1", org: str = "o1") -> dict:
    """A document entry as the engine sends it."""
    at = f"2026-03-{day:02d}T10:00:00Z"
    return {"id": f"doc:{i}", "kind": "document", "org": org, "container": container, "occurredAt": at,
            "modified": at, "app": app, "text": text}


DOCS = [
    entry("a", 1, "drive", "Warehouse relocation plan for the Leeds site."),
    entry("b", 3, "drive", "Relocation budget, second draft.", container="c3"),
    entry("c", 5, "slack", "Standup: relocation moved to May."),
    entry("d", 7, "slack", "Lunch order for Friday, from Zanthorpe Deli."),
    entry("hidden", 9, "drive", "Relocation of the board office.", container="c2"),
    entry("hidden-chat", 8, "slack", "Relocation chatter.", container="c2"),
    entry("other-org", 9, "drive", "Relocation elsewhere.", org="o2"),
    # A passage of document a: never listed, and the document entries never answer `/search`.
    {"id": "p:a:0", "org": "o1", "container": "c1", "occurredAt": "2026-03-01T10:00:00Z",
     "text": "Warehouse relocation plan for the Leeds site."},
]


def server(tmpdir: str) -> tuple[subprocess.Popen, str]:
    port = free_port()
    proc = subprocess.Popen(
        [sys.executable, str(Path(__file__).parent / "bm25.py")],
        env={"PORT": str(port), "LOUVAIN_BM25_DIR": tmpdir, "LOUVAIN_BM25_HEAP_MB": "64"},
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
    )
    base = f"http://{HOST}:{port}"
    wait_healthy(base, proc)
    return proc, base


def older(tmpdir: str, **schema: bool) -> None:
    """An index made with an earlier schema (`bm25._schema(**schema)`), opened by this sidecar: no listing, and no
    document entry stored."""
    made = str(Path(tmpdir) / ("older-" + "-".join(sorted(schema))))
    here = str(Path(__file__).parent)
    make = (f"import os, sys; os.environ['LOUVAIN_BM25_DIR'] = {made + '-scratch'!r}; sys.path.insert(0, {here!r}); "
            f"import bm25, tantivy; tantivy.Index(bm25._schema(**{schema!r}), path={made!r})")
    Path(made).mkdir()
    subprocess.run([sys.executable, "-c", make], check=True, capture_output=True)
    proc, base = server(made)
    try:
        for path, body in (("/index", {"docs": [entry("x", 1, "drive", "Relocation.")]}),
                           ("/list", {"org": "o1", "containers": ["c1"]})):
            try:
                request(base, "POST", path, body)
                check(f"an older index ({schema}) refuses {path}", False)
            except HTTPError as err:
                check(f"an older index ({schema}) refuses {path} with 409", err.code == 409, str(err.code))
    finally:
        stop(proc)


def main() -> None:
    with tempfile.TemporaryDirectory() as tmpdir:
        proc, base = server(tmpdir)
        try:
            request(base, "POST", "/index", {"docs": DOCS})
            fence = {"org": "o1", "containers": ["c1"]}

            page = request(base, "POST", "/list", {**fence, "limit": 2})
            check("newest first, one entry a document", page["ids"] == ["doc:d", "doc:c"], str(page["ids"]))
            check("the total is exact over readable documents", page["total"] == 3, str(page["total"]))
            rest = request(base, "POST", "/list", {**fence, "limit": 10, "offset": 2})
            check("the next page", rest["ids"] == ["doc:a"], str(rest["ids"]))

            words = request(base, "POST", "/list", {**fence, "query": "relocation", "limit": 10})
            check("the words narrow the listing", set(words["ids"]) == {"doc:a", "doc:c"} and words["total"] == 2,
                  str(words))
            ranked = request(base, "POST", "/list", {**fence, "query": "warehouse relocation", "order": "relevance"})
            check("relevance ranks by the words", ranked["ids"][:1] == ["doc:a"], str(ranked["ids"]))

            apps = request(base, "POST", "/list", {**fence, "apps": ["slack"], "limit": 10})
            check("an app filter", apps["ids"] == ["doc:d", "doc:c"] and apps["total"] == 2, str(apps))
            check("the facets ignore the app filter", apps["facets"] == page["facets"], str(apps["facets"]))
            check("facets by app and container, readable documents only", page["facets"] == [
                {"app": "slack", "container": "c1", "count": 2},
                {"app": "drive", "container": "c1", "count": 1},
            ] and page["facetsBounded"] is False, str(page))
            two = request(base, "POST", "/list", {"org": "o1", "containers": ["c1", "c3"], "limit": 10})
            check("a reader of two containers counts both, and never a third", two["total"] == 4 and two["facets"] == [
                {"app": "slack", "container": "c1", "count": 2},
                {"app": "drive", "container": "c1", "count": 1},
                {"app": "drive", "container": "c3", "count": 1},
            ], str(two))

            # `from`/`to` on `modified`, inclusive, in whole seconds wider than asked: c is 2026-03-05T10:00:00Z.
            span = request(base, "POST", "/list", {**fence, "from": "2026-03-02T00:00:00Z",
                                                   "to": "2026-03-05T10:00:00Z", "limit": 10})
            check("from/to narrow by modified, inclusive", span["ids"] == ["doc:c"] and span["total"] == 1, str(span))
            check("from/to narrow the facets too", span["facets"] == [{"app": "slack", "container": "c1", "count": 1}],
                  str(span["facets"]))
            inside = request(base, "POST", "/list", {**fence, "from": "2026-03-05T10:00:00.900Z",
                                                     "to": "2026-03-05T09:59:59.100Z", "limit": 10})
            check("an edge inside the same second is kept (the engine re-checks it)", inside["ids"] == ["doc:c"],
                  str(inside))
            since = request(base, "POST", "/list", {**fence, "from": "2026-03-04T00:00:00Z", "limit": 10})
            check("from alone", since["ids"] == ["doc:d", "doc:c"], str(since))
            until = request(base, "POST", "/list", {**fence, "to": "2026-03-04T00:00:00Z", "limit": 10})
            check("to alone", until["ids"] == ["doc:a"], str(until))

            named = request(base, "POST", "/list", {**fence, "ids": ["doc:a", "doc:d", "doc:hidden", "doc:nope"],
                                                    "limit": 10})
            check("ids narrow to the entries named, newest first", named["ids"] == ["doc:d", "doc:a"]
                  and named["total"] == 2, str(named))
            check("ids never reach past the fence", "doc:hidden" not in named["ids"], str(named))
            both = request(base, "POST", "/list", {**fence, "ids": ["doc:a", "doc:c"], "query": "relocation",
                                                   "from": "2026-03-04T00:00:00Z", "limit": 10})
            check("ids, words and from/to together", both["ids"] == ["doc:c"], str(both))
            none = request(base, "POST", "/list", {**fence, "ids": [], "limit": 10})
            check("no ids named lists nothing", none["ids"] == [] and none["total"] == 0, str(none))
            for body, why in (({"ids": "doc:a"}, "ids not a list"), ({"ids": ["doc:a", ""]}, "an empty id"),
                              ({"from": "yesterday"}, "from not an instant"), ({"to": 5}, "to not a string")):
                try:
                    request(base, "POST", "/list", {**fence, **body})
                    check(f"{why} is refused", False)
                except HTTPError as err:
                    check(f"{why} is a 400", err.code == 400, str(err.code))

            empty = request(base, "POST", "/list", {"org": "o1", "containers": [], "limit": 10})
            check("no readable container lists nothing",
                  empty == {"ids": [], "snippets": [], "total": 0, "facets": [], "facetsBounded": False}, str(empty))

            hits = request(base, "POST", "/search", {**fence, "query": "relocation", "limit": 20})["hits"]
            check("a search reads passages only", [h["id"] for h in hits] == ["p:a:0"], str(hits))
            for word in ("zanthorpe", "zanthorp", "zanthorpi", "lunch zanthorpi"):
                page = request(base, "POST", "/search", {**fence, "query": word, "limit": 20, "strategy": "last"})
                check(f"a word only a document entry holds is never completed or corrected ({word})",
                      page["hits"] == [] and page["completed"] == [] and page["corrected"] == [], str(page))
        finally:
            stop(proc)
        older(tmpdir, listing=False)
        older(tmpdir, series=True)
        print("ok: test_bm25_listing")


if __name__ == "__main__":
    main()
