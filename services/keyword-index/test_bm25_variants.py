"""The BM25 sidecar's compound spellings (`bm25_schema.py` `_joined`, `_split`, the `variants` field, `LOUVAIN_BM25_VARIANTS`).

Self-contained, like `test_bm25.py`, whose helpers it uses: real servers on free ports, temporary index directories.
Every document here is invented: a pottery studio's notes, written for this test.

    services/keyword-index/.venv/bin/python services/keyword-index/test_bm25_variants.py

- With the switch ON, a search for "kiln-hours" ranks the one document holding the compound above documents that hold
  only its two common words (and the query's other common words); OFF, they outrank it.
- ON, "SOC 2" finds a document that wrote "SOC2", and "SOC2" one that wrote "SOC 2".
- The fence holds: another org's document holding the same compound is never returned.
- The fence holds across containers of one org too.
- An index built WITHOUT the variants field (an older sidecar's, with or without the header field) still opens, says
  so, and serves searches.
"""

import subprocess
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from test_bm25 import HOST, check, free_port, org_dir, request, stop, wait_healthy  # noqa: E402

AT = "2025-06-01T00:00:00Z"
DOCS = [
    {"id": "target", "org": "o1", "container": "c1", "occurredAt": AT,
     "text": "Pottery studio proposal. Estimated 3,400 kiln-hours to clear the backlog."},
    {"id": "decoy1", "org": "o1", "container": "c1", "occurredAt": AT,
     "text": "Glazing cost estimate for the spring timetable: kiln budget in hours of use."},
    {"id": "decoy2", "org": "o1", "container": "c1", "occurredAt": AT,
     "text": "Spring timetable glazing: a cost estimate, hours and kiln counts."},
    {"id": "soc-joined", "org": "o1", "container": "c1", "occurredAt": AT, "text": "Vendor checklist: SOC2 prep."},
    {"id": "soc-spaced", "org": "o1", "container": "c1", "occurredAt": AT, "text": "Audit plan: SOC 2 window."},
    {"id": "other-container", "org": "o1", "container": "c2", "occurredAt": AT, "text": "Board only: SOC2 prep."},
    {"id": "other-org", "org": "o2", "container": "c1", "occurredAt": AT,
     "text": "Estimated 3,400 kiln-hours to clear the backlog."},
]
# A corpus where the query's other words are COMMON: BM25's IDF then weighs the rare compound.
DOCS += [
    {"id": f"filler{i}", "org": "o1", "container": "c1", "occurredAt": AT,
     "text": f"Note {i}: glazing cost estimate, spring timetable, kiln and hours budget."}
    for i in range(40)
]


def start(tmpdir: str, variants: bool, old_schema: str = "") -> tuple[subprocess.Popen, str]:
    port = free_port()
    env = {"PORT": str(port), "LOUVAIN_BM25_DIR": tmpdir, "LOUVAIN_BM25_HEAP_MB": "64",
           "LOUVAIN_BM25_VARIANTS": "on" if variants else "off"}
    if old_schema:
        # Build the index an older sidecar would have: no variants field, and (`bare`) no header field either.
        import tantivy

        sb = tantivy.SchemaBuilder()
        sb.add_text_field("id", stored=True, tokenizer_name="raw", index_option="basic")
        sb.add_text_field("org", stored=False, tokenizer_name="raw", index_option="basic")
        sb.add_text_field("container", stored=False, tokenizer_name="raw", index_option="basic")
        sb.add_integer_field("occurred_at", stored=False, indexed=True, fast=True)
        sb.add_text_field("text", stored=False, tokenizer_name="en_stem", index_option="position")
        sb.add_text_field("title", stored=False, tokenizer_name="en_stem", index_option="position")
        if old_schema == "header":
            sb.add_text_field("header", stored=False, tokenizer_name="en_stem", index_option="position")
        tantivy.Index(sb.build(), path=org_dir(tmpdir), reuse=True)
    proc = subprocess.Popen(
        [sys.executable, str(Path(__file__).parent / "bm25.py")],
        env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
    )
    base = f"http://{HOST}:{port}"
    wait_healthy(base, proc)
    return proc, base


def ids(base: str, query: str, org: str = "o1") -> list[str]:
    r = request(base, "POST", "/search", {"org": org, "containers": ["c1"], "query": query, "limit": 10})
    return [h["id"] for h in r["hits"]]


def main() -> None:
    query = '"kiln-hours" glazing cost estimate spring timetable'
    for on in (False, True):
        with tempfile.TemporaryDirectory(prefix="bm25-variants-") as tmpdir:
            proc, base = start(tmpdir, variants=on)
            try:
                request(base, "POST", "/index", {"docs": DOCS, "commit": True})
                found = ids(base, query)
                if on:
                    check("ON: the rare compound's document ranks first", found[:1] == ["target"], str(found))
                    check("ON: SOC 2 finds the document that wrote SOC2", "soc-joined" in ids(base, "SOC 2 readiness"))
                    check("ON: SOC2 finds the document that wrote SOC 2", "soc-spaced" in ids(base, "SOC2 timeline"))
                    check("ON: another org's compound is never returned", "other-org" not in found, str(found))
                    soc = ids(base, "SOC2 prep")
                    check("ON: a container outside the fence is never returned", "other-container" not in soc, str(soc))
                else:
                    check("OFF: the common words' documents outrank it", found[:1] != ["target"], str(found))
                    check("OFF: SOC 2 does not reach SOC2", "soc-joined" not in ids(base, "SOC 2 timeline"))
            finally:
                stop(proc)
    for shape in ("header", "bare"):
        with tempfile.TemporaryDirectory(prefix="bm25-variants-old-") as tmpdir:
            proc, base = start(tmpdir, variants=True, old_schema=shape)
            try:
                request(base, "POST", "/index", {"docs": DOCS, "commit": True})
                served = "target" in ids(base, "pottery studio proposal")
                check(f"an index built without the field ({shape}) still serves", served)
            finally:
                stop(proc)
            said = proc.stdout.read().decode() if proc.stdout else ""
            check(f"and ({shape}) says the field is off until a rebuild", "predates the variants field" in said, said[:300])
    print("ok")


if __name__ == "__main__":
    main()
