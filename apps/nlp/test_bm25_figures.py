"""The `figures` field and narrowing (`bm25.py`): whether a record states a figure, as the engine sends it.

Self-contained, like `test_bm25.py`, whose helpers it uses: real servers on free ports, temporary index directories.
Every document here is invented.

    apps/nlp/.venv/bin/python apps/nlp/test_bm25_figures.py

- `figures: true` keeps only the records the engine marked as stating a figure, as a must clause beside the fence: a
  record holding the words without a figure is not found, another org's or container's never is, and a search without
  it finds them all. It holds under the strategy `last` too.
- `figures` must be a boolean (400 otherwise); `false` narrows nothing.
- An index built before the field (an older sidecar's) refuses the narrowing with 409 `filter_unsupported`, still
  serves the rest, and asks for a rebuild in `/healthz`.
"""

import subprocess
import sys
import tempfile
from pathlib import Path
from urllib.error import HTTPError

sys.path.insert(0, str(Path(__file__).parent))
from test_bm25 import HOST, check, free_port, request, stop, wait_healthy  # noqa: E402

AT = "2026-03-01T10:00:00Z"


def doc(i: str, text: str, figures: bool, org: str = "o1", container: str = "c1") -> dict:
    return {"id": i, "org": org, "container": container, "occurredAt": AT, "text": text, "figures": figures}


DOCS = [
    doc("priced", "The harbour lease costs 2,400 a month.", True),
    doc("dated", "The harbour lease renews on 1 March.", True),
    doc("plain", "The harbour lease renews every spring.", False),
    doc("elsewhere", "The harbour lease costs 2,400 a month.", True, org="o2"),
    doc("hidden", "The harbour lease costs 2,400 a month.", True, container="c2"),
]


def start(index_dir: str) -> tuple[subprocess.Popen, str]:
    port = free_port()
    proc = subprocess.Popen(
        [sys.executable, str(Path(__file__).parent / "bm25.py")],
        env={"PORT": str(port), "LOUVAIN_BM25_DIR": index_dir, "LOUVAIN_BM25_HEAP_MB": "64"},
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
    )
    base = f"http://{HOST}:{port}"
    wait_healthy(base, proc)
    return proc, base


def ids(base: str, **extra: object) -> list[str]:
    body = {"org": "o1", "containers": ["c1"], "query": "harbour lease", "limit": 10, **extra}
    return sorted(h["id"] for h in request(base, "POST", "/search", body)["hits"])


def status(base: str, **extra: object) -> int:
    try:
        ids(base, **extra)
        return 200
    except HTTPError as err:
        return err.code


def main() -> None:
    with tempfile.TemporaryDirectory(prefix="bm25-figures-") as tmpdir:
        proc, base = start(tmpdir)
        try:
            request(base, "POST", "/index", {"docs": DOCS})
            check("without the narrowing every readable record", ids(base) == ["dated", "plain", "priced"], str(ids(base)))
            check("figures keeps those that state one, never another org's or container's",
                  ids(base, figures=True) == ["dated", "priced"], str(ids(base, figures=True)))
            check("and under the strategy last", ids(base, figures=True, strategy="last") == ["dated", "priced"],
                  str(ids(base, figures=True, strategy="last")))
            check("false narrows nothing", ids(base, figures=False) == ["dated", "plain", "priced"])
            check("a figures that is not a boolean is a 400", status(base, figures="yes") == 400)
            check("an index this release builds asks for no rebuild",
                  request(base, "GET", "/healthz")["rebuild"] is False)
        finally:
            stop(proc)

        older = str(Path(tmpdir) / "older")
        Path(older).mkdir()
        here = str(Path(__file__).parent)
        make = (f"import os, sys; os.environ['LOUVAIN_BM25_DIR'] = {older + '-scratch'!r}; sys.path.insert(0, {here!r}); "
                f"import bm25, tantivy; tantivy.Index(bm25._schema(figures=False), path={older!r})")
        subprocess.run([sys.executable, "-c", make], check=True, capture_output=True)
        proc, base = start(older)
        try:
            request(base, "POST", "/index", {"docs": DOCS})
            check("an index built before the field refuses the narrowing with 409", status(base, figures=True) == 409)
            check("under the strategy last too", status(base, figures=True, strategy="last") == 409)
            check("still serves the rest", ids(base) == ["dated", "plain", "priced"], str(ids(base)))
            check("and asks for a rebuild", request(base, "GET", "/healthz")["rebuild"] is True)
        finally:
            stop(proc)
    print("ok: test_bm25_figures")


if __name__ == "__main__":
    main()
