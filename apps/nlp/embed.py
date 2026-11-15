"""The embedding sidecar: `Xenova/bge-base-en-v1.5`'s ONNX export, mean-pooled over the attention mask and normalised.

Every stored vector came from this model, pooling and normalisation, so a query is embedded the same way: a different
embedding, even a better one, degrades retrieval against what is stored with nothing to point at, and a change of model
is a re-embed. Two backends: ONNX, the default (no torch, a small image, any CPU), and `LOUVAIN_EMBEDDING_BACKEND=torch`,
the same weights through PyTorch, far faster run natively beside a GPU. A container on macOS has no Metal, so the torch
backend is for a native run.
"""

import collections
import json
import os
import socket
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import numpy as np
import onnxruntime as ort
from huggingface_hub import hf_hub_download
from huggingface_hub.errors import EntryNotFoundError, LocalEntryNotFoundError
from tokenizers import Tokenizer

import sidecar_auth

class DualStackServer(ThreadingHTTPServer):
    """One socket for both address families (the same class as bm25.py's, kept
    in each sidecar because each is one self-contained file its image copies
    alone). A private network may be IPv6-only and a compose network is IPv4;
    bound to `0.0.0.0` a sidecar answers the one and refuses the other."""

    address_family = socket.AF_INET6
    # The listen backlog. The stdlib's default is 5: many clients connecting at once past it are reset by the kernel,
    # and each reset is a retried request. Admission is still `MAX_QUEUE`'s, which answers 503 busy; this only stops a
    # connection being dropped before it is admitted or refused.
    request_queue_size = 1024

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
        server = _Ipv4Server(("0.0.0.0", port), handler)
    server.serve_forever()


class _Ipv4Server(ThreadingHTTPServer):
    request_queue_size = DualStackServer.request_queue_size

def setting(name: str, default: str) -> str:
    """A knob, `LOUVAIN_<name>`, read in one place so every setting has the same
    prefix and an unset one its default."""
    return os.environ.get(f"LOUVAIN_{name}", default)


MODEL = setting("EMBEDDING_MODEL", "Xenova/bge-base-en-v1.5")
# A model not on the hub: a directory baked into the image holding its ONNX export (`model.onnx`, with `model.onnx_data`
# beside it for a graph over 2 GB) and its `tokenizer.json`, at the top or under `onnx/`. The image fetches it at build
# time (Dockerfile.embed). `EMBEDDING_MODEL` still names it: it is the space's label, recorded beside every vector.
MODEL_DIR = setting("EMBEDDING_MODEL_DIR", "")
# The hub commit the image fetched a hub model at (Dockerfile.embed); the offline cache holds that commit, not a branch.
# Unset, the hub's default branch, as a native run reads it. Not part of the space: the model's name and shape are.
REVISION = setting("EMBEDDING_MODEL_REVISION", "") or None
DIM = int(setting("EMBEDDING_DIM", "768"))
# How a model turns tokens into one vector is the model's. bge-base is mean-pooled; a Qwen3-Embedding-style model is
# trained on its last real token's hidden state. `last` takes each text's last attended token, whichever side the
# tokenizer pads. The default, `mean`, is the pooling every stored bge vector was made with.
POOLING = setting("EMBEDDING_POOLING", "mean")
if POOLING not in ("mean", "last"):
    raise SystemExit(f"LOUVAIN_EMBEDDING_POOLING must be mean or last, not {POOLING!r}")
# Matryoshka: a model trained to keep its meaning in its leading dimensions may be served at fewer than it produces —
# the first DIM, re-normalised — so a stronger model fits the 768-dimensional columns without a schema change. It is a
# property of the model's training, so it is declared, never inferred: without it a model wider than DIM refuses boot.
MATRYOSHKA = setting("EMBEDDING_MATRYOSHKA", "false").lower() == "true"
# Where a text past MAX_TOKENS is cut: `tokenizers` truncates before the special tokens are added, so a long text keeps
# its closing [SEP] / EOS. Part of the embedding space.
TRUNCATION = "before-special-tokens"
# The space every vector this process returns is in, stated with the vectors: a writer records the space of the call
# that produced what it stores, not of whatever the sidecar says later.
SPACE = {"model": MODEL, "pooling": POOLING, "dimensions": DIM, "matryoshka": MATRYOSHKA, "truncation": TRUNCATION}
# The sha256 of the weights this image was built from, stated with the space when there is one: a checkpoint rotated
# under the same label is then a different space, and a query from new weights is never ranked against vectors from the
# old. Absent for a public hub model named by its id alone, so its space stays the one every stored vector records.
WEIGHTS = setting("EMBEDDING_MODEL_SHA256", "").strip().lower()
if WEIGHTS:
    SPACE["weights"] = WEIGHTS
# A /count or /embed body larger than this is refused before it is read: 256 texts of ~8k characters each.
MAX_BODY = 4 * 1024 * 1024
PORT = int(os.environ.get("PORT", "8090"))
MAX_TEXTS = 256
MAX_TOKENS = 512
# The shared bearer (`sidecar_auth.py`). Empty is open.
SIDECAR_TOKEN = setting("SIDECAR_TOKEN", "")

# One inference at a time by default, and a bounded queue in front of it. This is throughput, not caution: onnxruntime
# already uses every core for one batch, so N requests run at once all slow down together until callers time out.
CONCURRENCY = max(1, int(setting("EMBEDDINGS_CONCURRENCY", "1")))
MAX_QUEUE = max(1, int(setting("EMBEDDINGS_MAX_QUEUE", "64")))

# Coalescing. With `EMBEDDINGS_COALESCE_TEXTS` > 0, each inference worker takes the next queued request and every one
# queued behind it, up to that many texts, as one batch, and hands each its own slice back. Pooling is masked, so a
# text's vector does not depend on what shares its batch. 0 keeps a pass per request. The default follows the device
# (set below): on (64) on a GPU, where batching raises throughput; off on a CPU, where one pass already uses every core.

_slots = threading.Semaphore(CONCURRENCY)
_counts = threading.Lock()
_in_flight = 0
_queued = 0

BACKEND = setting("EMBEDDING_BACKEND", "onnx")
TORCH_MODEL = setting("EMBEDDING_TORCH_MODEL", "BAAI/bge-base-en-v1.5")

def _model_file(name: str, required: bool = True) -> str | None:
    """One file of the model: from `MODEL_DIR` when set (at the top, else under `onnx/`), else from the Hub's cache."""
    if MODEL_DIR:
        for candidate in (os.path.join(MODEL_DIR, os.path.basename(name)), os.path.join(MODEL_DIR, name)):
            if os.path.isfile(candidate):
                return candidate
        if required:
            raise SystemExit(f"{name} is not in LOUVAIN_EMBEDDING_MODEL_DIR={MODEL_DIR}")
        return None
    try:
        return hf_hub_download(MODEL, name, revision=REVISION)
    except (EntryNotFoundError, LocalEntryNotFoundError):
        if required:
            raise
        return None


_tok = Tokenizer.from_file(_model_file("tokenizer.json"))
_tok.enable_padding()
_tok.enable_truncation(max_length=MAX_TOKENS)
# The same tokenizer, untruncated and unpadded: how long a text really is, special tokens included (`/count`).
_counter = Tokenizer.from_file(_model_file("tokenizer.json"))
# The torch backend needs no ONNX graph: it embeds with the checkpoint `EMBEDDING_TORCH_MODEL` names and
# never reaches the session below, so a model kept as a checkpoint only (a custom embedding checkpoint with no ONNX
# export) is served without one. The tokenizer above is still read from `MODEL_DIR`: it counts tokens for both.
_sess = None
_inputs: set[str] = set()
_CACHE: list[tuple[str, list, type]] = []
_OUTPUT = ""
if BACKEND != "torch":
    _onnx = _model_file("onnx/model.onnx")
    # A graph over 2 GB keeps its weights beside it (`model.onnx_data`, a Qwen3-Embedding export's case); onnxruntime
    # reads them from the same directory, so they are fetched there. bge's graph has none: not in the repo, or — in the
    # image, which runs `HF_HUB_OFFLINE=1` with its weights baked — not baked because the model has none. A model that
    # needed it and lacks it fails loudly in onnxruntime on the next line.
    _model_file("onnx/model.onnx_data", required=False)
    _sess = ort.InferenceSession(_onnx, providers=["CPUExecutionProvider"])
    _inputs = {i.name for i in _sess.get_inputs()}
    # A decoder exported for generation (a Qwen3-Embedding ONNX export) also asks for its key/value cache. One forward
    # pass over the whole text has none, so each is an empty tensor of past length 0, shaped from the graph's own
    # declaration: the batch where the graph names it, 0 for the past length, the fixed head counts and sizes as declared.
    _CACHE = [
        (i.name, i.shape, np.float16 if "float16" in i.type else np.float32)
        for i in _sess.get_inputs()
        if i.name.startswith("past_key_values")
    ]
    # Only the hidden states: a decoder's export also returns its whole key/value cache, which nothing here reads.
    _OUTPUT = next(
        (o.name for o in _sess.get_outputs() if o.name == "last_hidden_state"), _sess.get_outputs()[0].name
    )


def _empty_cache(batch: int) -> dict[str, np.ndarray]:
    out = {}
    for name, shape, dtype in _CACHE:
        dims = [d if isinstance(d, int) else (batch if "batch" in str(d) else 0) for d in shape]
        out[name] = np.zeros(dims, dtype=dtype)
    return out

_device = "cpu"
if BACKEND == "torch":
    import torch
    from transformers import AutoModel, AutoTokenizer

    # Metal where there is Metal, CUDA where there is CUDA, CPU otherwise —
    # and torch on CPU is still several times the ONNX path here.
    _device = (
        "mps"
        if torch.backends.mps.is_available()
        else ("cuda" if torch.cuda.is_available() else "cpu")
    )
    _torch_tok = AutoTokenizer.from_pretrained(TORCH_MODEL)
    # float32, stated: a checkpoint saved in bfloat16 would otherwise load in it under a library that honours the saved
    # dtype, and embed far enough from the ONNX path to fail the parity check.
    _torch_model = (
        AutoModel.from_pretrained(TORCH_MODEL, torch_dtype=torch.float32).to(_device).eval()
    )


def _pool(hidden: np.ndarray, mask: np.ndarray) -> np.ndarray:
    """One vector per text from `[batch, tokens, dim]` hidden states and the attention mask, by `POOLING`, then cut to
    `DIM` when the model is Matryoshka-trained, then L2-normalised. Masked either way: padding must not reach a vector,
    which an unmasked mean (or the last position rather than the last token) lets in, invisibly, wherever a batch
    mixes lengths."""
    if POOLING == "last":
        last = mask.sum(1).astype(np.int64) - 1  # right padding: the last attended position
        if (mask[:, -1] == 1).all():  # left padding (or none): every row ends on a real token
            last = np.full(mask.shape[0], mask.shape[1] - 1, dtype=np.int64)
        pooled = hidden[np.arange(hidden.shape[0]), np.clip(last, 0, None)]
    else:
        m = mask[..., None].astype(np.float32)
        pooled = (hidden * m).sum(1) / np.clip(m.sum(1), 1e-9, None)
    if MATRYOSHKA and pooled.shape[1] > DIM:
        pooled = pooled[:, :DIM]
    return pooled / np.clip(np.linalg.norm(pooled, axis=1, keepdims=True), 1e-12, None)


def _embed_torch(texts: list[str]) -> list[list[float]]:
    """The same weights and the same pooling as the ONNX path, on whatever device torch has."""
    import torch  # noqa: PLC0415 — only imported when this backend is chosen

    batch = _torch_tok(
        texts, padding=True, truncation=True, max_length=MAX_TOKENS, return_tensors="pt"
    ).to(_device)
    with torch.no_grad():
        hidden = _torch_model(**batch).last_hidden_state
    return _pool(
        hidden.float().cpu().numpy(), batch["attention_mask"].cpu().numpy()
    ).astype(np.float32).tolist()


def count(texts: list[str]) -> list[int]:
    """How many tokens each text is, by the model's own tokenizer, untruncated, special tokens included (`/count`)."""
    return [len(e.ids) for e in _counter.encode_batch(texts)]


MICRO_BATCH = max(1, int(setting("EMBEDDINGS_MICRO_BATCH", "16")))


def _token_counts(texts: list[str]) -> list[int]:
    """Tokens each text runs as, after truncation, so texts can be grouped by it."""
    if BACKEND == "torch":
        ids = _torch_tok(texts, truncation=True, max_length=MAX_TOKENS)["input_ids"]
        return [len(i) for i in ids]
    return [int(sum(e.attention_mask)) for e in _tok.encode_batch(texts)]


def embed(texts: list[str]) -> list[list[float]]:
    """One vector per text, in the order given. A batch is padded to its LONGEST text, so a coalesced batch of mixed
    lengths spends most of its work on padding: the texts run shortest first in groups of `MICRO_BATCH`, each padded
    only to its own longest, and the vectors go back in request order. Masked pooling makes a text's vector
    independent of what shares its pass (`test_embed_coalesce.py`), so the grouping changes no vector."""
    if len(texts) <= MICRO_BATCH:
        return _forward(texts)
    counts = _token_counts(texts)
    order = sorted(range(len(texts)), key=counts.__getitem__)
    out: dict[int, list[float]] = {}
    for at in range(0, len(order), MICRO_BATCH):
        group = order[at : at + MICRO_BATCH]
        for i, vector in zip(group, _forward([texts[i] for i in group]), strict=True):
            out[i] = vector
    return [out[i] for i in range(len(texts))]


def _forward(texts: list[str]) -> list[list[float]]:
    """One forward pass over `texts`, padded to the longest of them."""
    if not texts:
        return []
    if BACKEND == "torch":
        return _embed_torch(texts)
    enc = _tok.encode_batch(texts)
    ids = np.array([e.ids for e in enc], dtype=np.int64)
    mask = np.array([e.attention_mask for e in enc], dtype=np.int64)
    feed = {"input_ids": ids, "attention_mask": mask}
    if "token_type_ids" in _inputs:
        feed["token_type_ids"] = np.zeros_like(ids)
    if "position_ids" in _inputs:
        # A decoder's export (Qwen3-Embedding) takes positions; counted over real tokens so padding moves none.
        feed["position_ids"] = np.clip(np.cumsum(mask, axis=1) - 1, 0, None).astype(np.int64)
    feed.update(_empty_cache(ids.shape[0]))
    hidden = _sess.run([_OUTPUT], feed)[0]
    return _pool(hidden, mask).astype(np.float32).tolist()


COALESCE_TEXTS = max(
    0, int(setting("EMBEDDINGS_COALESCE_TEXTS", "64" if _device in ("cuda", "mps") else "0"))
)


class _Job:
    __slots__ = ("texts", "done", "vectors", "error")

    def __init__(self, texts: list[str]) -> None:
        self.texts = texts
        self.done = threading.Event()
        self.vectors: list[list[float]] | None = None
        self.error: BaseException | None = None


_pending: "collections.deque[_Job]" = collections.deque()
_ready = threading.Condition()


def _coalescer() -> None:
    """An inference worker: the oldest queued request and every one behind it that fits within
    `COALESCE_TEXTS` texts, as one batch, in arrival order. A request larger than the cap runs alone."""
    global _in_flight, _queued
    while True:
        with _ready:
            while not _pending:
                _ready.wait()
            batch = [_pending.popleft()]
            total = len(batch[0].texts)
            while _pending and total + len(_pending[0].texts) <= COALESCE_TEXTS:
                job = _pending.popleft()
                batch.append(job)
                total += len(job.texts)
        with _counts:
            _queued -= len(batch)
            _in_flight += len(batch)
        try:
            vectors = embed([t for job in batch for t in job.texts])
            at = 0
            for job in batch:
                job.vectors = vectors[at : at + len(job.texts)]
                at += len(job.texts)
        except BaseException as err:  # noqa: BLE001 - every request in the batch gets the failure
            for job in batch:
                job.error = err
        finally:
            with _counts:
                _in_flight -= len(batch)
            for job in batch:
                job.done.set()


def _coalesced(texts: list[str]) -> list[list[float]]:
    """Queue one request for a coalescing worker and wait for its slice."""
    job = _Job(texts)
    with _ready:
        _pending.append(job)
        _ready.notify()
    job.done.wait()
    if job.error is not None:
        raise job.error
    return job.vectors or []


class Handler(BaseHTTPRequestHandler):
    def _send(self, code: int, body: dict) -> None:
        payload = json.dumps(body).encode()
        self.send_response(code)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def do_GET(self) -> None:  # noqa: N802 - stdlib's casing
        if self.path == "/healthz":
            # Never gated on load: a saturated sidecar is BUSY, not unhealthy,
            # and restarting one that is doing its job is how a backlog becomes
            # an outage. The counters are reported so an operator can SEE the
            # difference, which is what was missing when this went unnoticed.
            self._send(
                200,
                {
                    "ok": True,
                    "role": "embeddings",
                    "dimensions": DIM,
                    "model": MODEL,
                    "pooling": POOLING,
                    "matryoshka": MATRYOSHKA,
                    "truncation": TRUNCATION,
                    **({"weights": WEIGHTS} if WEIGHTS else {}),
                    "inFlight": _in_flight,
                    "queued": _queued,
                    "concurrency": CONCURRENCY,
                    "coalesceTexts": COALESCE_TEXTS,
                },
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
        if self.path == "/count":
            # How many tokens each text is, by the model's own tokenizer — so the one embedder decides which stored
            # passages were cut at MAX_TOKENS, not a second tokenizer's guess.
            try:
                length = int(self.headers.get("content-length", "0"))
                if length > MAX_BODY:
                    self._send(413, {"error": f"body over {MAX_BODY} bytes"})
                    return
                texts = (json.loads(self.rfile.read(length) or b"{}")).get("texts") or []
                if not isinstance(texts, list) or len(texts) > MAX_TEXTS:
                    self._send(400, {"error": f"texts must be a list of at most {MAX_TEXTS}"})
                    return
                # Behind the same inference slots as /embed: untruncated tokenising of long texts is work too, and a
                # sweep must queue behind live embedding rather than beside it.
                with _slots:
                    counts = count([str(t) for t in texts])
                self._send(200, {"counts": counts})
            except Exception as err:  # noqa: BLE001
                self._send(500, {"error": type(err).__name__})
            return
        if self.path != "/embed":
            self._send(404, {"error": "not found"})
            return
        try:
            length = int(self.headers.get("content-length", "0"))
            req = json.loads(self.rfile.read(length) or b"{}")
            texts = req.get("texts") or []
            if not isinstance(texts, list) or len(texts) > MAX_TEXTS:
                self._send(400, {"error": f"texts must be a list of at most {MAX_TEXTS}"})
                return
            global _in_flight, _queued
            with _counts:
                if _queued >= MAX_QUEUE:
                    # Say BUSY rather than time out. A caller that is refused
                    # quickly can back off; one that waits 30 seconds for a
                    # timeout has already blocked whatever it was doing.
                    self._send(503, {"error": "busy", "queued": _queued})
                    return
                _queued += 1
            if COALESCE_TEXTS > 0:
                # The worker moves this request from queued to in flight and back; `vectors`, the key the
                # TypeScript client reads.
                self._send(200, {"vectors": _coalesced([str(t) for t in texts]), "space": SPACE})
                return
            try:
                with _slots:
                    with _counts:
                        _queued -= 1
                        _in_flight += 1
                    try:
                        # `vectors`, because that is the key the TypeScript
                        # client already reads.
                        self._send(200, {"vectors": embed([str(t) for t in texts]), "space": SPACE})
                    finally:
                        with _counts:
                            _in_flight -= 1
            except Exception:
                with _counts:
                    _queued = max(0, _queued - 1)
                raise
        except Exception as err:  # noqa: BLE001
            # Never the text: it is document text and this is a log.
            self._send(500, {"error": type(err).__name__})

    def log_message(self, *_args) -> None:
        """Silent: paths carry no information and bodies are document text."""


if __name__ == "__main__":
    got = len(embed(["Warm up."])[0])
    if got != DIM:
        # A dimension mismatch is not something to discover at write time, when
        # the vector column rejects it one row into a bulk ingest.
        raise SystemExit(f"model {MODEL} produced {got} dimensions, expected {DIM}")
    print(
        f"louvain embedding sidecar on :{PORT} ({MODEL}, {DIM}d{' matryoshka' if MATRYOSHKA else ''}, "
        f"{POOLING}-pooled, "
        f"backend {BACKEND}{'/' + _device if BACKEND == 'torch' else ''}, "
        f"concurrency {CONCURRENCY}, queue {MAX_QUEUE}, coalesce {COALESCE_TEXTS or 'off'}, "
        f"{sidecar_auth.describe(SIDECAR_TOKEN)})",
        flush=True,
    )
    if COALESCE_TEXTS > 0:
        for _ in range(CONCURRENCY):
            threading.Thread(target=_coalescer, daemon=True).start()
    serve(Handler, PORT)
