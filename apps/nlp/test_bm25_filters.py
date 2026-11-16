"""The BM25 sidecar's narrowings (`bm25_query.py` `_narrowing`, the `app` field): an app set and a time range, beside the fence.

Self-contained, like `test_bm25.py`, whose helpers it uses: real servers on free ports, temporary index directories.

    apps/nlp/.venv/bin/python apps/nlp/test_bm25_filters.py

- `apps` keeps only documents carrying one of the named apps; a document with several (its shown app, its connector)
  is found by each, and one with none by no app filter.
- `from`/`to` keep only documents inside the range, inclusive, in whole seconds.
- The fence still holds under a narrowing: another org's and another container's documents are never returned.
- An index built WITHOUT the `app` field (an older sidecar's) refuses an app filter with 409 and still serves the rest.
"""

import subprocess
import sys
import tempfile
from pathlib import Path
from urllib.error import HTTPError

sys.path.insert(0, str(Path(__file__).parent))
from test_bm25 import HOST, check, free_port, org_dir, request, stop, wait_healthy  # noqa: E402


def doc(i: str, at: str, apps: list[str], org: str = "o1", container: str = "c1") -> dict:
    return {"id": i, "org": org, "container": container, "occurredAt": at, "apps": apps,
            "text": f"Quarterly rollout notes for the zephyr project ({i})."}


DOCS = [
    doc("feed-chat", "2026-03-01T10:00:00Z", ["slack", "http"]),
    doc("mail", "2026-03-05T10:00:00Z", ["gmail"]),
    doc("old-chat", "2025-01-01T00:00:00Z", ["slack"]),
    doc("bare", "2026-03-02T00:00:00Z", []),
    doc("other-org", "2026-03-01T10:00:00Z", ["slack"], org="o2"),
    doc("other-room", "2026-03-01T10:00:00Z", ["slack"], container="c2"),
]


def start(tmpdir: str, without_app: bool = False) -> tuple[subprocess.Popen, str]:
    port = free_port()
    env = {"PORT": str(port), "LOUVAIN_BM25_DIR": tmpdir, "LOUVAIN_BM25_HEAP_MB": "64"}
    if without_app:
        # The index an older sidecar built: header and variants, no app field.
        import tantivy

        sb = tantivy.SchemaBuilder()
        sb.add_text_field("id", stored=True, tokenizer_name="raw", index_option="basic")
        sb.add_text_field("org", stored=False, tokenizer_name="raw", index_option="basic")
        sb.add_text_field("container", stored=False, tokenizer_name="raw", index_option="basic")
        sb.add_integer_field("occurred_at", stored=False, indexed=True, fast=True)
        sb.add_text_field("text", stored=False, tokenizer_name="en_stem", index_option="position")
        sb.add_text_field("title", stored=False, tokenizer_name="en_stem", index_option="position")
        sb.add_text_field("header", stored=False, tokenizer_name="en_stem", index_option="position")
        sb.add_text_field("variants", stored=False, tokenizer_name="en_stem", index_option="basic")
        tantivy.Index(sb.build(), path=org_dir(tmpdir), reuse=True)
    proc = subprocess.Popen(
        [sys.executable, str(Path(__file__).parent / "bm25.py")],
        env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
    )
    base = f"http://{HOST}:{port}"
    wait_healthy(base, proc)
    return proc, base


def ids(base: str, **narrow) -> list[str]:
    body = {"org": "o1", "containers": ["c1"], "query": "zephyr rollout", "limit": 20, **narrow}
    return sorted(h["id"] for h in request(base, "POST", "/search", body)["hits"])


def status(base: str, **narrow) -> int:
    try:
        ids(base, **narrow)
        return 200
    except HTTPError as err:
        return err.code


def main() -> None:
    with tempfile.TemporaryDirectory(prefix="bm25-filters-") as tmpdir:
        proc, base = start(tmpdir)
        try:
            request(base, "POST", "/index", {"docs": DOCS, "commit": True})
            check("no narrowing: every document in the fence", ids(base) == ["bare", "feed-chat", "mail", "old-chat"])
            check("apps: slack", ids(base, apps=["slack"]) == ["feed-chat", "old-chat"], str(ids(base, apps=["slack"])))
            check("apps: a record found by its connector's app too", ids(base, apps=["http"]) == ["feed-chat"])
            check("apps: any of several", ids(base, apps=["gmail", "http"]) == ["feed-chat", "mail"])
            check("apps: an app nobody carries finds nothing", ids(base, apps=["jira"]) == [])
            check(
                "from/to: inside the range, inclusive",
                ids(base, **{"from": "2026-03-01T10:00:00Z", "to": "2026-03-02T00:00:00Z"}) == ["bare", "feed-chat"],
            )
            check("from alone", ids(base, **{"from": "2026-03-03T00:00:00Z"}) == ["mail"])
            check("to alone", ids(base, to="2025-06-01T00:00:00Z") == ["old-chat"])
            got = ids(base, apps=["slack"], **{"from": "2026-01-01T00:00:00Z"})
            check("apps and a range together, never another org or room", got == ["feed-chat"], str(got))
        finally:
            stop(proc)
    with tempfile.TemporaryDirectory(prefix="bm25-filters-old-") as tmpdir:
        proc, base = start(tmpdir, without_app=True)
        try:
            request(base, "POST", "/index", {"docs": DOCS, "commit": True})
            check("an index without the field refuses an app filter (409)", status(base, apps=["slack"]) == 409)
            check("and still serves a range", ids(base, **{"from": "2026-03-03T00:00:00Z"}) == ["mail"])
        finally:
            stop(proc)
        said = proc.stdout.read().decode() if proc.stdout else ""
        check("and says the field is off until a rebuild", "predates the app field" in said, said[:300])
    print("ok")


if __name__ == "__main__":
    main()
