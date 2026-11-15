"""`/search` under `strategy: "last"` (`bm25.py` `search_last`): Meilisearch's matching
strategy, Elasticsearch's relevance recipe within each tier, under the fence.

Self-contained, like `test_bm25.py`, whose helpers it uses: a real server on a free port, a temporary index directory.

    apps/nlp/.venv/bin/python apps/nlp/test_bm25_last.py

- Every word first, then the words less the last: a document holding all of them leads one holding fewer.
- A stop word is no word; a phrase's words close together outrank the same words apart.
- A word no readable document holds becomes a clause of the one query: the last a prefix ("SUP-102"), another a fuzzy
  term; a held key is never widened and a complete key never edited; the page names the words, never the terms.
- The fence: a hidden document is never a hit, a completion or a correction, and no readable container is nothing.
"""

import subprocess
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from test_bm25 import HOST, check, free_port, request, stop, wait_healthy  # noqa: E402


def doc(i: str, text: str, container: str = "c1") -> dict:
    return {"id": i, "org": "o1", "container": container, "occurredAt": "2026-03-01T10:00:00Z", "text": text,
            "header": i}


DOCS = [
    doc("both", "The warehouse relocation starts in May."),
    doc("apart", "Relocation of the office; the warehouse stays where it is, says the plan for the warehouse."),
    doc("one", "Warehouse keys are kept at the front desk."),
    doc("sup-1042", "SUP-1042 Invoice export times out."),
    doc("sup-1043", "SUP-1043 Credit notes export."),
    doc("sup-1027", "SUP-1027 Barcode labels print blank."),
    doc("hidden-1029", "SUP-1029 Velmora appendix, warehouse relocation.", container="c2"),
    doc("hidden-word", "Thornquist is the secret name.", container="c2"),
    doc("qx-5501", "QX-5501 Gear pump datasheet."),
    doc("qx-5501-lines", "QX-5501 line items: " + "; ".join(f"QX-5501-{n:03d} seal kit" for n in range(1, 121))),
    doc("qx-5507", "QX-5507 Gear pump datasheet."),
]


def search(base: str, query: str, containers: list[str] | None = None) -> dict:
    fence = ["c1"] if containers is None else containers
    return request(base, "POST", "/search",
                   {"org": "o1", "containers": fence, "query": query, "limit": 20, "strategy": "last"})


def ids(page: dict) -> list[str]:
    return [h["id"] for h in page["hits"]]


def main() -> None:
    with tempfile.TemporaryDirectory() as tmpdir:
        port = free_port()
        proc = subprocess.Popen(
            [sys.executable, str(Path(__file__).parent / "bm25.py")],
            env={"PORT": str(port), "LOUVAIN_BM25_DIR": tmpdir, "LOUVAIN_BM25_HEAP_MB": "64",
                 "LOUVAIN_BM25_ANALYZER": "on"},
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
        )
        base = f"http://{HOST}:{port}"
        try:
            wait_healthy(base, proc)
            request(base, "POST", "/index", {"docs": DOCS})

            page = search(base, "warehouse relocation")
            check("every word first, closer words ahead", ids(page)[:2] == ["both", "apart"], str(ids(page)))
            check("then the words less the last", ids(page)[2:] == ["one"], str(ids(page)))
            check("a tier says how many words it held", [h["words"] for h in page["hits"]] == [2, 2, 1], str(page))
            stops = search(base, "what is the warehouse relocation")
            check("a stop word is no word (Snowball's list: what, is, the)", ids(stops)[:2] == ["both", "apart"],
                  str(ids(stops)))

            key = search(base, "SUP-1042")
            check("a held key is the key alone", ids(key) == ["sup-1042"], str(ids(key)))
            unfinished = search(base, "SUP-102")
            check("an unfinished key completes, readable only", ids(unfinished) == ["sup-1027"], str(unfinished))
            check("and names the word, never the terms", unfinished["completed"] == ["SUP-102"], str(unfinished))
            unheld = search(base, "SUP-1044")
            check("a complete key is never edited", ids(unheld) == [], str(unheld))

            typo = search(base, "warehouse relocaton")
            check("a word nothing holds is read as the word it is near", set(ids(typo)[:2]) == {"both", "apart"},
                  str(ids(typo)))
            check("and names the word, never the terms", typo["corrected"] == ["relocaton"], str(typo))
            first = search(base, "warehouse telocation")
            check("a typo in the first letter is a typo like any other (Meilisearch's thresholds alone)",
                  set(ids(first)[:2]) == {"both", "apart"} and first["corrected"] == ["telocation"], str(first))

            for hidden, nobody in (("Thornquist", "Brackwater"), ("Thornquis", "Brackwate"), ("Velmora", "Quilmore")):
                seen = search(base, f"warehouse {hidden}")
                unseen = search(base, f"warehouse {nobody}")
                check(f"a word only hidden documents hold reads as one nobody holds ({hidden})",
                      str(seen).replace(hidden, "?") == str(unseen).replace(nobody, "?"), f"{seen} / {unseen}")
                check(f"and is not asked, said ({hidden})", seen["dropped"] == [hidden], str(seen))

            missing = search(base, "status warehouse relocation")
            check("a word nobody holds is not asked", ids(missing)[:2] == ["both", "apart"], str(ids(missing)))
            check("and the page says so", missing["dropped"] == ["status"], str(missing))
            kept = search(base, "warehouse keys relocation")
            check("a held word is never dropped", kept["dropped"] == [] and ids(kept)[:1] == ["one"], str(kept))
            check("no readable container is nothing", ids(search(base, "warehouse", [])) == [])

            sibling = search(base, "QX-550")
            check("a key's numbered extensions never hide its sibling",
                  set(ids(sibling)) == {"qx-5501", "qx-5501-lines", "qx-5507"}, str(sibling))
            whole = search(base, "SUP-1042")
            check("a held key is never widened", whole["completed"] == [] and ids(whole) == ["sup-1042"], str(whole))
            check("asked counts the first tier's words, a dropped one not among them",
                  missing["asked"] == 2 and kept["asked"] == 3, f"{missing['asked']} {kept['asked']}")
            narrowed = request(base, "POST", "/search", {"org": "o1", "containers": ["c1"], "query": "warehouse",
                                                         "limit": 20, "strategy": "last", "ids": ["apart", "one"]})
            check("ids narrows to those entries", set(ids(narrowed)) <= {"apart", "one"} and ids(narrowed),
                  str(narrowed))
            print("ok: test_bm25_last")
        finally:
            stop(proc)
        analyzer_off(tmpdir)


def analyzer_off(tmpdir: str) -> None:
    """With `LOUVAIN_BM25_ANALYZER` off, as a plain index runs, the strategy still asks a key as its joined form: never
    its parts, which every sibling key shares."""
    port = free_port()
    made = str(Path(tmpdir) / "analyzer-off")
    proc = subprocess.Popen(
        [sys.executable, str(Path(__file__).parent / "bm25.py")],
        env={"PORT": str(port), "LOUVAIN_BM25_DIR": made, "LOUVAIN_BM25_HEAP_MB": "64"},
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
    )
    base = f"http://{HOST}:{port}"
    try:
        wait_healthy(base, proc)
        request(base, "POST", "/index", {"docs": DOCS})
        key = search(base, "SUP-1042")
        check("with the analyzer off, a key is still the key alone", ids(key) == ["sup-1042"], str(ids(key)))
    finally:
        stop(proc)


if __name__ == "__main__":
    main()
