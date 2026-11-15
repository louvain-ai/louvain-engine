"""SNIPPETS (`bm25_query.py` `_snippet`): every `/search` and `/list` hit carries tantivy's snippet of its own text.

Self-contained, like `test_bm25.py`, whose helpers it uses: real servers on free ports, temporary index directories.
Every document here is invented.

    apps/nlp/.venv/bin/python apps/nlp/test_bm25_snippets.py

- A hit's snippet is a fragment of ITS text holding the search's words, each marked by `[start, end)` offsets into the
  fragment, as tantivy's `SnippetGenerator` gives it; stemmed matches are marked as the text wrote them. So the engine
  shows the passage that holds the fragment, a substring, with no SQL.
- The same under `order: "newest"` and the strategy `last`, and on `/list` searched by words; a listing without words
  carries none.
- Only fenced hits carry one: another org's text is never a snippet.
- An index built before the text was stored opens, carries no snippet, and asks for a rebuild.
"""

import subprocess
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from test_bm25 import check, request, stop  # noqa: E402
from test_bm25_upgrade import server  # noqa: E402

AT = "2026-03-01T10:00:00Z"
LEASE = ("The harbour office moves in spring. The lease renews in March, and the rent rises by three percent. "
         "Notice is due sixty days before.")
DOCS = [
    {"id": "lease", "org": "o1", "container": "c1", "occurredAt": AT, "text": LEASE},
    {"id": "other", "org": "o2", "container": "c1", "occurredAt": AT, "text": "A secret lease renewal elsewhere."},
    {"id": "doc:lease", "kind": "document", "org": "o1", "container": "c1", "occurredAt": AT, "modified": AT,
     "app": "drive", "text": LEASE},
]


def marked(snippet: dict) -> list[str]:
    return [snippet["text"][a:b] for a, b in snippet["marks"]]


def main() -> None:
    fence = {"org": "o1", "containers": ["c1"]}
    with tempfile.TemporaryDirectory(prefix="bm25-snippets-") as tmpdir:
        proc, base = server(tmpdir)
        try:
            request(base, "POST", "/index", {"docs": DOCS})
            for label, extra in (("ranked", {}), ("newest", {"order": "newest"}), ("last", {"strategy": "last"})):
                hits = request(base, "POST", "/search", {**fence, "query": "lease renewal", "limit": 5, **extra})["hits"]
                check(f"{label}: one fenced hit", [h["id"] for h in hits] == ["lease"], str(hits))
                snippet = hits[0]["snippet"]
                check(f"{label}: the snippet is a fragment of its own text", snippet and snippet["text"] in LEASE,
                      str(snippet))
                words = marked(snippet)
                check(f"{label}: the words are marked as written (renewal matches renews)",
                      "lease" in words and "renews" in words, str(words))
                check(f"{label}: never another org's text", "secret" not in snippet["text"])
            listed = request(base, "POST", "/list", {**fence, "query": "rent", "limit": 5})
            check("a listing searched by words carries each entry's snippet",
                  listed["ids"] == ["doc:lease"] and marked(listed["snippets"][0]) == ["rent"], str(listed))
            bare = request(base, "POST", "/list", {**fence, "limit": 5})
            check("a listing without words carries none", bare["snippets"] == [None], str(bare))
            check("an index this release builds asks for no rebuild",
                  request(base, "GET", "/healthz")["rebuild"] is False)
        finally:
            stop(proc)

        older = str(Path(tmpdir) / "older")
        Path(older).mkdir()
        here = str(Path(__file__).parent)
        make = (f"import os, sys; os.environ['LOUVAIN_BM25_DIR'] = {older + '-scratch'!r}; sys.path.insert(0, {here!r}); "
                f"import bm25_schema, tantivy; tantivy.Index(bm25_schema._schema(stored_text=False), path={older!r})")
        subprocess.run([sys.executable, "-c", make], check=True, capture_output=True)
        proc, base = server(older)
        try:
            request(base, "POST", "/index", {"docs": DOCS})
            hits = request(base, "POST", "/search", {**fence, "query": "lease", "limit": 5})["hits"]
            check("an index built before stored text still searches", [h["id"] for h in hits] == ["lease"])
            check("with no snippet", hits[0]["snippet"] is None, str(hits))
            check("and asks for a rebuild", request(base, "GET", "/healthz")["rebuild"] is True)
        finally:
            stop(proc)
            boot = proc.stdout.read().decode() if proc.stdout else ""
        check("it says so at boot", "predates stored text" in boot, boot[-300:])
    print("ok: test_bm25_snippets")


if __name__ == "__main__":
    main()
