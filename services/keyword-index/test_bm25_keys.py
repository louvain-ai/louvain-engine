"""`/keys` (`bm25.py`) and `analyzer.lead`: the key a text opens with, in the analyzer's own catenated form, so a caller
compares a search's key with a title's here and never in a second implementation of the word-delimiter step.

Self-contained, like `test_bm25.py`, whose helpers it uses: a real server on a free port, a temporary index directory.

    services/keyword-index/.venv/bin/python services/keyword-index/test_bm25_keys.py

- Every spelling of a key gives one form: "SUP-1042", "sup1042", "Sup-1042" and "SUP1042" are sup1042.
- A title opens with the key after at most one bracket, and a following ":" or space ends it; a key that only appears
  later, or one that continues ("ENG-4902-retro", "ENG-4902.1"), is another or none.
- `texts` must be a list of strings, at most the index's cap and one; anything else is a 400.
- A key or figure searched has a snippet where the text writes it (the highlight query, Elasticsearch's
  `highlight_query`): the match asks a key of its joined form, the snippet marks it where prose writes its parts.
- `/list` with `phrase: true` is Elasticsearch's `match_phrase`: the words side by side in a document's text or header,
  a key as its joined form, so a document holding the words apart, or some of them, is not one of them.
"""

import sys
import tempfile
from pathlib import Path
from urllib.error import HTTPError

sys.path.insert(0, str(Path(__file__).parent))
import analyzer  # noqa: E402
from test_bm25 import check, request, stop  # noqa: E402
from test_bm25_upgrade import server  # noqa: E402

CASES = [
    ("SUP-1042", "sup1042"),
    ("sup1042", "sup1042"),
    ("Sup-1042", "sup1042"),
    ("SUP1042", "sup1042"),
    ("SUP-1042 Printer queue stalls", "sup1042"),
    ("[ENG-4902] Retro", "eng4902"),
    ("(ENG-4902) Retro", "eng4902"),
    ("ENG-4902: Retro", "eng4902"),
    ("ENG-4902-retro notes", "eng4902retro"),
    ("ENG-4902.1 follow-up", "eng49021"),
    ("Printer SUP-1042", None),
    ("Retro notes", None),
    ("", None),
]


def entry(i: str, text: str, header: str | None = None) -> dict:
    """A document entry as the engine sends it."""
    at = "2026-03-01T10:00:00Z"
    return {"id": f"doc:{i}", "kind": "document", "org": "o1", "container": "c1", "occurredAt": at, "modified": at,
            "text": text, **({"header": header} if header else {})}


PHRASED = [
    entry("side", "The supplier invoice approval went through on Monday."),
    entry("header", "Signed off.", header="Supplier invoice approval, March"),
    entry("apart", "The supplier sent an invoice; approval waits on finance."),
    entry("some", "Supplier contract renewal."),
    entry("key", "Escalated from SUP-1042 overnight."),
    entry("sibling", "Escalated from SUP-1043 overnight."),
]


RECORDS = [
    {"id": "r:cite", "org": "o1", "container": "c1", "occurredAt": "2026-03-02T10:00:00Z",
     "text": "Weekly review. Escalated to engineering from SUP-1042 after the second jam; the price list says GBP 2,400."},
]


def marked(base: str, query: str) -> list[str]:
    """Each hit's marked words, as the snippet's text cut at its marks."""
    body = {"org": "o1", "containers": ["c1"], "query": query, "limit": 10, "strategy": "last"}
    hits = request(base, "POST", "/search", body)["hits"]
    return [s["text"][a:b] for h in hits if (s := h.get("snippet")) for a, b in s["marks"]]


def listed(base: str, query: str) -> set[str]:
    body = {"org": "o1", "containers": ["c1"], "query": query, "phrase": True, "limit": 50}
    return set(request(base, "POST", "/list", body)["ids"])


def status(base: str, body: dict) -> int:
    try:
        request(base, "POST", "/keys", body)
        return 200
    except HTTPError as err:
        return err.code


def main() -> None:
    for text, want in CASES:
        check(f"lead({text!r}) is {want!r}", analyzer.lead(text) == want, str(analyzer.lead(text)))
    with tempfile.TemporaryDirectory(prefix="bm25-keys-") as tmpdir:
        proc, base = server(tmpdir)
        try:
            got = request(base, "POST", "/keys", {"texts": [text for text, _ in CASES]})["leads"]
            check("the endpoint gives the analyzer's forms, in order", got == [want for _, want in CASES], str(got))
            check("texts must be a list", status(base, {"texts": "SUP-1042"}) == 400)
            check("of strings", status(base, {"texts": [1]}) == 400)
            check("at most the cap and one", status(base, {"texts": ["a"] * 202}) == 400)
            request(base, "POST", "/index", {"docs": PHRASED + RECORDS})
            for query, want in (("SUP-1042", "SUP"), ("sup1042", "SUP"), ("2,400", "2")):
                got = marked(base, query)
                check(f"a snippet marks the key {query!r} where the text writes it", want in got, str(got))
            got = listed(base, "supplier invoice approval")
            check("a phrase: side by side in the text or the header", got == {"doc:side", "doc:header"}, str(got))
            got = listed(base, "sup1042")
            check("a key, joined or not, and never a sibling", got == {"doc:key"}, str(got))
        finally:
            stop(proc)
    print("ok: test_bm25_keys")


if __name__ == "__main__":
    main()
