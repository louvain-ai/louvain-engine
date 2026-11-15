"""A document's TITLE as the engine sends it, and ACCENTS folded in every analyzer (`bm25.py`).

Self-contained, like `test_bm25.py`, whose helpers it uses: real servers on free ports, temporary index directories.
Every document here is invented.

    apps/nlp/.venv/bin/python apps/nlp/test_bm25_title_fold.py

- A title the engine sends is the `title` field, and its analyzer forms join the header's: a slug title (`note-05`,
  `field-service-scheduling-notes-5`) is found however a key is typed, though the text never says it. With no title
  sent, the first line stands, and a document whose text alone holds nothing of the key is not found by it.
- Accents are folded on both sides: "Zoë" is found by `zoe` and by `Zoë`, "café" by `cafe`, with the analyzer off and
  on, and under the strategy `last`; the fold never reaches past the fence.
- An index built before the fold opens, is asked as it was built (with the analyzer off, an accented word matches as
  written), says so at boot and asks for a rebuild in `/healthz`.
"""

import subprocess
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from test_bm25 import HOST, check, free_port, request, stop, wait_healthy  # noqa: E402

AT = "2025-06-01T00:00:00Z"
DOCS = [
    {"id": "slug", "org": "o1", "container": "c1", "occurredAt": AT, "title": "note-05",
     "text": "Weekly rota\nThe engineers swap shifts on Fridays."},
    {"id": "untitled", "org": "o1", "container": "c1", "occurredAt": AT,
     "text": "Weekly rota\nThe engineers swap shifts on Fridays."},
    {"id": "long-slug", "org": "o1", "container": "c1", "occurredAt": AT, "title": "field-service-scheduling-notes-5",
     "text": "Dispatch\nVans leave the depot at seven."},
    {"id": "zoe", "org": "o1", "container": "c1", "occurredAt": AT, "text": "Zoë Marchetti joined the café team."},
    {"id": "zoe-elsewhere", "org": "o2", "container": "c1", "occurredAt": AT, "text": "Zoë Marchetti, another org."},
]


def start(tmpdir: str, on: bool) -> tuple[subprocess.Popen, str]:
    port = free_port()
    env = {"PORT": str(port), "LOUVAIN_BM25_DIR": tmpdir, "LOUVAIN_BM25_HEAP_MB": "64",
           "LOUVAIN_BM25_ANALYZER": "on" if on else "off"}
    proc = subprocess.Popen(
        [sys.executable, str(Path(__file__).parent / "bm25.py")],
        env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
    )
    base = f"http://{HOST}:{port}"
    wait_healthy(base, proc)
    return proc, base


def ids(base: str, query: str, **extra: object) -> list[str]:
    r = request(base, "POST", "/search", {"org": "o1", "containers": ["c1"], "query": query, "limit": 10, **extra})
    return [h["id"] for h in r["hits"]]


def titles_and_accents() -> None:
    for on in (False, True):
        with tempfile.TemporaryDirectory(prefix="bm25-title-fold-") as tmpdir:
            proc, base = start(tmpdir, on)
            try:
                request(base, "POST", "/index", {"docs": DOCS})
                label = "ON" if on else "OFF"
                check(f"{label}: an index this release builds asks for no rebuild",
                      request(base, "GET", "/healthz")["rebuild"] is False)
                for query in ("zoe", "Zoë", "ZOE marchetti", "cafe", "café"):
                    found = ids(base, query)
                    check(f"{label}: {query!r} finds Zoë's document, never another org's", found == ["zoe"], str(found))
                last = ids(base, "zoe marchetti", strategy="last")
                check(f"{label}: under the strategy last too", last == ["zoe"], str(last))
                if on:
                    for query in ("note-05", "note05", "note 5"):
                        found = ids(base, query)
                        check(f"ON: {query!r} finds the document titled note-05", "slug" in found, str(found))
                        check(f"ON: and never its untitled twin ({query!r})", "untitled" not in found, str(found))
                    found = ids(base, "notes5")
                    check("ON: a run inside a slug title finds it", found == ["long-slug"], str(found))
                    found = ids(base, "field-service-scheduling-notes-5")
                    check("ON: the slug title as written finds it first", found[:1] == ["long-slug"], str(found))
                found = ids(base, "rota")
                check(f"{label}: with no title sent, the first line stands", "untitled" in found, str(found))
            finally:
                stop(proc)


def older() -> None:
    """An index built before the fold: tantivy's `en_stem` and the unfolded `en_exact`."""
    with tempfile.TemporaryDirectory(prefix="bm25-unfolded-") as tmpdir:
        made = str(Path(tmpdir) / "unfolded")
        here = str(Path(__file__).parent)
        make = (f"import os, sys; os.environ['LOUVAIN_BM25_DIR'] = {made + '-scratch'!r}; sys.path.insert(0, {here!r}); "
                f"import bm25, tantivy; tantivy.Index(bm25._schema(folded=False, stored_text=False), path={made!r})")
        Path(made).mkdir()
        subprocess.run([sys.executable, "-c", make], check=True, capture_output=True)
        proc, base = start(made, False)
        try:
            check("an unfolded index asks for a rebuild", request(base, "GET", "/healthz")["rebuild"] is True)
            request(base, "POST", "/index", {"docs": DOCS})
            check("and is asked as it was built: Zoë as written", ids(base, "Zoë") == ["zoe"], str(ids(base, "Zoë")))
            check("its accented words are not yet folded", ids(base, "zoe") == [], str(ids(base, "zoe")))
        finally:
            stop(proc)
            boot = proc.stdout.read().decode() if proc.stdout else ""
        check("it says so at boot", "predates the accent fold" in boot, boot[-300:])


def main() -> None:
    titles_and_accents()
    older()
    print("ok: test_bm25_title_fold")


if __name__ == "__main__":
    main()
