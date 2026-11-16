"""One keyword index per workspace (`bm25_orgs.py`): no other workspace's documents move a reader's ranking or snippets.

    apps/nlp/.venv/bin/python apps/nlp/test_bm25_orgs.py

- A workspace's scores and snippets are the same with another workspace's documents loaded as without them, though
  the other's documents share its words (in one shared index they moved its BM25 statistics).
- A read never makes an index: a search or a listing for a workspace with none is empty, and leaves no directory.
- A delete names ids only, and reaches the workspace each was written for (the directory of entries); an id written
  again for another workspace leaves the first; an id never written is a no-op.
- A commit with no documents (the engine's group commit) commits every workspace's pending adds; a commit that fails
  leaves them pending, so the client's retry commits them, never a 200 that committed nothing.
- `/delete_org` removes one workspace's index and nothing of another's.
- An index from before this layout, shared at the root of the directory, is never read, and `/healthz` asks for the
  rebuild; `/healthz` counts every workspace's entries, and names none.
"""

import subprocess
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from bm25_orgs import ORGS, Orgs, dir_of  # noqa: E402
from bm25_store import Knobs  # noqa: E402
from test_bm25 import HOST, check, free_port, request, stop, wait_healthy  # noqa: E402

AT = "2026-01-01T00:00:00Z"


def doc(i: str, org: str, text: str) -> dict:
    return {"id": i, "org": org, "container": "c1", "occurredAt": AT, "text": text}


ALPHA = [
    doc("a1", "alpha", "The pump runs at four bar during the night shift."),
    doc("a2", "alpha", "The canteen menu changes every Monday."),
    doc("a3", "alpha", "Pump maintenance is booked for the night after the audit."),
]
# Beta's documents share alpha's words, many times over: in one shared index they moved every alpha score.
BETA = [doc(f"b{n}", "beta", "pump pump night shift pump maintenance " * (n + 1)) for n in range(12)]


def server(index_dir: str) -> tuple[subprocess.Popen, str]:
    port = free_port()
    proc = subprocess.Popen(
        [sys.executable, str(Path(__file__).parent / "bm25.py")],
        env={"PORT": str(port), "LOUVAIN_BM25_DIR": index_dir, "LOUVAIN_BM25_HEAP_MB": "64"},
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
    )
    base = f"http://{HOST}:{port}"
    wait_healthy(base, proc)
    return proc, base


def alpha_search(base: str) -> list[tuple[str, float, object]]:
    hits = request(base, "POST", "/search", {"org": "alpha", "containers": ["c1"], "query": "pump night", "limit": 10})
    return [(h["id"], h["score"], h["snippet"]) for h in hits["hits"]]


def isolation(tmp: str) -> None:
    proc, base = server(f"{tmp}/alone")
    try:
        request(base, "POST", "/index", {"docs": ALPHA})
        alone = alpha_search(base)
    finally:
        stop(proc)
    proc, base = server(f"{tmp}/together")
    try:
        request(base, "POST", "/index", {"docs": BETA[:6] + ALPHA + BETA[6:]})
        together = alpha_search(base)
        check("a workspace's search is found at all", [h[0] for h in alone][:1] == ["a1"], str(alone))
        check("another workspace's documents move none of its scores or snippets", together == alone,
              f"{together}\n{alone}")
    finally:
        stop(proc)


def reads_make_nothing(tmp: str) -> None:
    proc, base = server(f"{tmp}/reads")
    try:
        empty = request(base, "POST", "/search", {"org": "nobody", "containers": ["c1"], "query": "pump"})
        tiers = request(base, "POST", "/search", {"org": "nobody", "containers": ["c1"], "query": "pump",
                                                  "strategy": "last"})
        listed = request(base, "POST", "/list", {"org": "nobody", "containers": ["c1"]})
        check("a workspace with no index searches as empty", empty["hits"] == [] and tiers["hits"] == [], str(empty))
        check("and lists as empty", listed["ids"] == [] and listed["total"] == 0, str(listed))
        check("and a read made no index", not (Path(tmp) / "reads" / ORGS / dir_of("nobody")).exists())
    finally:
        stop(proc)


def deletes_and_commits(tmp: str) -> None:
    root = f"{tmp}/writes"
    proc, base = server(root)
    try:
        request(base, "POST", "/index", {"docs": ALPHA[:1], "commit": False})
        request(base, "POST", "/index", {"docs": BETA[:1], "commit": False})
        request(base, "POST", "/index", {"docs": [], "commit": True})
        check("an empty commit commits every workspace's pending adds", request(base, "GET", "/healthz")["docs"] == 2)

        request(base, "POST", "/delete", {"ids": ["a1", "never-written"]})
        check("a delete by id reaches its workspace", alpha_search(base) == [])
        check("and only it", request(base, "GET", "/healthz")["docs"] == 1)

        request(base, "POST", "/index", {"docs": [doc("x", "alpha", "pump night")]})
        request(base, "POST", "/index", {"docs": [doc("x", "beta", "pump night")]})
        check("an id written again for another workspace leaves the first", alpha_search(base) == [])
        request(base, "POST", "/delete", {"ids": ["x"]})
        beta = request(base, "POST", "/search", {"org": "beta", "containers": ["c1"], "query": "pump night"})
        check("and its delete reaches where it went", [h["id"] for h in beta["hits"]] == ["b0"], str(beta))

        request(base, "POST", "/index", {"docs": ALPHA})
        request(base, "POST", "/delete_org", {"org": "alpha"})
        check("deleting a workspace removes its index", not (Path(root) / ORGS / dir_of("alpha")).exists())
        check("and leaves another's", [h["id"] for h in request(
            base, "POST", "/search", {"org": "beta", "containers": ["c1"], "query": "pump"})["hits"]] == ["b0"])
        health = request(base, "GET", "/healthz")
        check("healthz names no workspace", "alpha" not in str(health) and "beta" not in str(health), str(health))
    finally:
        stop(proc)


class FailsOnce:
    """A writer whose first commit fails, as a full disk would; then the writer it wraps."""

    def __init__(self, writer) -> None:
        self.writer, self.failed = writer, False

    def commit(self):
        if not self.failed:
            self.failed = True
            raise OSError("no space left on device")
        return self.writer.commit()

    def __getattr__(self, name):
        return getattr(self.writer, name)


def failed_commit_retried(tmp: str) -> None:
    orgs = Orgs(f"{tmp}/failing", 64, Knobs())
    orgs.index(ALPHA[:1], False)
    store = orgs.reading("alpha")
    store.writer = FailsOnce(store.writer)
    try:
        orgs.commit()
        check("a failing commit is said", False)
    except OSError:
        pass
    check("and its adds are still pending", store.writer is not None and store.index.searcher().num_docs == 0)
    orgs.commit()
    store.index.reload()
    check("so the retry commits them", store.index.searcher().num_docs == 1)


def legacy(tmp: str) -> None:
    root = Path(tmp) / "legacy"
    root.mkdir()
    (root / "meta.json").write_text("{}")
    proc, base = server(str(root))
    try:
        health = request(base, "GET", "/healthz")
        check("an index shared by every workspace asks for the rebuild", health["rebuild"] is True, str(health))
        check("and is never read", alpha_search(base) == [])
    finally:
        stop(proc)
        said = proc.stdout.read().decode() if proc.stdout else ""
    check("and says so at boot", "one index shared by every workspace" in said, said[-300:])
    check("and is left as it was", (root / "meta.json").read_text() == "{}")
    proc, base = server(str(root))
    try:
        (root / "meta.json").unlink()
        check("its files removed, healthz stops asking, with no restart",
              request(base, "GET", "/healthz")["rebuild"] is False)
    finally:
        stop(proc)


def main() -> None:
    with tempfile.TemporaryDirectory(prefix="bm25-orgs-") as tmp:
        isolation(tmp)
        reads_make_nothing(tmp)
        deletes_and_commits(tmp)
        failed_commit_retried(tmp)
        legacy(tmp)
    print("ok: test_bm25_orgs")


if __name__ == "__main__":
    main()
