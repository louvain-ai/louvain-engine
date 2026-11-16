"""Smoke test for the BM25 sidecar.

Self-contained: stdlib only (subprocess, urllib, socket, tempfile), so it
runs with the same interpreter as `bm25.py` itself and needs nothing
installed beyond what `requirements.txt` already pins. Starts a real
server on a free port against a temporary index directory, drives it over
HTTP exactly as the engine's BM25 client (`kg/read/bm25.ts`) would, and tears it
down whatever happens.

    services/keyword-index/.venv/bin/python services/keyword-index/test_bm25.py

Every document, channel and name here is invented for this test.

Six documents across two orgs and three containers are indexed once, and
every assertion below is a claim `bm25.py`'s docstring makes about what the
fence and the ranking are supposed to do — this is what proves the claims
rather than the design.
"""

import json
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from bm25_orgs import dir_of  # noqa: E402

HOST = "127.0.0.1"


def org_dir(root: str, org: str = "o1") -> str:
    """Where the sidecar keeps one org's index under `root` (`bm25_orgs.py`), made, for a test that builds one first."""
    path = Path(root) / "orgs" / dir_of(org)
    path.mkdir(parents=True, exist_ok=True)
    return str(path)


def free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind((HOST, 0))
        return s.getsockname()[1]


def request(base: str, method: str, path: str, body: dict | None = None, token: str | None = None) -> dict:
    data = json.dumps(body).encode() if body is not None else None
    headers = {"content-type": "application/json"}
    if token is not None:
        headers["authorization"] = f"Bearer {token}"
    req = urllib.request.Request(f"{base}{path}", data=data, method=method, headers=headers)
    with urllib.request.urlopen(req, timeout=5) as resp:
        return json.loads(resp.read())


def wait_healthy(base: str, proc: subprocess.Popen, timeout_s: float = 15.0) -> None:
    deadline = time.monotonic() + timeout_s
    while time.monotonic() < deadline:
        if proc.poll() is not None:
            raise RuntimeError(f"bm25.py exited early with code {proc.returncode}")
        try:
            health = request(base, "GET", "/healthz")
            if health.get("ok") is True and health.get("role") == "bm25":
                return
        except (urllib.error.URLError, ConnectionRefusedError, OSError):
            pass
        time.sleep(0.1)
    raise RuntimeError("bm25 sidecar never became healthy")


DOCS = [
    {
        "id": "d1",
        "org": "org-alpha",
        "container": "cont-a",
        "occurredAt": "2024-01-01T00:00:00Z",
        "text": "The team discussed the quarterly budget and roadmap in the meeting",
    },
    {
        "id": "d2",
        "org": "org-alpha",
        "container": "cont-a",
        "occurredAt": "2024-01-02T00:00:00Z",
        "text": "Another meeting happened about the roadmap but this one covers the "
        "rare zylofoo protocol in depth, zylofoo, zylofoo",
    },
    {
        "id": "d3",
        "org": "org-alpha",
        "container": "cont-b",
        "occurredAt": "2024-01-03T00:00:00Z",
        "text": "A meeting in a different container also mentions meeting and roadmap topics",
    },
    {
        "id": "d4",
        "org": "org-beta",
        "container": "cont-a",
        "occurredAt": "2024-01-04T00:00:00Z",
        "text": "This meeting document belongs to a totally separate organisation entirely",
    },
    {
        "id": "d5",
        "org": "org-alpha",
        "container": "cont-c",
        "occurredAt": "2026-01-01T00:00:00Z",
        "text": "A future meeting scheduled well past the as-of cutoff for this test",
    },
    {
        "id": "d6",
        "org": "org-alpha",
        "container": "cont-a",
        "occurredAt": "2024-01-05T00:00:00Z",
        "text": "placeholder text before the upsert replaces it entirely",
    },
]


def check(label: str, cond: bool, detail: str = "") -> None:
    if not cond:
        raise AssertionError(f"FAILED: {label}{(' — ' + detail) if detail else ''}")
    print(f"ok: {label}")


def main() -> None:
    port = free_port()
    base = f"http://{HOST}:{port}"
    with tempfile.TemporaryDirectory(prefix="bm25-test-") as tmpdir:
        env = {
            "PORT": str(port),
            "LOUVAIN_BM25_DIR": tmpdir,
            "LOUVAIN_BM25_HEAP_MB": "64",
        }
        proc = subprocess.Popen(
            [sys.executable, str(Path(__file__).parent / "bm25.py")],
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
        )
        try:
            wait_healthy(base, proc)

            resp = request(base, "POST", "/index", {"docs": DOCS, "commit": True})
            check("index accepts the whole batch", resp["indexed"] == len(DOCS), str(resp))
            check("index commits when asked", resp["committed"] is True)
            boot = resp.get("boot")
            check("index says which process committed", isinstance(boot, str) and len(boot) > 0, str(resp))
            again = request(base, "POST", "/index", {"docs": [], "commit": True})
            check("an empty commit is the same process's", again.get("boot") == boot, str(again))

            health = request(base, "GET", "/healthz")
            check("healthz counts every doc", health["docs"] == len(DOCS), str(health))

            # (a) BM25 ranking: "zylofoo" appears in exactly one of the six
            # documents, so its IDF dominates the common term's (present in most of
            # them) — the one document containing both terms must outrank the
            # documents that only match the common one.
            r = request(
                base,
                "POST",
                "/search",
                {"org": "org-alpha", "containers": ["cont-a", "cont-b"], "query": "meeting zylofoo", "limit": 10},
            )
            ids = [h["id"] for h in r["hits"]]
            check("rare-term document is returned", "d2" in ids, str(r))
            check("rare-term document ranks first", ids[0] == "d2", str(ids))
            check("common-term documents still rank, lower", set(ids) >= {"d1", "d2", "d3"}, str(ids))

            # (b) Fence: containers=[cont-a] must never surface d3 (cont-b),
            # and org=org-alpha must never surface d4 (org-beta) even though
            # d4 sits in a container literally named "cont-a" — the fence is
            # org AND container, not either alone.
            r = request(
                base, "POST", "/search", {"org": "org-alpha", "containers": ["cont-a"], "query": "meeting", "limit": 10}
            )
            ids = {h["id"] for h in r["hits"]}
            check("container fence excludes another container", "d3" not in ids, str(ids))
            check("org fence excludes another org's same-named container", "d4" not in ids, str(ids))
            check("fenced search still returns the readable matches", {"d1", "d2"} <= ids, str(ids))

            # (c) asOf: d5 is dated 2026, after the cutoff, and must not
            # appear even though it is in-org, in-container-set and matches.
            r = request(
                base,
                "POST",
                "/search",
                {
                    "org": "org-alpha",
                    "containers": ["cont-a", "cont-b", "cont-c"],
                    "query": "meeting",
                    "limit": 10,
                    "asOf": "2025-01-01T00:00:00Z",
                },
            )
            ids = {h["id"] for h in r["hits"]}
            check("asOf excludes a later-dated document", "d5" not in ids, str(ids))
            check("asOf keeps earlier documents", {"d1", "d2", "d3"} <= ids, str(ids))

            # (e) Title boost (BM25F): d7's FIRST LINE says "quorbit", d8 says
            # it in its body only. Unboosted the body mention wins (it says it
            # twice); with `titleBoost` the titled document ranks first — and a
            # boost of 0 must leave the order exactly as before.
            titled = [
                {
                    "id": "d7",
                    "org": "org-alpha",
                    "container": "cont-a",
                    "occurredAt": "2024-01-06T00:00:00Z",
                    "text": "Quorbit rollout summary\n\nA short note about the meeting cadence and roadmap.",
                },
                {
                    "id": "d8",
                    "org": "org-alpha",
                    "container": "cont-a",
                    "occurredAt": "2024-01-07T00:00:00Z",
                    "text": "Meeting notes\n\nWe discussed quorbit at length, quorbit being the new protocol.",
                },
            ]
            request(base, "POST", "/index", {"docs": titled, "commit": True})
            plain = request(
                base, "POST", "/search", {"org": "org-alpha", "containers": ["cont-a"], "query": "quorbit", "limit": 5}
            )
            zero = request(
                base,
                "POST",
                "/search",
                {"org": "org-alpha", "containers": ["cont-a"], "query": "quorbit", "limit": 5, "titleBoost": 0},
            )
            boosted = request(
                base,
                "POST",
                "/search",
                {"org": "org-alpha", "containers": ["cont-a"], "query": "quorbit", "limit": 5, "titleBoost": 3},
            )
            plain_ids = [h["id"] for h in plain["hits"]]
            check("without a title boost the body-heavy document ranks first", plain_ids[0] == "d8", str(plain_ids))
            check("titleBoost 0 changes nothing", [h["id"] for h in zero["hits"]] == plain_ids, str(zero))
            check("titleBoost ranks the titled document first", [h["id"] for h in boosted["hits"]][0] == "d7", str(boosted))
            check("titleBoost keeps the body match as a candidate", "d8" in {h["id"] for h in boosted["hits"]}, str(boosted))
            for d in titled:
                request(base, "POST", "/index", {"docs": [dict(d, org="org-gone")], "commit": True})

            # (c2) The HEADER field: a word only the record's header carries (its channel, its ticket key) finds it,
            # boosted modestly by default; a document with no header is still found on its body.
            headed = [
                {
                    "id": "h1",
                    "org": "org-alpha",
                    "container": "cont-a",
                    "occurredAt": "2024-02-01T00:00:00Z",
                    "text": "we agreed to ship the fix on thursday",
                    "header": "#larchwick-co · Odile (+2 others) · 2024-02-01",
                },
                {
                    "id": "h2",
                    "org": "org-alpha",
                    "container": "cont-a",
                    "occurredAt": "2024-02-02T00:00:00Z",
                    "text": "larchwick came up once in passing, among many other words about other things entirely",
                },
            ]
            request(base, "POST", "/index", {"docs": headed, "commit": True})
            found = request(
                base, "POST", "/search", {"org": "org-alpha", "containers": ["cont-a"], "query": "larchwick", "limit": 5}
            )
            ids = [h["id"] for h in found["hits"]]
            check("a word only in the header finds the record", "h1" in ids, str(found))
            check("a record without a header is still found on its body", "h2" in ids, str(found))
            for d in headed:
                request(base, "POST", "/index", {"docs": [dict(d, org="org-gone")], "commit": True})

            # (d) Upsert: re-index d6 under the same id with new text and
            # confirm the OLD text is gone, not merely joined by the new.
            r = request(
                base, "POST", "/search", {"org": "org-alpha", "containers": ["cont-a"], "query": "placeholder"}
            )
            check("pre-upsert text is findable", any(h["id"] == "d6" for h in r["hits"]), str(r))

            upsert_doc = dict(DOCS[5], text="This replaced meeting text now contains the marker keyword florbex")
            resp = request(base, "POST", "/index", {"docs": [upsert_doc], "commit": True})
            check("upsert reports one document indexed", resp["indexed"] == 1, str(resp))

            health = request(base, "GET", "/healthz")
            # The titled documents from (c) and the headed ones from (c2) are still in the index, under another org.
            check(
                "upsert does not duplicate the document",
                health["docs"] == len(DOCS) + len(titled) + len(headed),
                str(health),
            )

            r = request(
                base, "POST", "/search", {"org": "org-alpha", "containers": ["cont-a"], "query": "placeholder"}
            )
            check("upsert removes the old text", r["hits"] == [], str(r))

            r = request(base, "POST", "/search", {"org": "org-alpha", "containers": ["cont-a"], "query": "florbex"})
            ids = [h["id"] for h in r["hits"]]
            check("upsert's new text is findable", ids == ["d6"], str(r))

            # (d2) Delete: a withdrawn document leaves the ranked set AND the
            # count, and the same id can be indexed again afterwards (a
            # re-read of a once-quarantined event).
            resp = request(base, "POST", "/delete", {"ids": ["d6"]})
            check("delete reports the ids it removed", resp["deleted"] == 1, str(resp))
            r = request(base, "POST", "/search", {"org": "org-alpha", "containers": ["cont-a"], "query": "florbex"})
            check("a deleted document is not returned", r["hits"] == [], str(r))
            health = request(base, "GET", "/healthz")
            check("delete lowers the document count", health["docs"] == len(DOCS) + len(titled) + len(headed) - 1, str(health))
            try:
                request(base, "POST", "/delete", {"ids": ["d6", 7]})
                check("delete refuses a non-string id", False, "no error")
            except urllib.error.HTTPError as err:
                check("delete refuses a non-string id", err.code == 400, str(err.code))
            request(base, "POST", "/index", {"docs": [upsert_doc], "commit": True})
            r = request(base, "POST", "/search", {"org": "org-alpha", "containers": ["cont-a"], "query": "florbex"})
            check("a deleted id can be indexed again", [h["id"] for h in r["hits"]] == ["d6"], str(r))

            # (e) Empty containers is fail-closed, not "search everything".
            r = request(
                base, "POST", "/search", {"org": "org-alpha", "containers": [], "query": "meeting", "limit": 10}
            )
            check("empty containers returns no hits", r["hits"] == [], str(r))

            # Empty query is the other declared no-op.
            r = request(
                base, "POST", "/search", {"org": "org-alpha", "containers": ["cont-a"], "query": "", "limit": 10}
            )
            check("empty query returns no hits", r["hits"] == [], str(r))

            print("all bm25 checks passed")
        finally:
            stop(proc)


def stop(proc: subprocess.Popen) -> None:
    proc.terminate()
    try:
        proc.wait(timeout=5)
    except subprocess.TimeoutExpired:
        proc.kill()
        proc.wait(timeout=5)


def status_of(base: str, method: str, path: str, body: dict | None = None, token: str | None = None) -> int:
    try:
        request(base, method, path, body, token)
        return 200
    except urllib.error.HTTPError as err:
        return err.code


def auth_checks() -> None:
    """With `LOUVAIN_SIDECAR_TOKEN` set, every route but `/healthz` needs it.

    The unauthenticated `/search` below names an org and containers exactly as
    a real caller would: that is the request a compromised runner on the same
    private network would send, and it must not return an id.
    """
    token = "test-sidecar-token-0123456789abcdef"
    port = free_port()
    base = f"http://{HOST}:{port}"
    with tempfile.TemporaryDirectory(prefix="bm25-auth-test-") as tmpdir:
        env = {
            "PORT": str(port),
            "LOUVAIN_BM25_DIR": tmpdir,
            "LOUVAIN_BM25_HEAP_MB": "64",
            "LOUVAIN_SIDECAR_TOKEN": token,
        }
        proc = subprocess.Popen(
            [sys.executable, str(Path(__file__).parent / "bm25.py")],
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
        )
        try:
            wait_healthy(base, proc)
            check("healthz stays open with a token set", True)
            search = {"org": "org-alpha", "containers": ["cont-a"], "query": "meeting", "limit": 10}
            check("index without the bearer is 401", status_of(base, "POST", "/index", {"docs": DOCS}) == 401)
            check("search without the bearer is 401", status_of(base, "POST", "/search", search) == 401)
            check("delete without the bearer is 401", status_of(base, "POST", "/delete", {"ids": ["d1"]}) == 401)
            check(
                "a wrong bearer is 401",
                status_of(base, "POST", "/search", search, token="not-the-token") == 401,
            )
            check("an unknown route without the bearer is 401, not 404", status_of(base, "GET", "/nope") == 401)
            resp = request(base, "POST", "/index", {"docs": DOCS, "commit": True}, token=token)
            check("index with the bearer is accepted", resp["indexed"] == len(DOCS), str(resp))
            r = request(base, "POST", "/search", search, token=token)
            check("search with the bearer ranks", len(r["hits"]) > 0, str(r))
            health = request(base, "GET", "/healthz")
            check("healthz reports the indexed count unauthenticated", health["docs"] == len(DOCS), str(health))
            print("all bm25 auth checks passed")
        finally:
            stop(proc)
            boot = (proc.stdout.read() if proc.stdout else b"").decode()
            check("the boot line says auth is on", "auth: bearer" in boot, boot)
            check("the boot line never prints the token", token not in boot, boot)


if __name__ == "__main__":
    try:
        main()
        auth_checks()
    except Exception as err:  # noqa: BLE001 - top-level: report and fail the run
        print(f"{type(err).__name__}: {err}", file=sys.stderr)
        sys.exit(1)
