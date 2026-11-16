"""Unit tests for the rerank sidecar's request-shaping logic.

`rerank.py` splits the model call out into one function, `_infer_scores`, and
everything else — the 200-document cap, the per-document character cap,
batching, sorting and `top_n` — is ordinary Python around it (see the module
docstring for why). These tests monkeypatch `_infer_scores` with a fake that
returns a deterministic score for each (query, document) pair, so the whole
suite runs against the real `rerank()` function with no model download, no
GPU, and no network — just the interpreter that `requirements.txt`
pins.

    python -m unittest services/rerank/test_rerank.py
"""

import sys
import unittest
from pathlib import Path
from unittest.mock import patch

# So `python -m unittest services/rerank/test_rerank.py` works from the repo root as
# well as from `services` itself — `rerank.py` lives beside this file, not on
# the default import path when invoked from elsewhere.
sys.path.insert(0, str(Path(__file__).resolve().parent))

import rerank


def _fake_scores_by_length(pairs: list[tuple[str, str]]) -> list[float]:
    """A stand-in "model": score is the length of the document half.

    Deterministic and cheap, and it lets a test assert the exact score a
    truncated document should get — the length of what actually reached the
    fake, not the length of the original text.
    """
    return [float(len(doc)) for _query, doc in pairs]


class RerankTests(unittest.TestCase):
    def test_sorts_by_score_descending(self) -> None:
        documents = [
            {"id": "short", "text": "a"},
            {"id": "long", "text": "a" * 50},
            {"id": "medium", "text": "a" * 10},
        ]
        with patch.object(rerank, "_infer_scores", side_effect=_fake_scores_by_length):
            results = rerank.rerank("query", documents)
        self.assertEqual([r["id"] for r in results], ["long", "medium", "short"])
        self.assertEqual(results[0]["score"], 50.0)
        self.assertEqual(results[-1]["score"], 1.0)

    def test_top_n_truncates(self) -> None:
        documents = [{"id": str(i), "text": "x" * i} for i in range(1, 11)]
        with patch.object(rerank, "_infer_scores", side_effect=_fake_scores_by_length):
            results = rerank.rerank("query", documents, top_n=3)
        self.assertEqual(len(results), 3)
        self.assertEqual([r["id"] for r in results], ["10", "9", "8"])

    def test_no_top_n_returns_everything(self) -> None:
        documents = [{"id": str(i), "text": "x"} for i in range(5)]
        with patch.object(rerank, "_infer_scores", side_effect=_fake_scores_by_length):
            results = rerank.rerank("query", documents, top_n=None)
        self.assertEqual(len(results), 5)

    def test_document_text_capped_before_scoring(self) -> None:
        original_max = rerank.MAX_CHARS
        rerank.MAX_CHARS = 10
        try:
            documents = [{"id": "long", "text": "x" * 1000}]
            with patch.object(rerank, "_infer_scores", side_effect=_fake_scores_by_length) as fake:
                results = rerank.rerank("query", documents)
            # The fake only ever saw the truncated text, so its "length"
            # score proves the cap was applied before the pair reached it.
            self.assertEqual(results[0]["score"], 10.0)
            (call_pairs,), _kwargs = fake.call_args
            self.assertEqual(len(call_pairs[0][1]), 10)
        finally:
            rerank.MAX_CHARS = original_max

    def test_empty_documents_returns_empty_results(self) -> None:
        with patch.object(rerank, "_infer_scores", side_effect=_fake_scores_by_length) as fake:
            results = rerank.rerank("query", [])
        self.assertEqual(results, [])
        fake.assert_not_called()

    def test_more_than_200_documents_are_capped(self) -> None:
        documents = [{"id": str(i), "text": "x" * (i + 1)} for i in range(250)]

        with patch.object(rerank, "_infer_scores", side_effect=_fake_scores_by_length) as fake:
            results = rerank.rerank("query", documents, top_n=None)
        self.assertEqual(len(results), rerank.MAX_DOCUMENTS)
        # Only the first MAX_DOCUMENTS documents were ever scored — the
        # highest possible id among the results proves the tail was dropped
        # before scoring, not after.
        scored_ids = {r["id"] for r in results}
        self.assertNotIn("249", scored_ids)
        self.assertIn(str(rerank.MAX_DOCUMENTS - 1), scored_ids)
        total_pairs_seen = sum(len(c.args[0]) for c in fake.call_args_list)
        self.assertEqual(total_pairs_seen, rerank.MAX_DOCUMENTS)

    def test_batches_are_bounded_by_batch_size(self) -> None:
        original_batch = rerank.BATCH_SIZE
        rerank.BATCH_SIZE = 4
        try:
            documents = [{"id": str(i), "text": "x"} for i in range(10)]
            with patch.object(rerank, "_infer_scores", side_effect=_fake_scores_by_length) as fake:
                rerank.rerank("query", documents)
            batch_sizes = [len(c.args[0]) for c in fake.call_args_list]
            self.assertEqual(batch_sizes, [4, 4, 2])
        finally:
            rerank.BATCH_SIZE = original_batch


if __name__ == "__main__":
    unittest.main()
