"""One keyword index per workspace (`bm25.py`): each org's entries live in an index of
their own, so no other workspace's documents move a reader's ranking or snippets. BM25's statistics (how many
entries hold a word, how long a field runs on average) are an index's whole content's; in one shared index, every
workspace's documents weighed in every other's search. Collections inside one workspace still share statistics; that
remainder is accepted.

An org's index is `<dir>/orgs/<digest of its id>`, never the id itself, which arrives in a request. A read never
makes one: an org with no index reads as empty. Two requests name no org: a delete by ids (`/delete`, the engine's
withdrawals) and a commit with no documents (the engine's group commit). So the sidecar keeps a directory of which
org each entry was written for (`entries.sqlite`), and a commit commits every index with adds pending. Entry ids are
unique across orgs (event ids, `doc:` and a document id), so the directory never sends a delete to another workspace.

An index from before this layout, one shared index at the root of `<dir>`, is never read: `/healthz` asks for the
rebuild (`./engine up` empties the directory and replays the records) while its files are there.
"""

import hashlib
import os
import shutil
import sqlite3
import threading
import uuid

from bm25_schema import DOCUMENT
from bm25_store import Knobs, Store, close, commit, delete_docs, index_docs, num_docs, open_store

ORGS = "orgs"
# Its own directory, so the root holds no plain file but an older layout's (the rollout).
DIRECTORY = os.path.join("entries", "entries.sqlite")


def dir_of(org: str) -> str:
    """An org's index directory: a digest of its id."""
    return hashlib.sha256(org.encode()).hexdigest()[:32]


class Orgs:
    """Every org's index under `root`, opened at start (a reader is cheap; a writer opens only while a write is
    pending, so an index with a writer is one with uncommitted adds), and the directory of entries."""

    def __init__(self, root: str, heap_mb: int, knobs: Knobs) -> None:
        self.root, self.heap_mb, self.knobs = root, heap_mb, knobs
        # Which process this is. An add sent with `commit: false` waits in this process's writer and dies with it; a
        # client that adds, then commits in a separate request, compares the boot id of the two answers, so a restart
        # between them is a retry and never a document marked indexed that the index lost.
        self.boot = uuid.uuid4().hex
        self.lock = threading.Lock()
        os.makedirs(os.path.join(root, ORGS), exist_ok=True)
        os.makedirs(os.path.dirname(os.path.join(root, DIRECTORY)), exist_ok=True)
        if self.legacy:
            print(
                f"bm25: {os.path.abspath(root)} holds one index shared by every workspace, from before an index per "
                "workspace; it is not read, and asks for a rebuild from the records (./engine up does this)",
                flush=True,
            )
        self.entries = sqlite3.connect(os.path.join(root, DIRECTORY), check_same_thread=False, isolation_level=None)
        # Derived like the indexes, so durable to the operating system, not the disk: a lost tail costs a delete that
        # misses, and a missed delete costs a stale entry the engine never reads (it re-reads every hit), never a leak.
        self.entries.execute("pragma journal_mode = wal")
        self.entries.execute("pragma synchronous = normal")
        self.entries.execute("create table if not exists entry (id text primary key, org text not null)")
        self.entries.execute("create index if not exists entry_org on entry (org)")
        self.entries_lock = threading.Lock()
        self.stores: dict[str, Store] = {
            name: open_store(os.path.join(root, ORGS, name), heap_mb, knobs)
            for name in sorted(os.listdir(os.path.join(root, ORGS)))
        }

    @property
    def legacy(self) -> bool:
        """Whether the shared index from before this layout is still there: asked each time, so removing its files
        stops `/healthz` asking for a rebuild without a restart."""
        return os.path.exists(os.path.join(self.root, "meta.json"))

    def reading(self, org: str) -> Store | None:
        """The org's index, or None where it has none: a read never makes one."""
        with self.lock:
            return self.stores.get(dir_of(org))

    def _writing(self, org: str) -> Store:
        with self.lock:
            name = dir_of(org)
            if name not in self.stores:
                self.stores[name] = open_store(os.path.join(self.root, ORGS, name), self.heap_mb, self.knobs)
            return self.stores[name]

    def refusal(self, docs: list[dict]) -> str | None:
        """Why a batch cannot be written, or None: an org's index an earlier release built that this one cannot open,
        or one from before the document entries, asked to hold one (never stored as a passage instead)."""
        for doc in docs:
            store = self.reading(str(doc["org"]))
            if store is not None and store.unreadable:
                return "index_unreadable"
            if store is not None and not store.has["listing"] and doc.get("kind") == DOCUMENT:
                return "listing_unsupported"
        return None

    def _orgs_of(self, ids: list[str]) -> dict[str, list[str]]:
        """The ids the directory holds, by the org each was last written for."""
        if not ids:
            return {}
        marks = ",".join("?" * len(ids))
        with self.entries_lock:
            found = self.entries.execute(f"select id, org from entry where id in ({marks})", ids).fetchall()
        by_org: dict[str, list[str]] = {}
        for entry_id, org in found:
            by_org.setdefault(org, []).append(entry_id)
        return by_org

    def index(self, docs: list[dict], to_commit: bool) -> int:
        """Each document into its org's index, its org in the directory first; with `to_commit`, every index with adds
        pending is committed, this batch's and any an earlier `commit: false` left. An id is one entry: one written
        before for another org leaves that org's index, as an upsert replaces it in its own.

        A committing batch commits each org's index before it opens the next one's writer, so it holds one writer at a
        time however many workspaces it spans. A writer's heap (`LOUVAIN_BM25_HEAP_MB`) is the process's largest
        allocation: a rebuild's batch walks `event_log` in id order across every workspace, and with every org's
        writer open until the end of the batch, two 256 MB writers took a 512 MB machine past its memory (OOM-killed
        at anon-rss 415 MB)."""
        by_org: dict[str, list[dict]] = {}
        for doc in docs:
            by_org.setdefault(str(doc["org"]), []).append(doc)
        orgs_of = {i: org for org, ids in self._orgs_of([str(d["id"]) for d in docs]).items() for i in ids}
        moved: dict[str, list[str]] = {}
        for doc in docs:
            before = orgs_of.get(str(doc["id"]))
            if before is not None and before != str(doc["org"]):
                moved.setdefault(before, []).append(str(doc["id"]))
        for org, ids in moved.items():
            store = self.reading(org)
            if store is not None:
                delete_docs(store, ids)
        for org, batch in by_org.items():
            with self.entries_lock, self.entries:
                self.entries.execute("begin")
                self.entries.executemany(
                    "insert into entry (id, org) values (?, ?) on conflict (id) do update set org = excluded.org",
                    [(str(d["id"]), org) for d in batch],
                )
            index_docs(self._writing(org), batch, to_commit)
        if to_commit:
            self.commit()
        return len(docs)

    def commit(self) -> None:
        """Commit every index with adds pending. One whose commit fails keeps its writer, so a retry commits it."""
        with self.lock:
            stores = list(self.stores.values())
        for store in stores:
            commit(store)

    def delete(self, ids: list[str]) -> int:
        """Withdraw entries by id, each from the index its org's directory row names; an id never written is a no-op."""
        for org, held in self._orgs_of(ids).items():
            store = self.reading(org)
            if store is not None:
                delete_docs(store, held)
        with self.entries_lock, self.entries:
            self.entries.execute("begin")
            self.entries.executemany("delete from entry where id = ?", [(i,) for i in ids])
        return len(ids)

    def delete_org(self, org: str) -> None:
        """Withdraw every entry of one org: its index's directory, and its rows in the directory of entries."""
        name = dir_of(org)
        with self.lock:
            store = self.stores.pop(name, None)
        if store is not None:
            close(store)
        shutil.rmtree(os.path.join(self.root, ORGS, name), ignore_errors=True)
        with self.entries_lock:
            self.entries.execute("delete from entry where org = ?", (org,))

    def health(self) -> dict:
        """What `/healthz` says, aggregate: no org's id or count, since it answers without the bearer."""
        with self.lock:
            stores = list(self.stores.values())
        return {
            "docs": sum(num_docs(s) for s in stores),
            "rebuild": self.legacy or any(s.rebuild for s in stores),
            "unreadable": any(s.unreadable for s in stores),
        }
