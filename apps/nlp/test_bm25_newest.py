"""`/search` with `order: "newest"` (`bm25_query.py` `search`): the fenced matches sorted by when each record was said.

Self-contained, like `test_bm25.py`, whose helpers it uses: a real server on a free port, a temporary index directory.
Every document here is invented.

    apps/nlp/.venv/bin/python apps/nlp/test_bm25_newest.py

- The matches come newest first by `occurredAt`, whatever their BM25 (a sort, not a ranking: each score is 0), and a
  record holding none of the words is not one of them.
- The fence and the narrowings are the same as a ranked search's: another org's or container's record never comes
  back, and `from`/`to` and `figures` still narrow.
- `order` is `relevance` (the default) or `newest`, anything else a 400; `newest` takes no `strategy`.
"""

import sys
import tempfile
from pathlib import Path
from urllib.error import HTTPError

sys.path.insert(0, str(Path(__file__).parent))
from test_bm25 import check, request, stop  # noqa: E402
from test_bm25_upgrade import server  # noqa: E402


def doc(i: str, day: int, text: str, *, org: str = "o1", container: str = "c1", figures: bool = False) -> dict:
    return {"id": i, "org": org, "container": container, "occurredAt": f"2026-03-{day:02d}T10:00:00Z", "text": text,
            "figures": figures}


DOCS = [
    # The oldest says "renewal" three times, so it ranks first by BM25 and last by date.
    doc("old", 1, "Renewal, renewal, renewal: the harbour renewal."),
    doc("mid", 5, "The harbour renewal moved to May, at 2,400 a month.", figures=True),
    doc("new", 9, "A note on the renewal."),
    doc("unrelated", 12, "Lunch order for Friday."),
    doc("elsewhere", 20, "The renewal, in another org.", org="o2"),
    doc("hidden", 21, "The renewal, in a collection the reader cannot open.", container="c2"),
]


def ids(base: str, **extra: object) -> list[str]:
    body = {"org": "o1", "containers": ["c1"], "query": "renewal", "limit": 10, **extra}
    return [h["id"] for h in request(base, "POST", "/search", body)["hits"]]


def status(base: str, **extra: object) -> int:
    try:
        ids(base, **extra)
        return 200
    except HTTPError as err:
        return err.code


def main() -> None:
    with tempfile.TemporaryDirectory(prefix="bm25-newest-") as tmpdir:
        proc, base = server(tmpdir)
        try:
            request(base, "POST", "/index", {"docs": DOCS})
            check("ranked, the oldest leads by BM25", ids(base)[:1] == ["old"], str(ids(base)))
            newest = request(base, "POST", "/search",
                             {"org": "o1", "containers": ["c1"], "query": "renewal", "limit": 10, "order": "newest"})
            check("newest first, only the matches, never another org's or container's",
                  [h["id"] for h in newest["hits"]] == ["new", "mid", "old"], str(newest))
            check("a sort, not a ranking: each score is 0", all(h["score"] == 0 for h in newest["hits"]))
            check("a range still narrows", ids(base, order="newest", to="2026-03-06T00:00:00Z") == ["mid", "old"])
            check("figures still narrows", ids(base, order="newest", figures=True) == ["mid"])
            check("the limit cuts the newest", ids(base, order="newest", limit=2) == ["new", "mid"])
            check("another order is a 400", status(base, order="oldest") == 400)
            check("newest takes no strategy", status(base, order="newest", strategy="last") == 400)
        finally:
            stop(proc)
    print("ok: test_bm25_newest")


if __name__ == "__main__":
    main()
