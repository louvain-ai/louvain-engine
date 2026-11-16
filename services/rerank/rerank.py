"""The reranking sidecar: scores (query, document) pairs with a cross-encoder or a Qwen3 reranker.

A cross-encoder reads the question and each candidate together, so it orders a first-stage page better than either
ranker that produced it. Only the document half of a pair is truncated, so the query keeps every token. The model
loads on first use and runs one inference at a time: a caller that waits past `LOUVAIN_RERANK_BUSY_MS` gets `503 busy`
and keeps its unreranked order. A Qwen3 pool is batched by length and scored in float32 unless bfloat16 is asked for,
so the same pool always gets the same order. It never logs a query or a document.
"""

import json
import os
import socket
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import torch
from transformers import AutoModelForCausalLM, AutoModelForSequenceClassification, AutoTokenizer

import sidecar_auth


class DualStackServer(ThreadingHTTPServer):
    """One socket for both address families (the same class as bm25.py's, kept
    in each sidecar because each is one self-contained file its image copies
    alone). A private network may be IPv6-only and a compose network is IPv4;
    bound to `0.0.0.0` a sidecar answers the one and refuses the other."""

    address_family = socket.AF_INET6

    def server_bind(self) -> None:
        try:
            self.socket.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 0)
        except OSError:
            pass
        super().server_bind()


def serve(handler: type[BaseHTTPRequestHandler], port: int) -> None:
    try:
        server: ThreadingHTTPServer = DualStackServer(("::", port), handler)
    except OSError:
        server = ThreadingHTTPServer(("0.0.0.0", port), handler)
    server.serve_forever()


def setting(name: str, default: str) -> str:
    """A knob, `LOUVAIN_<name>`, read in one place so every setting has the same
    prefix and an unset one its default."""
    return os.environ.get(f"LOUVAIN_{name}", default)


PORT = int(os.environ.get("PORT", "8096"))
# `cross-encoder` (bge-style, one logit) or `qwen3-reranker` (causal LM, yes/no).
KIND = setting("RERANK_KIND", "cross-encoder")
if KIND not in ("cross-encoder", "qwen3-reranker"):
    raise SystemExit(f"LOUVAIN_RERANK_KIND must be cross-encoder or qwen3-reranker, not {KIND!r}")
QWEN3 = KIND == "qwen3-reranker"
MODEL_NAME = setting("RERANK_MODEL", "Qwen/Qwen3-Reranker-4B" if QWEN3 else "BAAI/bge-reranker-v2-m3")
# The hub commit the weights were fetched at (`Dockerfile`), read again here: an offline cache holds that commit,
# not a branch. Unset, the hub's default branch.
MODEL_REVISION = setting("RERANK_MODEL_REVISION", "") or None
DEVICE_SETTING = setting("RERANK_DEVICE", "auto")
# A Qwen3 reranker reads a whole document (32k context); the defaults follow the kind.
MAX_CHARS = int(setting("RERANK_MAX_CHARS", "8000" if QWEN3 else "4000"))
MAX_LENGTH = int(setting("RERANK_MAX_LENGTH", "8192" if QWEN3 else "512"))
INSTRUCTION = setting("RERANK_INSTRUCTION", "Given a question about a company's work, judge whether the document answers it")
# Documents per model call, for a cross-encoder. A Qwen3 reranker batches by tokens instead (below).
BATCH_SIZE = int(setting("RERANK_BATCH", "16"))
# A Qwen3 reranker's tokens per model call: a batch's size times its longest input (module docstring).
BATCH_TOKENS = int(setting("RERANK_BATCH_TOKENS", "32768"))
# A Qwen3 reranker's precision: float32, the one its published tables are scored in, or bfloat16 (faster; near-ties
# may order differently).
QWEN3_DTYPE = setting("RERANK_DTYPE", "float32")
if QWEN3_DTYPE not in ("float32", "bfloat16"):
    raise SystemExit(f"LOUVAIN_RERANK_DTYPE must be float32 or bfloat16, not {QWEN3_DTYPE!r}")
BUSY_MS = int(setting("RERANK_BUSY_MS", "8000"))
MAX_DOCUMENTS = 200
# The shared bearer (`sidecar_auth.py`). Empty is open.
SIDECAR_TOKEN = setting("SIDECAR_TOKEN", "")

_model = None
_tokenizer = None
_device: str | None = None
_load_lock = threading.Lock()
# Guards model calls — one inference at a time per process. A bounded
# `acquire(timeout=...)` rather than a blocking one, so a caller waiting
# behind another rerank in flight gets a fast `503 busy` instead of piling up
# behind the HTTP connection of whoever got there first.
_infer_lock = threading.Lock()

# The Qwen3-Reranker prompt, as its model card states it. Fixed: a different
# system line or answer frame is a different model's scores.
QWEN3_SYSTEM = (
    "<|im_start|>system\nJudge whether the Document meets the requirements based on the Query and the Instruct "
    'provided. Note that the answer can only be "yes" or "no".<|im_end|>\n<|im_start|>user\n'
)
QWEN3_SUFFIX = "<|im_end|>\n<|im_start|>assistant\n<think>\n\n</think>\n\n"


def qwen3_prompt(query: str, instruction: str = INSTRUCTION) -> tuple[str, str]:
    """The text before a document and the text after it."""
    return QWEN3_SYSTEM + f"<Instruct>: {instruction}\n<Query>: {query}\n<Document>: ", QWEN3_SUFFIX


def qwen3_input_ids(tokenizer, pairs: list[tuple[str, str]], max_length: int) -> list[list[int]]:
    """Each pair's token ids with only the DOCUMENT cut: the prefix (system,
    instruction, query) and the suffix (the answer frame) are always whole, so
    the last token is always the position the model answers at."""
    rows = []
    for query, doc in pairs:
        head, tail = qwen3_prompt(query)
        # Tokenized as one string when it fits, as the model card does: pieces tokenized apart differ at their seams.
        whole = tokenizer(head + doc + tail, add_special_tokens=False)["input_ids"]
        if len(whole) <= max_length:
            rows.append(whole)
            continue
        h = tokenizer(head, add_special_tokens=False)["input_ids"]
        s = tokenizer(tail, add_special_tokens=False)["input_ids"]
        d = tokenizer(doc, add_special_tokens=False)["input_ids"][: max(0, max_length - len(h) - len(s))]
        rows.append(h + d + s)
    return rows


def yes_no_log_odds(last_logits: "torch.Tensor", yes_id: int, no_id: int) -> list[float]:
    """logit(yes) − logit(no) per row: log P(yes)/P(no) over the two answers,
    monotone in the card's P(yes) and never saturating."""
    return (last_logits[:, yes_id].float() - last_logits[:, no_id].float()).cpu().tolist()


def length_batches(lengths: list[int], budget: int) -> list[list[int]]:
    """Indices sorted by length (ties by position), grouped so each batch's size times its longest is at most
    `budget`; an input longer than the budget is a batch of its own. A function of the lengths alone."""
    batches: list[list[int]] = []
    current: list[int] = []
    for i in sorted(range(len(lengths)), key=lambda i: (lengths[i], i)):
        if current and (len(current) + 1) * lengths[i] > budget:
            batches.append(current)
            current = []
        current.append(i)
    if current:
        batches.append(current)
    return batches


def left_pad(rows: list[list[int]], pad_id: int) -> tuple["torch.Tensor", "torch.Tensor"]:
    """Left padding, so position -1 is every row's own last token."""
    width = max(len(r) for r in rows)
    ids = torch.full((len(rows), width), pad_id, dtype=torch.long)
    mask = torch.zeros((len(rows), width), dtype=torch.long)
    for i, r in enumerate(rows):
        ids[i, width - len(r) :] = torch.tensor(r, dtype=torch.long)
        mask[i, width - len(r) :] = 1
    return ids, mask


def _resolve_device() -> str:
    """Metal, then CUDA, then the CPU. A cross-encoder runs in fp16 on a GPU and fp32 on a CPU, which has no fast fp16."""
    if DEVICE_SETTING != "auto":
        return DEVICE_SETTING
    if torch.backends.mps.is_available():
        return "mps"
    if torch.cuda.is_available():
        return "cuda"
    return "cpu"


def _ensure_loaded() -> None:
    """Load the tokenizer and model on first use — double-checked locking so
    concurrent first requests do not each start their own download."""
    global _model, _tokenizer, _device
    if _model is not None:
        return
    with _load_lock:
        if _model is not None:
            return
        device = _resolve_device()
        if QWEN3:
            tokenizer = AutoTokenizer.from_pretrained(MODEL_NAME, revision=MODEL_REVISION, padding_side="left")
            # float32 unless bfloat16 is asked for, on every device: the same pool, the same order.
            model = AutoModelForCausalLM.from_pretrained(
                MODEL_NAME, revision=MODEL_REVISION, dtype=getattr(torch, QWEN3_DTYPE)
            )
        else:
            tokenizer = AutoTokenizer.from_pretrained(MODEL_NAME, revision=MODEL_REVISION)
            model = AutoModelForSequenceClassification.from_pretrained(MODEL_NAME, revision=MODEL_REVISION)
            if device in ("mps", "cuda"):
                model = model.half()
        model = model.to(device).eval()
        _tokenizer, _model, _device = tokenizer, model, device


def _infer_scores(pairs: list[tuple[str, str]]) -> list[float]:
    """Run the model over one batch of (query, document) pairs.

    The one function in this file that touches the model — see the module
    docstring for why everything else is deliberately kept out of it.
    """
    _ensure_loaded()
    if QWEN3:
        return _qwen3_scores(_model, _tokenizer, pairs, _device)
    encoded = _tokenizer(
        [p[0] for p in pairs],
        [p[1] for p in pairs],
        padding=True,
        truncation="only_second",
        max_length=MAX_LENGTH,
        return_tensors="pt",
    ).to(_device)
    with torch.no_grad():
        logits = _model(**encoded).logits
        # A single-label head (bge-reranker) has one column; a two-label one
        # has its positive class last.
        column = logits[:, -1] if logits.shape[-1] > 1 else logits[:, 0]
        scores = column.float().cpu().tolist()
    return scores


def _qwen3_scores(model, tokenizer, pairs: list[tuple[str, str]], device: str) -> list[float]:
    """A whole request through a Qwen3 reranker: fixed prompt, document-only truncation, batches by `length_batches`,
    left padding, log-odds at the last position, in the request's order."""
    rows = qwen3_input_ids(tokenizer, pairs, MAX_LENGTH)
    yes_id, no_id = tokenizer.convert_tokens_to_ids("yes"), tokenizer.convert_tokens_to_ids("no")
    scores = [0.0] * len(rows)
    for batch in length_batches([len(r) for r in rows], BATCH_TOKENS):
        ids, mask = left_pad([rows[i] for i in batch], tokenizer.pad_token_id or 0)
        with torch.no_grad():
            logits = model(input_ids=ids.to(device), attention_mask=mask.to(device), logits_to_keep=1).logits
        for i, score in zip(batch, yes_no_log_odds(logits[:, -1, :], yes_id, no_id)):
            scores[i] = score
    return scores


def rerank(query: str, documents: list[dict], top_n: int | None = None) -> list[dict]:
    """Score, sort and truncate: the pure logic `test_rerank.py` exercises, with the model behind `_infer_scores`.

    Caps to `MAX_DOCUMENTS`, cuts each text to `MAX_CHARS` before the tokenizer, scores `BATCH_SIZE` pairs a call,
    and returns hits by score, highest first, cut to `top_n` when given.
    """
    if not documents:
        return []
    capped = documents[:MAX_DOCUMENTS]
    pairs = [(query, str(doc["text"])[:MAX_CHARS]) for doc in capped]
    scores: list[float] = []
    # A Qwen3 request is ONE call, batched inside by tokens, so its batches depend on the whole pool and nothing else.
    step = len(pairs) if QWEN3 else BATCH_SIZE
    for start in range(0, len(pairs), step):
        scores.extend(_infer_scores(pairs[start : start + step]))
    results = [{"id": doc["id"], "score": float(score)} for doc, score in zip(capped, scores)]
    results.sort(key=lambda r: r["score"], reverse=True)
    if top_n is not None:
        results = results[:top_n]
    return results


class Handler(BaseHTTPRequestHandler):
    def _send(self, code: int, body: dict) -> None:
        payload = json.dumps(body).encode()
        self.send_response(code)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def _body(self) -> dict:
        length = int(self.headers.get("content-length", "0"))
        raw = self.rfile.read(length) if length else b"{}"
        return json.loads(raw or b"{}")

    def do_GET(self) -> None:  # noqa: N802 - stdlib's casing
        if self.path == "/healthz":
            self._send(
                200,
                {"ok": True, "role": "rerank", "kind": KIND, "model": MODEL_NAME, "device": _device or DEVICE_SETTING},
            )
        elif self._authorized():
            self._send(404, {"error": "not found"})

    def _authorized(self) -> bool:
        """Every route but `/healthz` needs the bearer when one is set, checked
        before the body is read (`sidecar_auth.py`)."""
        if sidecar_auth.authorized(self.headers, SIDECAR_TOKEN):
            return True
        self._send(401, {"error": "unauthorized"})
        return False

    def do_POST(self) -> None:  # noqa: N802 - stdlib's casing
        if not self._authorized():
            return
        if self.path != "/rerank":
            self._send(404, {"error": "not found"})
            return
        try:
            try:
                req = self._body()
            except json.JSONDecodeError:
                self._send(400, {"error": "invalid JSON"})
                return
            query = req.get("query")
            documents = req.get("documents")
            if not isinstance(query, str):
                self._send(400, {"error": "query is required"})
                return
            if not isinstance(documents, list):
                self._send(400, {"error": "documents must be a list"})
                return
            for doc in documents:
                if not isinstance(doc, dict) or "id" not in doc or "text" not in doc:
                    self._send(400, {"error": "each document needs id and text"})
                    return
            top_n = req.get("top_n")
            if top_n is not None and not isinstance(top_n, int):
                self._send(400, {"error": "top_n must be an integer"})
                return
            if not documents:
                self._send(200, {"results": [], "model": MODEL_NAME})
                return
            if not _infer_lock.acquire(timeout=BUSY_MS / 1000):
                # Refused fast, a caller falls back to the unreranked fused order; one that waits has already blocked.
                self._send(503, {"error": "busy"})
                return
            try:
                results = rerank(query, documents, top_n)
            finally:
                _infer_lock.release()
            self._send(200, {"results": results, "model": MODEL_NAME})
        except Exception as err:  # noqa: BLE001
            # Never the query or a document's text: both are document content, and this is a log.
            self._send(500, {"error": type(err).__name__})

    def log_message(self, *_args) -> None:
        """Silent: bodies are document text."""


if __name__ == "__main__":
    _ensure_loaded()
    print(
        f"louvain rerank sidecar on :{PORT} ({KIND} {MODEL_NAME}, device {_device}, "
        f"batch {BATCH_SIZE}, max_length {MAX_LENGTH}, {sidecar_auth.describe(SIDECAR_TOKEN)})",
        flush=True,
    )
    serve(Handler, PORT)
