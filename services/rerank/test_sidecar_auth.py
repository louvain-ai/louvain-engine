"""Unit tests for the sidecars' shared bearer check (`sidecar_auth.py`).

The helper is stdlib only, so these run on any interpreter. The handler test
serves `rerank.py`'s real `Handler` in-process with the model call patched out
(the same seam `test_rerank.py` uses), which is the one sidecar whose module
imports without loading a model: `embed.py` and `main.py` load weights at
import, so their wiring is held by `scripts/verify-nlp.mjs` statically, and
`test_bm25.py` drives the BM25 server over HTTP with a token set.

    python -m unittest services/rerank/test_sidecar_auth.py
"""

import json
import sys
import threading
import unittest
import urllib.error
import urllib.request
from email.message import Message
from http.server import ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))

import sidecar_auth

TOKEN = "unit-test-token-0123456789abcdef"


def headers(authorization: str | None) -> Message:
    message = Message()
    if authorization is not None:
        message["Authorization"] = authorization
    return message


class AuthorizedTests(unittest.TestCase):
    def test_no_token_configured_is_open(self) -> None:
        self.assertTrue(sidecar_auth.authorized(headers(None), ""))
        self.assertTrue(sidecar_auth.authorized(headers("Bearer anything"), ""))

    def test_the_exact_bearer_is_accepted(self) -> None:
        self.assertTrue(sidecar_auth.authorized(headers(f"Bearer {TOKEN}"), TOKEN))

    def test_the_header_name_is_case_insensitive(self) -> None:
        message = Message()
        message["authorization"] = f"Bearer {TOKEN}"
        self.assertTrue(sidecar_auth.authorized(message, TOKEN))

    def test_missing_wrong_or_malformed_is_refused(self) -> None:
        for value in (
            None,
            "",
            "Bearer",
            "Bearer ",
            f"bearer {TOKEN}",
            f"Basic {TOKEN}",
            TOKEN,
            f"Bearer {TOKEN}x",
            f"Bearer {TOKEN[:-1]}",
            f"Bearer  {TOKEN}",
        ):
            with self.subTest(value=value):
                self.assertFalse(sidecar_auth.authorized(headers(value), TOKEN))

    def test_describe_never_prints_the_token(self) -> None:
        self.assertEqual(sidecar_auth.describe(TOKEN), "auth: bearer")
        self.assertEqual(sidecar_auth.describe(""), "auth: open")


class HandlerTests(unittest.TestCase):
    """`rerank.py`'s Handler, served for real, with a token set."""

    @classmethod
    def setUpClass(cls) -> None:
        import rerank

        cls.rerank = rerank
        cls.token_patch = patch.object(rerank, "SIDECAR_TOKEN", TOKEN)
        cls.infer_patch = patch.object(
            rerank, "_infer_scores", side_effect=lambda pairs: [float(len(d)) for _q, d in pairs]
        )
        cls.token_patch.start()
        cls.infer_patch.start()
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), rerank.Handler)
        cls.base = f"http://127.0.0.1:{cls.server.server_address[1]}"
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls) -> None:
        cls.server.shutdown()
        cls.server.server_close()
        cls.infer_patch.stop()
        cls.token_patch.stop()

    def call(self, method: str, path: str, body: dict | None = None, authorization: str | None = None):
        data = json.dumps(body).encode() if body is not None else None
        request = urllib.request.Request(f"{self.base}{path}", data=data, method=method)
        request.add_header("content-type", "application/json")
        if authorization is not None:
            request.add_header("authorization", authorization)
        try:
            with urllib.request.urlopen(request, timeout=5) as response:
                return response.status, json.loads(response.read())
        except urllib.error.HTTPError as err:
            return err.code, json.loads(err.read() or b"{}")

    def test_healthz_is_open(self) -> None:
        status, body = self.call("GET", "/healthz")
        self.assertEqual(status, 200)
        self.assertEqual(body["role"], "rerank")

    def test_rerank_without_the_bearer_is_401(self) -> None:
        body = {"query": "q", "documents": [{"id": "a", "text": "aa"}]}
        self.assertEqual(self.call("POST", "/rerank", body), (401, {"error": "unauthorized"}))
        self.assertEqual(self.call("POST", "/rerank", body, "Bearer wrong")[0], 401)

    def test_unknown_routes_are_401_before_404(self) -> None:
        self.assertEqual(self.call("GET", "/nope")[0], 401)
        self.assertEqual(self.call("POST", "/nope", {})[0], 401)
        self.assertEqual(self.call("GET", "/nope", authorization=f"Bearer {TOKEN}")[0], 404)

    def test_rerank_with_the_bearer_answers(self) -> None:
        body = {"query": "q", "documents": [{"id": "a", "text": "a"}, {"id": "b", "text": "bbb"}]}
        status, answer = self.call("POST", "/rerank", body, f"Bearer {TOKEN}")
        self.assertEqual(status, 200)
        self.assertEqual([r["id"] for r in answer["results"]], ["b", "a"])


if __name__ == "__main__":
    unittest.main()
