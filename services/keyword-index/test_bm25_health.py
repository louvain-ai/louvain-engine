"""`/healthz` answers while a write is held (`bm25.py`): Fly's health check must not fail because an `/index` call is
still committing.

    services/keyword-index/.venv/bin/python services/keyword-index/test_bm25_health.py

The server is the sidecar's own (`DualStackServer`, a threaded server, as `serve` makes it), run in process so the
write can be held at a known point: inside `Orgs.index`, after it is called and before it returns. No timers decide
anything; the held write is released by an event once `/healthz` has answered. A single-threaded server fails it.
"""

import os
import sys
import tempfile
import threading
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from test_bm25 import HOST, check, free_port, request  # noqa: E402

AT = "2026-01-01T00:00:00Z"


def main() -> None:
    with tempfile.TemporaryDirectory(prefix="bm25-health-") as tmp:
        os.environ.update({"LOUVAIN_BM25_DIR": tmp, "LOUVAIN_BM25_HEAP_MB": "64", "LOUVAIN_SIDECAR_TOKEN": ""})
        import bm25  # noqa: PLC0415 - reads its settings from the environment at import

        port = free_port()
        # Bound here, before any request: listening from this line, so nothing waits for it to come up.
        server = bm25.DualStackServer(("::", port), bm25.Handler)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        base = f"http://{HOST}:{port}"

        entered, release = threading.Event(), threading.Event()
        real = bm25.ORGS.index

        def held(docs, to_commit):
            entered.set()
            release.wait()
            return real(docs, to_commit)

        bm25.ORGS.index = held
        answer: dict = {}
        doc = {"id": "e1", "org": "alpha", "container": "c1", "occurredAt": AT, "text": "The pump runs at night."}
        writing = threading.Thread(
            target=lambda: answer.update(request(base, "POST", "/index", {"docs": [doc], "commit": True})),
        )
        writing.start()
        entered.wait()
        try:
            health = request(base, "GET", "/healthz")
            check("/healthz answers while an /index call is held mid-write", health["ok"] is True, str(health))
            check("and the held write has not returned", writing.is_alive() and not answer)
        finally:
            release.set()
            writing.join()
        check("the write completes once released", answer.get("indexed") == 1, str(answer))
        check("and /healthz then counts it", request(base, "GET", "/healthz")["docs"] == 1)
        server.shutdown()
        server.server_close()
    print("ok: test_bm25_health")


if __name__ == "__main__":
    main()
