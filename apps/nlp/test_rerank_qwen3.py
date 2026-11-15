"""The `qwen3-reranker` kind of `rerank.py`: its scoring maths and its wire.

No model download: a character-level stub tokenizer and a stub causal LM stand in for Qwen3-Reranker, so these run
anywhere `requirements-rerank.txt` installs (torch, transformers).

  - the prompt is fixed and only the DOCUMENT is cut, so the answer position is always the last token;
  - inputs are left-padded, so position -1 is each row's own last token, whatever its length;
  - the score is logit(yes) − logit(no) at that position (log-odds, never a saturating probability);
  - the sidecar's wire is unchanged: the same `/rerank` body and `{results: [{id, score}]}`, the same bearer;
  - a request is ONE call, batched inside by token length under a budget, so its batches are a function of the pool
    alone, and a score does not depend on how the pool was split; float16 is refused at boot.

    python -m unittest apps/nlp/test_rerank_qwen3.py
"""

import json
import os
import subprocess
import sys
import threading
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))

import torch

import rerank

YES, NO, PAD = 1, 2, 0


class StubTokenizer:
    """One token per character (ids from 3 up); "yes" and "no" are single tokens."""

    pad_token_id = PAD

    def __call__(self, text, add_special_tokens=False):
        return {"input_ids": [3 + (ord(c) % 250) for c in text]}

    def convert_tokens_to_ids(self, token):
        return {"yes": YES, "no": NO}[token]


MARK = 3 + (ord("!") % 250)


class StubCausalLM(torch.nn.Module):
    """At every position, logit(yes) is how many "!" the row holds up to and including that position, and
    logit(no) is 0.5. Reading any position but each row's own last one (or counting pad) gives a different answer."""

    def forward(self, input_ids, attention_mask, logits_to_keep=0):
        counts = torch.cumsum((input_ids == MARK).long() * attention_mask, dim=1).float()
        logits = torch.zeros(input_ids.shape[0], input_ids.shape[1], 8)
        logits[:, :, YES] = counts
        logits[:, :, NO] = 0.5
        if logits_to_keep:
            logits = logits[:, -logits_to_keep:, :]
        return type("Out", (), {"logits": logits})()


class Qwen3ScoringTests(unittest.TestCase):
    def test_only_the_document_is_cut_and_the_answer_frame_is_last(self) -> None:
        tok = StubTokenizer()
        head, tail = rerank.qwen3_prompt("q?")
        (row,) = rerank.qwen3_input_ids(tok, [("q?", "d" * 10_000)], max_length=len(head) + len(tail) + 50)
        self.assertEqual(len(row), len(head) + len(tail) + 50)
        self.assertEqual(row[: len(head)], tok(head)["input_ids"])
        self.assertEqual(row[-len(tail) :], tok(tail)["input_ids"])

    def test_prompt_is_the_fixed_template(self) -> None:
        head, tail = rerank.qwen3_prompt("When is the launch?", "Judge it")
        self.assertTrue(head.startswith("<|im_start|>system\nJudge whether the Document meets the requirements"))
        self.assertTrue(head.endswith("<Instruct>: Judge it\n<Query>: When is the launch?\n<Document>: "))
        self.assertEqual(tail, "<|im_end|>\n<|im_start|>assistant\n<think>\n\n</think>\n\n")

    def test_left_padding_puts_every_row_last_token_at_the_end(self) -> None:
        ids, mask = rerank.left_pad([[5, 6, 7], [9]], PAD)
        self.assertEqual(ids.tolist(), [[5, 6, 7], [PAD, PAD, 9]])
        self.assertEqual(mask.tolist(), [[1, 1, 1], [0, 0, 1]])

    def test_score_is_yes_minus_no_at_the_last_position(self) -> None:
        pairs = [("q", "!!!"), ("q", "no marks here at all, a much longer document"), ("q", "!")]
        scores = rerank._qwen3_scores(StubCausalLM(), StubTokenizer(), pairs, "cpu")
        # The prompt holds no "!", so a row's logit(yes) is its document's count: 3, 0, 1; minus 0.5.
        self.assertEqual(scores, [2.5, -0.5, 0.5])

    def test_log_odds_does_not_saturate(self) -> None:
        logits = torch.tensor([[0.0, 40.0, 0.0], [0.0, 30.0, 0.0]])
        self.assertEqual(rerank.yes_no_log_odds(logits, 1, 2), [40.0, 30.0])


class Qwen3BatchingTests(unittest.TestCase):
    def test_length_batches_sorts_and_keeps_size_times_longest_under_budget(self) -> None:
        self.assertEqual(rerank.length_batches([5, 1, 3, 3, 9], 10), [[1, 2, 3], [0], [4]])
        for batch in rerank.length_batches([7, 2, 2, 4, 1, 6, 3], 12):
            lengths = [[7, 2, 2, 4, 1, 6, 3][i] for i in batch]
            self.assertLessEqual(len(batch) * max(lengths), 12)
        # Longer than the budget: a batch of its own, never dropped.
        self.assertEqual(rerank.length_batches([50, 1], 10), [[1], [0]])
        self.assertEqual(rerank.length_batches([], 10), [])

    def test_scores_come_back_in_request_order_however_the_pool_is_split(self) -> None:
        pairs = [("q", "!" * n + "x" * (40 - 3 * n)) for n in (3, 0, 7, 1, 5, 2)]
        whole = rerank._qwen3_scores(StubCausalLM(), StubTokenizer(), pairs, "cpu")
        width = len(rerank.qwen3_input_ids(StubTokenizer(), pairs[:1], rerank.MAX_LENGTH)[0])
        with patch.object(rerank, "BATCH_TOKENS", width * 2):
            split = rerank._qwen3_scores(StubCausalLM(), StubTokenizer(), pairs, "cpu")
        self.assertEqual(whole, [2.5, -0.5, 6.5, 0.5, 4.5, 1.5])
        self.assertEqual(split, whole)

    def test_a_qwen3_request_is_one_model_call(self) -> None:
        docs = [{"id": str(i), "text": "!" * i} for i in range(rerank.BATCH_SIZE * 3)]
        with patch.object(rerank, "QWEN3", True), patch.object(
            rerank, "_infer_scores", side_effect=lambda pairs: [float(len(p[1])) for p in pairs]
        ) as fake:
            hits = rerank.rerank("q", docs)
        self.assertEqual(fake.call_count, 1)
        self.assertEqual(hits[0]["id"], str(len(docs) - 1))

    def test_float16_is_refused_at_boot(self) -> None:
        env = {**os.environ, "LOUVAIN_RERANK_KIND": "qwen3-reranker", "LOUVAIN_RERANK_DTYPE": "float16"}
        run = subprocess.run(
            [sys.executable, "-c", "import rerank"], cwd=Path(__file__).resolve().parent, env=env,
            capture_output=True, text=True,
        )
        self.assertNotEqual(run.returncode, 0)
        self.assertIn("LOUVAIN_RERANK_DTYPE must be float32 or bfloat16", run.stderr)


TOKEN = "qwen3-wire-token"


class Qwen3WireTests(unittest.TestCase):
    """`rerank.py`'s real Handler in the qwen3 kind, over HTTP, with the stub model loaded in place of the real one."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.patches = [
            patch.object(rerank, "QWEN3", True),
            patch.object(rerank, "SIDECAR_TOKEN", TOKEN),
            patch.object(rerank, "_model", StubCausalLM()),
            patch.object(rerank, "_tokenizer", StubTokenizer()),
            patch.object(rerank, "_device", "cpu"),
        ]
        for p in cls.patches:
            p.start()
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), rerank.Handler)
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()
        cls.url = f"http://127.0.0.1:{cls.server.server_address[1]}/rerank"

    @classmethod
    def tearDownClass(cls) -> None:
        cls.server.shutdown()
        for p in cls.patches:
            p.stop()

    def post(self, body, token=TOKEN):
        headers = {"content-type": "application/json", **({"authorization": f"Bearer {token}"} if token else {})}
        req = urllib.request.Request(self.url, data=json.dumps(body).encode(), headers=headers)
        with urllib.request.urlopen(req, timeout=10) as res:
            return res.status, json.loads(res.read())

    def test_same_wire_sorted_by_log_odds(self) -> None:
        status, body = self.post({"query": "q", "documents": [{"id": "a", "text": "!"}, {"id": "b", "text": "!!!"}, {"id": "c", "text": "x"}], "top_n": 2})
        self.assertEqual(status, 200)
        # The answer names the model that scored it, so a client never applies one model's cut-off to another's scores.
        self.assertEqual(
            body,
            {"results": [{"id": "b", "score": 2.5}, {"id": "a", "score": 0.5}], "model": rerank.MODEL_NAME},
        )

    def test_without_the_bearer_is_401(self) -> None:
        with self.assertRaises(urllib.error.HTTPError) as err:
            self.post({"query": "q", "documents": [{"id": "a", "text": "!"}]}, token=None)
        self.assertEqual(err.exception.code, 401)


if __name__ == "__main__":
    unittest.main()
