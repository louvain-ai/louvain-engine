"""The index is a function of what was written (`bm25_store.py` `_writer`, `_commit`): the same writes, in the same order,
score the same, after every one of them.

    apps/nlp/.venv/bin/python apps/nlp/test_bm25_settled.py

A replaced entry stays in the BM25 statistics until its segment is dropped or merged away, so the same live documents
score differently with it and without it. Which of the two a search read was once decided by thread timing: which
indexing thread took the replaced entry, and whether a background merge had ended. The engine's search golden then
failed inside its suite, and sometimes alone, with two close results traded. Here one history is written again and
again, each time into a new index: a document beside another in one commit, replaced at once, then one document per
commit until tantivy's merge policy merges the segments (eight, `LogMergePolicy`), and on past it. Every replay reads
the same scores, in the same order, after every commit, and once the merge has purged the replaced copy, those of an
index that never held it. And a commit of fifty documents is one segment: one indexing thread.
"""

import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from bm25_query import search  # noqa: E402
from bm25_store import Knobs, index_docs, open_store  # noqa: E402

ORG, BOX = "org-1", "box-1"
QUERY = "work from home three days"
FIRST_COPY = "Staff may work from home two days a week."
TEXTS = {
    "remote": "Staff may work from home three days a week.",
    "car": "Using your own car for work: claim mileage.",
    "notes": "Background work goes through the queue.",
    "refund": "A refund takes up to ten working days.",
}
FILLERS = 8
REPLAYS = 6


def doc(doc_id: str, text: str) -> dict:
    return {"id": doc_id, "org": ORG, "container": BOX, "occurredAt": "2026-01-01T00:00:00Z", "text": text}


def history() -> list[list[dict]]:
    """The writes, one commit each: the first copy beside a live document, its replacement, the rest one by one."""
    return [
        [doc("remote", FIRST_COPY), doc("car", TEXTS["car"])],
        [doc("remote", TEXTS["remote"])],
        [doc("notes", TEXTS["notes"])],
        [doc("refund", TEXTS["refund"])],
        *[[doc(f"filler-{n}", f"work filler entry {n}")] for n in range(FILLERS)],
    ]


def scores(ix) -> list[tuple[str, float]]:
    hits, _ = search(ix, ORG, [BOX], QUERY, 20, None)
    return [(h["id"], h["score"]) for h in hits]


def replay(path: str) -> list[list[tuple[str, float]]]:
    """The scores after each commit of the history, the moment the commit returns."""
    ix = open_store(path, 64, Knobs())
    seen = []
    for batch in history():
        index_docs(ix, batch, True)
        seen.append(scores(ix))
    return seen


def main() -> None:
    with tempfile.TemporaryDirectory(prefix="bm25-settled-") as tmp:
        first = replay(f"{tmp}/replay-0")
        for n in range(1, REPLAYS):
            again = replay(f"{tmp}/replay-{n}")
            for step, (want, got) in enumerate(zip(first, again)):
                assert got == want, f"replay {n}, commit {step + 1}: the same writes scored differently\n{got}\n{want}"
        once = open_store(f"{tmp}/once", 64, Knobs())
        index_docs(once, [d for batch in history() for d in batch if d["text"] != FIRST_COPY], True)
        assert first[-1] == scores(once), "after the merge, the replaced copy was still counted"
        # One indexing thread: a batch is one segment, never as many as threads took a part of it.
        batch = open_store(f"{tmp}/batch", 64, Knobs())
        index_docs(batch, [doc(f"many-{n}", f"entry {n} of one batch") for n in range(50)], True)
        assert batch.index.searcher().num_segments == 1, "one commit wrote a segment per indexing thread"
    print("ok: test_bm25_settled")


if __name__ == "__main__":
    main()
