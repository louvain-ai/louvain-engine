"""The BM25 keyword sidecar: a Tantivy index at the document grain, for the keyword leg of a search.

`ts_rank` scores every row matching any term before it sorts, so its cost grows with the matches; Tantivy keeps postings
sorted for top-k and answers in milliseconds. The fence is inside the query (`bm25_query._fence`), never a post-filter,
and the engine re-reads every hit under its own fence. The index stores the ids and each record's text, so a hit carries
a snippet of it; what a citation quotes is still Postgres's. Each workspace has an index of its own (`bm25_orgs.py`),
with one writer behind its lock; searches read the last reloaded snapshot concurrently. It never logs a document's text
or a query.

The server is this file, and the one place a setting is read: the index's shape is `bm25_schema.py`, the index on disk
and its writer `bm25_store.py`, the query and the fence `bm25_query.py`, the tiers of `strategy: "last"` `bm25_last.py`
and the listing `bm25_listing.py`.
"""

import json
import math
import os
import socket
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import analyzer
import sidecar_auth
from bm25_last import search_last
from bm25_listing import ListingUnsupported, listing
from bm25_query import DEFAULT_LIMIT, MAX_LIMIT, FilterUnsupported, search
from bm25_orgs import Orgs
from bm25_store import Knobs, _instant


class DualStackServer(ThreadingHTTPServer):
    """One socket for both address families: a private network may be IPv6-only while a compose network is IPv4, and a
    sidecar bound to `0.0.0.0` answers its IPv4 health check while refusing the engine over IPv6."""

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
        # A host with IPv6 switched off: IPv4 alone.
        server = ThreadingHTTPServer(("0.0.0.0", port), handler)
    server.serve_forever()


def setting(name: str, default: str) -> str:
    """A knob, `LOUVAIN_<name>`, read in one place so every setting has the same
    prefix and an unset one its default."""
    return os.environ.get(f"LOUVAIN_{name}", default)


PORT = int(os.environ.get("PORT", "8095"))
BM25_DIR = setting("BM25_DIR", "./.bm25-index")
BM25_HEAP_MB = int(setting("BM25_HEAP_MB", "512"))
# The shared bearer (`sidecar_auth.py`). Empty is open, for a local run.
SIDECAR_TOKEN = setting("SIDECAR_TOKEN", "")
ORGS = Orgs(
    BM25_DIR,
    BM25_HEAP_MB,
    Knobs(
        title_boost=float(setting("BM25_TITLE_BOOST", "0")),
        header_boost=float(setting("BM25_HEADER_BOOST", "0.5")),
        variants=setting("BM25_VARIANTS", "off").strip().lower() == "on",
        analyzer=setting("BM25_ANALYZER", "off").strip().lower() == "on",
        exact_boost=float(setting("BM25_EXACT_BOOST", "0")),
    ),
)


# What an org with no index answers: what `search_last` and `listing` answer a reader who can read nothing.
NOTHING_LAST = {"hits": [], "asked": 0, "completed": [], "corrected": [], "dropped": []}
NOTHING_LISTED = {"ids": [], "snippets": [], "total": 0, "facets": [], "facetsBounded": False}


def _finite(v: object) -> bool:
    """A number a boost can be: not a bool (`True` is an int), not NaN or infinite (JSON's `Infinity`, `1e400`)."""
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) and abs(v) <= 1_000


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
        return json.loads(self.rfile.read(length) or b"{}")

    def do_GET(self) -> None:  # noqa: N802 - stdlib's casing
        if self.path == "/healthz":
            self._send(
                200,
                {"ok": True, "role": "bm25", "dir": os.path.abspath(BM25_DIR), **ORGS.health()},
            )
        elif self._authorized():
            self._send(404, {"error": "not found"})

    def _authorized(self) -> bool:
        """Every route but `/healthz` needs the bearer when one is set. Checked
        before the body is read, so an unauthenticated caller costs a header
        parse and never a JSON decode of whatever it chose to send."""
        if sidecar_auth.authorized(self.headers, SIDECAR_TOKEN):
            return True
        self._send(401, {"error": "unauthorized"})
        return False

    def do_POST(self) -> None:  # noqa: N802 - stdlib's casing
        if not self._authorized():
            return
        try:
            if self.path == "/index":
                req = self._body()
                docs = req.get("docs")
                if not isinstance(docs, list):
                    self._send(400, {"error": "docs must be a list"})
                    return
                for doc in docs:
                    if not isinstance(doc, dict) or not all(
                        k in doc for k in ("id", "org", "container", "occurredAt", "text")
                    ):
                        self._send(400, {"error": "each doc needs id, org, container, occurredAt, text"})
                        return
                refused = ORGS.refusal(docs)
                if refused:
                    # The engine says once to reindex: a document entry is never stored as a passage instead.
                    self._send(409, {"error": refused, **({"rebuild": True} if refused == "index_unreadable" else {})})
                    return
                commit = req.get("commit", True) is not False
                n = ORGS.index(docs, commit)
                self._send(200, {"indexed": n, "committed": commit, "boot": ORGS.boot})
            elif self.path == "/delete":
                req = self._body()
                ids = req.get("ids")
                if not isinstance(ids, list) or not all(isinstance(i, str) and i for i in ids):
                    self._send(400, {"error": "ids must be a list of non-empty strings"})
                    return
                self._send(200, {"deleted": ORGS.delete(ids)})
            elif self.path == "/delete_org":
                req = self._body()
                org = req.get("org")
                if not isinstance(org, str) or not org:
                    self._send(400, {"error": "org is required"})
                    return
                ORGS.delete_org(org)
                self._send(200, {"deleted": True})
            elif self.path == "/list":
                self._list(self._body())
            elif self.path == "/keys":
                # The key each text opens with, in the analyzer's own form (`analyzer.lead`): a caller compares keys
                # here, never in a second implementation of the step. No document is read.
                texts = self._body().get("texts")
                if not isinstance(texts, list) or not all(isinstance(t, str) for t in texts) or len(texts) > MAX_LIMIT + 1:
                    self._send(400, {"error": f"texts must be a list of at most {MAX_LIMIT + 1} strings"})
                    return
                self._send(200, {"leads": [analyzer.lead(t) for t in texts]})
            elif self.path == "/search":
                req = self._body()
                org = req.get("org")
                containers = req.get("containers")
                if not isinstance(org, str) or not org:
                    self._send(400, {"error": "org is required"})
                    return
                if not isinstance(containers, list):
                    self._send(400, {"error": "containers must be a list"})
                    return
                limit = req.get("limit", DEFAULT_LIMIT)
                if not isinstance(limit, int):
                    self._send(400, {"error": "limit must be an integer"})
                    return
                as_of = req.get("asOf")
                title_boost = req.get("titleBoost")
                if title_boost is not None and not isinstance(title_boost, (int, float)):
                    self._send(400, {"error": "titleBoost must be a number"})
                    return
                exact_boost = req.get("exactBoost")
                if exact_boost is not None and not _finite(exact_boost):
                    self._send(400, {"error": "exactBoost must be a finite number"})
                    return
                narrow = {k: req[k] for k in ("ids", "apps", "from", "to", "figures") if req.get(k) is not None}
                if any(k in narrow and not isinstance(narrow[k], list) for k in ("ids", "apps")):
                    self._send(400, {"error": "ids and apps must be lists"})
                    return
                titles = req.get("titles")
                need = titles.get("need") if isinstance(titles, dict) else None
                if titles is not None and (not isinstance(need, int) or isinstance(need, bool) or not 1 <= need <= 8):
                    self._send(400, {"error": "titles.need must be an integer from 1 to 8"})
                    return
                order = req.get("order", "relevance")
                if order not in ("relevance", "newest"):
                    self._send(400, {"error": "order must be relevance or newest"})
                    return
                if order == "newest" and req.get("strategy") == "last":
                    self._send(400, {"error": "order newest sorts the plain match; it takes no strategy"})
                    return
                if "figures" in narrow and not isinstance(narrow["figures"], bool):
                    self._send(400, {"error": "figures must be true or false"})
                    return
                store = ORGS.reading(org)
                if store is not None and store.unreadable:
                    self._send(409, {"error": "index_unreadable", "rebuild": True})
                    return
                last = req.get("strategy") == "last"
                if last and need is not None:
                    self._send(400, {"error": "titles asks the plain match; it takes no strategy"})
                    return
                if store is None:
                    # An org with no index holds nothing: the empty answer, and a read never makes an index.
                    self._send(200, NOTHING_LAST if last else {"hits": [], "tookMs": 0})
                    return
                boxes, query = [str(c) for c in containers], str(req.get("query") or "")
                try:
                    if last:
                        self._send(200, search_last(store, org, boxes, query, limit, as_of, narrow))
                        return
                    hits, took_ms = search(
                        store, org, boxes, query, limit, as_of, title_boost, narrow, exact_boost, order, need
                    )
                except FilterUnsupported as err:
                    self._send(409, {"error": "filter_unsupported", "field": str(err)})
                    return
                self._send(200, {"hits": hits, "tookMs": took_ms})
            else:
                self._send(404, {"error": "not found"})
        except Exception as err:  # noqa: BLE001
            # Never the text or the query: both are document text, and this is a log.
            self._send(500, {"error": type(err).__name__})

    def _list(self, req: dict) -> None:
        """`{org, containers, query?, order?, offset?, limit?, apps?, from?, to?, ids?, asOf?}` -> `{ids, total, facets}`
        (`listing`)."""
        org, containers = req.get("org"), req.get("containers")
        if not isinstance(org, str) or not org or not isinstance(containers, list):
            self._send(400, {"error": "org and containers are required"})
            return
        if req.get("apps") is not None and not isinstance(req.get("apps"), list):
            self._send(400, {"error": "apps must be a list"})
            return
        ids = req.get("ids")
        if ids is not None and (not isinstance(ids, list) or not all(isinstance(i, str) and i for i in ids)):
            self._send(400, {"error": "ids must be a list of non-empty strings"})
            return
        for key in ("from", "to"):
            if req.get(key) is not None and not _instant(req.get(key)):
                self._send(400, {"error": f"{key} must be an ISO instant"})
                return
        for key in ("offset", "limit"):
            if req.get(key) is not None and (not isinstance(req.get(key), int) or isinstance(req.get(key), bool)):
                self._send(400, {"error": f"{key} must be an integer"})
                return
        store = ORGS.reading(org)
        if store is not None and store.unreadable:
            self._send(409, {"error": "index_unreadable", "rebuild": True})
            return
        if store is None:
            self._send(200, NOTHING_LISTED)
            return
        try:
            self._send(200, listing(store, org, [str(c) for c in containers], req))
        except ListingUnsupported:
            self._send(409, {"error": "listing_unsupported"})

    def log_message(self, *_args) -> None:
        """Silent: bodies are document text."""


if __name__ == "__main__":
    print(
        f"louvain bm25 sidecar on :{PORT} (dir {os.path.abspath(BM25_DIR)}, "
        f"heap {BM25_HEAP_MB}MB, {ORGS.health()['docs']} docs, {sidecar_auth.describe(SIDECAR_TOKEN)})",
        flush=True,
    )
    serve(Handler, PORT)
