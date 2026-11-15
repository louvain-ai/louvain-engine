"""An index an earlier release built, with a schema this sidecar cannot open (`bm25_store.py` `Store.unreadable`).

Self-contained, like `test_bm25.py`, whose helpers it uses: a real server on a free port, a temporary index directory.

    apps/nlp/.venv/bin/python apps/nlp/test_bm25_upgrade.py

- The sidecar STARTS on it, never exits: the keyword index is derived, and `./engine up` rebuilds it from the records.
- `/healthz` says `rebuild: true` and `unreadable: true`; every other route answers 409 `index_unreadable`, which a
  client reads as the index being down, so nothing reads or writes the old files.
- The files are left as they were: the rebuild empties the directory, not the sidecar.
- Emptied, the directory opens with this release's schema and asks for nothing.
"""

import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from urllib.error import HTTPError

sys.path.insert(0, str(Path(__file__).parent))
from test_bm25 import HOST, check, free_port, request, stop, wait_healthy  # noqa: E402


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


def main() -> None:
    with tempfile.TemporaryDirectory(prefix="bm25-upgrade-") as tmpdir:
        made = str(Path(tmpdir) / "earlier")
        Path(made).mkdir()
        # A schema no release of this sidecar opens: an earlier one's field set, here a field since removed.
        make = ("import tantivy; sb = tantivy.SchemaBuilder(); "
                "sb.add_text_field('id', stored=True, tokenizer_name='raw'); "
                "sb.add_text_field('completion', stored=False); "
                f"tantivy.Index(sb.build(), path={made!r})")
        subprocess.run([sys.executable, "-c", make], check=True, capture_output=True)
        before = sorted(p.name for p in Path(made).iterdir())

        proc, base = server(made)
        try:
            health = request(base, "GET", "/healthz")
            check("it starts on an index it cannot open", proc.poll() is None)
            check("and asks for the rebuild", health["rebuild"] is True and health["unreadable"] is True, str(health))
            for path, body in (("/search", {"org": "o1", "containers": ["c1"], "query": "x"}),
                               ("/index", {"docs": []}), ("/list", {"org": "o1", "containers": ["c1"]})):
                try:
                    request(base, "POST", path, body)
                    check(f"{path} is refused", False)
                except HTTPError as err:
                    check(f"{path} is a 409 index_unreadable", err.code == 409 and b"index_unreadable" in err.read())
        finally:
            stop(proc)
            boot = proc.stdout.read().decode() if proc.stdout else ""
        check("it says so at boot", "an earlier release built it" in boot, boot[-300:])
        check("and leaves the files as they were", sorted(p.name for p in Path(made).iterdir()) == before)

        # What `./engine up`'s rebuild does: the directory emptied, then the sidecar started again.
        shutil.rmtree(made)
        Path(made).mkdir()
        proc, base = server(made)
        try:
            health = request(base, "GET", "/healthz")
            check("emptied, it opens with this release's schema", health["rebuild"] is False and not health["unreadable"],
                  str(health))
        finally:
            stop(proc)
    print("ok: test_bm25_upgrade")


if __name__ == "__main__":
    main()
