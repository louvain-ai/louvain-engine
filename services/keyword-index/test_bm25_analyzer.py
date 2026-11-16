"""The BM25 sidecar's half of the one analyzer (`analyzer.py`, the `terms` field, `LOUVAIN_BM25_ANALYZER`).

Self-contained, like `test_bm25.py`, whose helpers it uses: real servers on free ports, temporary index directories.
Every document here is invented.

    services/keyword-index/.venv/bin/python services/keyword-index/test_bm25_analyzer.py

- ON, a figure finds a document that wrote it grouped ("2400" -> "GBP 2,400"), a key typed joined finds one that wrote
  it hyphenated ("sup1042" -> "SUP-1042"), and a figure finds the key holding it ("4471" -> "PO-4471").
- OFF, the first two are not found (the text field alone): the switch, not the index, decides.
- ON, a key is one search however it is spelled ("FS-4471", "fs4471"): the same page, its titled document first.
- ON, a search's last token of any type ("SUP-102", "240") completes over the held terms it begins, under the fence;
  never a held one, an edit or one under three characters.
- ON, catenate_numbers: a version's digit chain is also held joined ("2.3.1" finds v2.3.1, never v2.3.10), a date's
  only as its whole chain; and where the database's half differs, the sidecar gives the parity table's `sidecar` forms.
- The fence holds: another org's document holding the same key is never returned.
"""

import json
import subprocess
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from analyzer import delimited  # noqa: E402
from test_bm25 import HOST, check, free_port, request, stop, wait_healthy  # noqa: E402

TABLE = Path(__file__).resolve().parents[2] / "packages" / "engine" / "test" / "analyzer-cases.json"


def where_postgres_differs() -> None:
    """The parity table's cases where the database's half differs: the sidecar gives exactly its `sidecar` forms."""
    if not TABLE.exists():
        print("skip: the parity table is outside this checkout")
        return
    for case in json.loads(TABLE.read_text())["postgresDiffers"]["cases"]:
        got = sorted(set(delimited(case["text"])))
        check(f"the sidecar's forms of {case['text']}", got == sorted(set(case["sidecar"])), str(got))

AT = "2025-06-01T00:00:00Z"
DOCS = [
    {"id": "price", "org": "o1", "container": "c1", "occurredAt": AT, "text": "The enterprise seat costs GBP 2,400."},
    {"id": "ticket", "org": "o1", "container": "c1", "occurredAt": AT, "text": "SUP-1042: the printer queue stalls."},
    {"id": "order", "org": "o1", "container": "c1", "occurredAt": AT, "text": "Purchase order PO-4471 covers desks."},
    {"id": "other-org", "org": "o2", "container": "c1", "occurredAt": AT, "text": "SUP-1042 in another workspace."},
    {"id": "note", "org": "o1", "container": "c1", "occurredAt": AT, "text": "See note-05 for the schedule."},
    {"id": "tail", "org": "o1", "container": "c1", "occurredAt": AT, "text": "field-service-scheduling-notes-5"},
    {"id": "look-alike", "org": "o1", "container": "c1", "occurredAt": AT, "text": "SUP-1043: the lift is out."},
    {"id": "datasheet", "org": "o1", "container": "c1", "occurredAt": AT, "header": "datasheet-FS-4471-revA",
     "text": "datasheet-FS-4471-revA\nThe FS-4471 sensor reads to 0.1 degrees."},
    # Prose that says "note 5" in passing: the owner's policy pages. A search for the key NOTE5 is not one for them.
    *[
        {"id": f"policy-{n}", "org": "o1", "container": "c1", "occurredAt": AT, "header": f"{n} policy",
         "text": f"{n.capitalize()} policy\nNote: 5 working days of notice. Note 5 applies to contractors."}
        for n in ("expense", "parking", "printing", "travel", "on-call", "vpn", "guest-wifi", "release")
    ],
    # Ten tickets whose keys begin SUP-102, and one more held only in a collection the caller cannot read.
    *[
        {"id": f"sup-102{n}", "org": "o1", "container": "c1", "occurredAt": AT, "text": f"SUP-102{n}: case {n}."}
        for n in range(10)
    ],
    {"id": "sup-1021-file", "org": "o1", "container": "c1", "occurredAt": AT, "text": "Attached: SUP-1021.txt"},
    {"id": "pump", "org": "o1", "container": "c1", "occurredAt": AT,
     "text": "Pump PX-7710 ships with seals PX-7710-102 and PX-7710-103."},
    {"id": "pump-next", "org": "o1", "container": "c1", "occurredAt": AT, "text": "Pump PX-77100 replaces the old range."},
    {"id": "dated", "org": "o1", "container": "c1", "occurredAt": AT, "text": "engineering-2026-09-02-34.md minutes"},
    {"id": "build", "org": "o1", "container": "c1", "occurredAt": AT, "text": "Scanner build v2.3.1 is out."},
    {"id": "build-next", "org": "o1", "container": "c1", "occurredAt": AT, "text": "Scanner build v2.3.10 is next."},
    {"id": "firmware", "org": "o1", "container": "c1", "occurredAt": AT, "text": "Controller firmware v2.03 is out."},
    {"id": "sup-1029x", "org": "o1", "container": "c2", "occurredAt": AT, "text": "SUP-10299: a hidden case."},
    {"id": "lanternfish", "org": "o1", "container": "c1", "occurredAt": AT, "header": "Lanternfish survey",
     "text": "Counts from the spring trawl."},
    {"id": "kickoff", "org": "o1", "container": "c1", "occurredAt": AT, "header": "sales kickoff",
     "text": "Sales kickoff\nWe sold the FS-4471 to three customers and the FS-4470 to two, with fs kits."},
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


def ids(base: str, query: str) -> list[str]:
    r = request(base, "POST", "/search", {"org": "o1", "containers": ["c1"], "query": query, "limit": 10})
    return [h["id"] for h in r["hits"]]


def main() -> None:
    where_postgres_differs()
    for on in (False, True):
        with tempfile.TemporaryDirectory(prefix="bm25-analyzer-") as tmpdir:
            proc, base = start(tmpdir, on)
            try:
                request(base, "POST", "/index", {"docs": DOCS, "commit": True})
                grouped = "price" in ids(base, "2400")
                joined = "ticket" in ids(base, "sup1042")
                if on:
                    check("ON: 2400 finds GBP 2,400", grouped)
                    check("ON: sup1042 finds SUP-1042", joined)
                    check("ON: 4471 finds PO-4471", "order" in ids(base, "4471"))
                    check("ON: another org's key is never returned", "other-org" not in ids(base, "SUP-1042"))
                    for q in ("NOTE5", "note-5", "note05"):
                        check(f"ON: {q} finds note-05", "note" in ids(base, q))
                    check("ON: notes-5 finds a key ending in notes-5", "tail" in ids(base, "notes-5"))
                    # The text field still holds SUP-1043's "sup"; the analyzer's phrase puts the ticket itself first.
                    found = ids(base, "SUP-1042")
                    check("ON: SUP-1042 ranks the ticket above its look-alike", found[:1] == ["ticket"], str(found))
                    # A key is one search however it is spelled, on every field: the same page, the titled one first.
                    pages = {q: ids(base, q) for q in ("FS-4471", "fs4471", "FS4471", "fs-4471")}
                    check("ON: every spelling of FS-4471 is one page", len({tuple(p) for p in pages.values()}) == 1,
                          str(pages))
                    check("ON: FS-4471 puts the titled datasheet first", pages["fs4471"][:1] == ["datasheet"],
                          str(pages))
                    # The last token, of any type, completes over the held terms it begins, under the fence; a held
                    # one, a short one and an edit complete nothing.
                    def completed(key: str) -> tuple[list[str], list[str]]:
                        r = request(base, "POST", "/search", {"org": "o1", "containers": ["c1"], "query": key,
                                                               "limit": 50, "strategy": "last"})
                        return sorted(h["id"] for h in r["hits"]), r["completed"]
                    tens = sorted([f"sup-102{n}" for n in range(10)] + ["sup-1021-file"])
                    check("ON: SUP-102 completes to the SUP-102x keys", completed("SUP-102") == (tens, ["SUP-102"]),
                          str(completed("SUP-102")))
                    check("ON: sup102 is SUP-102", completed("sup102")[0] == tens)
                    check("ON: a held key completes nothing", completed("SUP-1024")[1] == [])
                    check("ON: a key and its revisions and its neighbour key all complete",
                          completed("PX-771")[0] == ["pump", "pump-next"], str(completed("PX-771")))
                    check("ON: a hidden key is never offered", "sup-1029x" not in completed("SUP-1029")[0])
                    check("ON: a short token completes nothing", completed("S-1")[1] == [])
                    check("ON: a number completes as the held figures it begins", "price" in completed("240")[0])
                    check("ON: a held number completes nothing", completed("2400")[1] == [])
                    check("ON: SUP-1042 never completes as SUP-1043", completed("SUP-1042")[1] == [])
                    check("ON: a date's digits are no figure", "dated" not in ids(base, "234"), str(ids(base, "234")))
                    check("ON: FS-44 completes to the datasheet", "datasheet" in completed("FS-44")[0])
                    # catenate_numbers: a version's digit parts are also held joined, a date's only as its whole run.
                    found = ids(base, "2.3.1")
                    check("ON: 2.3.1 finds v2.3.1, never v2.3.10", found[:1] == ["build"] and "build-next" not in found,
                          str(found))
                    check("ON: a date gains its whole digit chain, as written", "dated" in ids(base, "2026090234"))
                    # A key of digits alone is asked as written too: "2.03" finds v2.03, which holds 203.
                    found = ids(base, "2.03")
                    check("ON: 2.03 finds v2.03", found[:1] == ["firmware"], str(found))
                    # A word held only in a title is held: the last word completes to it.
                    check("ON: a title's word completes the last word", completed("lantern")[0] == ["lanternfish"],
                          str(completed("lantern")))
                    # The owner's case: the document NAMED note-05 is in the top two for every spelling, above prose
                    # that says "note 5" in passing (a key is asked of the analyzer's fields, never of English text).
                    for q in ("NOTE5", "note5", "note-5", "note05", "note-05"):
                        found = ids(base, q)
                        check(f"ON: {q} has note-05 in the top two", "note" in found[:2], str(found))
                        check(f"ON: {q} is no search for prose saying note 5",
                              not any(h.startswith("policy-") for h in found), str(found))
                else:
                    check("OFF: 2400 does not reach GBP 2,400", not grouped)
                    check("OFF: sup1042 does not reach SUP-1042", not joined)
            finally:
                stop(proc)
    print("ok")


if __name__ == "__main__":
    main()
