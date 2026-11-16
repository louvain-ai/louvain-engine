"""`/search` with `titles: {"need": n}` (`bm25_query.py` `_title_query`): the search's words asked of the title alone.

Self-contained, like `test_bm25.py`, whose helpers it uses: a real server on a free port, a temporary index directory.
Every document here is invented.

    services/keyword-index/.venv/bin/python services/keyword-index/test_bm25_titles.py

- A record is a match only when its TITLE holds at least `need` of the search's words; its text does not count.
- BM25 ranks: a title sharing the search's rare words leads titles sharing only its common ones, however many of
  those the workspace holds, and the limit bounds what comes back.
- The fence is the same as any search's: another org's or collection's title never comes back.
- `need` is an integer from 1 to 8, anything else a 400; titles takes no `strategy`.
"""

import sys
import tempfile
from pathlib import Path
from urllib.error import HTTPError

sys.path.insert(0, str(Path(__file__).parent))
from test_bm25 import check, request, stop  # noqa: E402
from test_bm25_upgrade import server  # noqa: E402


def doc(i: str, title: str, text: str = "Notes.", *, org: str = "o1", container: str = "c1") -> dict:
    return {"id": i, "org": org, "container": container, "occurredAt": "2026-03-01T10:00:00Z", "title": title,
            "text": text}


# Forty titles share the common words "weekly", "team" and "notes"; one names the harbour lease.
COMMON = [doc(f"weekly-{n}", f"Weekly team notes {n}") for n in range(40)]
DOCS = [
    *COMMON,
    doc("lease", "Harbour lease renewal"),
    doc("lease-body", "Quarterly plan", "The harbour lease renewal is in May."),
    doc("one-word", "Harbour photos"),
    doc("intent", "Letter of intent"),
    doc("elsewhere", "Harbour lease renewal", org="o2"),
    doc("hidden", "Harbour lease renewal", container="c2"),
]


def search(base: str, query: str, **extra: object) -> list[str]:
    body = {"org": "o1", "containers": ["c1"], "query": query, "limit": 10, "titles": {"need": 2}, **extra}
    return [h["id"] for h in request(base, "POST", "/search", body)["hits"]]


def status(base: str, **extra: object) -> int:
    try:
        search(base, "harbour lease", **extra)
        return 200
    except HTTPError as err:
        return err.code


def main() -> None:
    with tempfile.TemporaryDirectory(prefix="bm25-titles-") as tmpdir:
        proc, base = server(tmpdir)
        try:
            request(base, "POST", "/index", {"docs": DOCS})
            found = search(base, "weekly team notes on the harbour lease renewal")
            check("the title naming the rare words leads every title of common ones", found[:1] == ["lease"], str(found))
            check("the limit bounds the read", len(found) == 10, str(found))
            check("a record whose text alone holds the words is not a title match", "lease-body" not in found)
            check("a title sharing one word is not a match at need 2", "one-word" not in search(base, "harbour lease"))
            check("another org's or collection's title never comes back",
                  not {"elsewhere", "hidden"} & set(search(base, "harbour lease renewal")))
            check("a stop word is not a shared word", "intent" not in search(base, "letter of support"))
            check("need 1 takes one word", "one-word" in search(base, "harbour", titles={"need": 1}))
            check("a need past the search's words asks for all of them",
                  search(base, "harbour lease", titles={"need": 3}) == ["lease"])
            check("need 0 is a 400", status(base, titles={"need": 0}) == 400)
            check("need 9 is a 400", status(base, titles={"need": 9}) == 400)
            check("a need that is not an integer is a 400", status(base, titles={"need": "2"}) == 400)
            check("titles takes no strategy", status(base, strategy="last") == 400)
        finally:
            stop(proc)
    print("ok: test_bm25_titles")


if __name__ == "__main__":
    main()
