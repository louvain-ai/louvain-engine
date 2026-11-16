"""The BM25 sidecar's unstemmed field (`bm25_schema.py` `exact`, `LOUVAIN_BM25_EXACT_BOOST`, the request's `exactBoost`).

Self-contained, like `test_bm25.py`, whose helpers it uses: real servers on free ports, temporary index directories.
Every document here is invented: a fictional freight company, written for this test.

    apps/nlp/.venv/bin/python apps/nlp/test_bm25_exact.py

- A rare surface form ("Shipping", a company's name) whose stem is common ("ship", "shipped", "shipment"): with the
  boost at 0 the stemmed field weighs it as the common stem and documents that merely ship things outrank the one that
  names the company; with a boost the unstemmed field gives it back its rarity and that document ranks first.
- The boost only adds: a document matching the query's stems but none of its surface forms is still found.
- The fence holds: another org's document naming the company is never returned.
- An index built WITHOUT the field (an older sidecar's) still opens, says so, and serves searches with the boost asked.
"""

import subprocess
import sys
import tempfile
from pathlib import Path
from urllib.error import HTTPError

sys.path.insert(0, str(Path(__file__).parent))
from test_bm25 import HOST, check, free_port, org_dir, request, stop, wait_healthy  # noqa: E402

AT = "2025-06-01T00:00:00Z"


def doc(i: str, text: str, org: str = "o1") -> dict:
    return {"id": i, "org": org, "container": "c1", "occurredAt": AT, "text": text}


DOCS = [doc("target", "Larkspur Shipping onboarding: the evaluation checklist, agreed rates and the sign-off steps.")]
# Shorter documents with the same stem (shipped, ship) and the same other word: BM25 prefers them on stems alone.
DOCS += [doc(f"ship{i}", f"Evaluation {i}: shipped.") for i in range(12)]
DOCS += [doc(f"filler{i}", f"Notes {i} about an evaluation.") for i in range(30)]
DOCS += [doc("other-org", "Larkspur Shipping evaluation.", org="o2")]


def start(tmpdir: str, older: bool = False) -> tuple[subprocess.Popen, str]:
    port = free_port()
    env = {"PORT": str(port), "LOUVAIN_BM25_DIR": tmpdir, "LOUVAIN_BM25_HEAP_MB": "64"}
    if older:
        # The index the previous sidecar built: header, variants and app, no exact field.
        import tantivy

        sb = tantivy.SchemaBuilder()
        sb.add_text_field("id", stored=True, tokenizer_name="raw", index_option="basic")
        sb.add_text_field("org", stored=False, tokenizer_name="raw", index_option="basic")
        sb.add_text_field("container", stored=False, tokenizer_name="raw", index_option="basic")
        sb.add_integer_field("occurred_at", stored=False, indexed=True, fast=True)
        for f in ("text", "title", "header"):
            sb.add_text_field(f, stored=False, tokenizer_name="en_stem", index_option="position")
        sb.add_text_field("variants", stored=False, tokenizer_name="en_stem", index_option="basic")
        sb.add_text_field("app", stored=False, tokenizer_name="raw", index_option="basic")
        tantivy.Index(sb.build(), path=org_dir(tmpdir), reuse=True)
    proc = subprocess.Popen(
        [sys.executable, str(Path(__file__).parent / "bm25.py")],
        env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
    )
    base = f"http://{HOST}:{port}"
    wait_healthy(base, proc)
    return proc, base


def ids(base: str, query: str, boost: float | None = None, org: str = "o1") -> list[str]:
    body = {"org": org, "containers": ["c1"], "query": query, "limit": 10}
    if boost is not None:
        body["exactBoost"] = boost
    return [h["id"] for h in request(base, "POST", "/search", body)["hits"]]


def main() -> None:
    q = "shipping evaluation"
    with tempfile.TemporaryDirectory(prefix="bm25-exact-") as tmpdir:
        proc, base = start(tmpdir)
        try:
            request(base, "POST", "/index", {"docs": DOCS, "commit": True})
            off = ids(base, q)
            check("off: the common stem's documents outrank the one naming the company", off[:1] != ["target"], str(off))
            on = ids(base, q, 2.0)
            check("on: the rare surface form ranks its document first", on[:1] == ["target"], str(on))
            check("on: a document matching stems only is still found", any(i.startswith("ship") for i in on), str(on))
            check("on: another org's document is never returned", "other-org" not in on, str(on))
            for bad in ("2", True, 1e300):
                try:
                    ids(base, q, bad)  # type: ignore[arg-type]
                    code = 200
                except HTTPError as err:
                    code = err.code
                check(f"a boost that is not a finite number is refused ({bad!r})", code == 400, str(code))
        finally:
            stop(proc)
    with tempfile.TemporaryDirectory(prefix="bm25-exact-old-") as tmpdir:
        proc, base = start(tmpdir, older=True)
        try:
            request(base, "POST", "/index", {"docs": DOCS, "commit": True})
            check("an index without the field still serves, boost asked", len(ids(base, q, 2.0)) > 0)
        finally:
            stop(proc)
        said = proc.stdout.read().decode() if proc.stdout else ""
        check("and says the field is off until a rebuild", "predates the exact field" in said, said[:300])
    print("ok")


if __name__ == "__main__":
    main()
