"""One workspace's keyword index on disk (`bm25_orgs.py`): opened with the newest schema it was built with, and its
one writer while a write is pending.

`open_store` returns every fact a read or a write depends on as one value, a `Store`: the schema and fields the index
holds, the query analyzers that match it and the settings the server read (`Knobs`). Nothing here reads the
environment; `bm25.py` does, once."""

import os
import threading
from dataclasses import dataclass, field
from datetime import datetime, timezone

import tantivy
from analyzer import runs, stream
from bm25_schema import (
    DOCUMENT, EXACT_TOKENIZER, OPTIONAL_FIELDS, STEM_TOKENIZER, UNFOLDED, _analyzer, _joined, _schema, _title,
)

MAX_TEXT_CHARS = 200_000
MAX_HEADER_CHARS = 400
MAX_APPS_PER_DOC = 16


@dataclass(frozen=True)
class Knobs:
    """The search settings the server reads (`bm25.py`, `LOUVAIN_BM25_*`)."""

    title_boost: float = 0.0
    header_boost: float = 0.5
    # Whether a search asks the compounds' joined spellings (`variants`) and a letters-and-digits word's parts (a phrase
    # on `text`). Off by default; the field is written either way.
    variants: bool = False
    # Whether a search reads the analyzer's forms (`terms`, `analyzer.py`). The field is written either way.
    analyzer: bool = False
    exact_boost: float = 0.0


@dataclass
class Store:
    """The open index and what it holds. `has` names each optional field the index was built with; `kind`, `folded`
    and `snippets` say whether it holds document entries, folded accents and stored text. `unreadable`: an index an
    earlier release built that no schema here opens, served empty and refused (`bm25.py`)."""

    schema: tantivy.Schema
    index: tantivy.Index
    has: dict[str, bool]
    kind: bool
    folded: bool
    snippets: bool
    unreadable: bool
    knobs: Knobs
    # The analyzers a query is asked with: the index's own, so an unfolded index is asked unfolded. `query` is the
    # query-time half of the stemmed analyzer, rebuilt: tantivy-py exposes no field's analyzer, and `term_query` expects
    # the indexed (stemmed, folded) form. Punctuation is gone before a query exists, so a question never trips a
    # query-language parser.
    exact: tantivy.TextAnalyzer
    query: tantivy.TextAnalyzer
    heap: int
    # Open only while a write is pending, from its first add to its commit: an idle writer holds its heap and a file,
    # about 4 MB an index against a quarter of one for the reader alone (200 indexes: 908 MB against 69 MB).
    writer: tantivy.IndexWriter | None = None
    lock: threading.Lock = field(default_factory=threading.Lock)

    @property
    def rebuild(self) -> bool:
        """Whether `/healthz` asks for a rebuild: an unreadable index, or one without a field this build writes."""
        return self.unreadable or not self.folded or not self.snippets or not all(self.has.values())


def _opened(path: str) -> tuple[tantivy.Schema, tantivy.Index, dict[str, bool]]:
    """The index with the newest schema it was built with: every field, then without the newest, and so on back to
    none. Adding a field never takes keyword search down: an older index runs without the newer fields until a reindex
    rebuilds it into an empty directory. `reuse=True` opens an existing index at this path if one is there (same schema
    required) and creates a fresh one otherwise, so a restart, a redeploy or `rebuild-bm25.ts` pointed at an
    already-populated volume all reopen without special-casing "does this exist yet"."""
    last: Exception | None = None
    for stored_text, folded in ((True, True), (False, True), (False, False)):
        for series in (False, True):
            for held in range(len(OPTIONAL_FIELDS), -1, -1):
                has = {f: i < held for i, f in enumerate(OPTIONAL_FIELDS)}
                if series and not has["listing"]:
                    continue
                schema = _schema(**has, series=series, folded=folded, stored_text=stored_text)
                try:
                    index = tantivy.Index(schema, path=path, reuse=True)
                except Exception as err:  # noqa: BLE001 - tantivy raises a bare ValueError on a schema mismatch
                    last = err
                    continue
                # An index an earlier build's listing made opens, and lists nothing until it is rebuilt.
                return schema, index, {
                    **has, "listing": has["listing"] and not series, "kind": has["listing"], "folded": folded,
                    "snippets": stored_text,
                }
    raise last if last else RuntimeError("bm25: no schema opened the index")


def _say_older(has: dict[str, bool], folded: bool, snippets: bool) -> None:
    """One line per thing an older index lacks, each asking for the rebuild."""
    if not snippets:
        print(
            "bm25: index predates stored text; hits carry no snippet until "
            "it is rebuilt from the event log into an empty LOUVAIN_BM25_DIR",
            flush=True,
        )
    if not folded:
        print(
            "bm25: index predates the accent fold; accented words are matched only as written until "
            "it is rebuilt from the event log into an empty LOUVAIN_BM25_DIR",
            flush=True,
        )
    for name, held in has.items():
        if not held:
            print(
                f"bm25: index predates the {name} field; it is off until "
                "it is rebuilt from the event log into an empty LOUVAIN_BM25_DIR",
                flush=True,
            )


def open_store(path: str, heap_mb: int, knobs: Knobs) -> Store:
    """The index at `path`, opened as it was built. An index on disk that no schema this sidecar knows opens is DERIVED
    (a rebuild replays the records), so the sidecar still starts: it serves an empty index in memory, answers every
    route but `/healthz` with 409 `index_unreadable`, which a client reads as the keyword index being down, and
    `/healthz` asks for the rebuild that `./engine up` then makes."""
    os.makedirs(path, exist_ok=True)
    unreadable = False
    try:
        schema, index, has = _opened(path)
        kind, folded, snippets = has.pop("kind"), has.pop("folded"), has.pop("snippets")
        _say_older(has, folded, snippets)
    except Exception as err:  # noqa: BLE001 - tantivy raises a bare ValueError on a schema mismatch
        if not os.path.exists(os.path.join(path, "meta.json")):
            raise SystemExit(
                f"bm25: cannot open the index at {os.path.abspath(path)} ({type(err).__name__}: {err})."
            ) from err
        # Left on disk untouched (the rebuild empties the directory); refused until it is rebuilt.
        unreadable = True
        print(
            f"bm25: cannot open the index at {os.path.abspath(path)}: an earlier release built it; "
            "it is refused until it is rebuilt from the records (./engine up does this)",
            flush=True,
        )
        schema = _schema()
        index = tantivy.Index(schema)
        has, kind, folded, snippets = {f: True for f in OPTIONAL_FIELDS}, True, True, True
    exact = _analyzer(stem=False, fold=folded)
    if folded:
        index.register_tokenizer(STEM_TOKENIZER, _analyzer(stem=True, fold=True))
        index.register_tokenizer(EXACT_TOKENIZER, exact)
    else:
        index.register_tokenizer(UNFOLDED[EXACT_TOKENIZER], exact)
    return Store(
        schema=schema, index=index, has=has, kind=kind, folded=folded, snippets=snippets, unreadable=unreadable,
        knobs=knobs, exact=exact, query=_analyzer(stem=True, fold=folded, cap=False),
        heap=heap_mb * 1024 * 1024,
    )


# The index is a function of what was written, never of thread timing. A replaced or withdrawn entry stays in the BM25
# statistics (document count, term frequencies, field lengths) until its segment is dropped or merged away, so the same
# live documents score differently with it and without it, and two close results trade places. Two races decided that:
# which indexing thread took a document (each thread writes a segment of its own, and a segment whose entries are all
# replaced is dropped whole, while one shared with a live entry keeps the copy), and whether a background merge had
# ended when the next search ran. So the writer indexes on ONE thread, which puts a batch in one segment, in order, and
# measured faster here (2,000 documents in batches of 50: 8 s against 45 s on the automatic count, whose every commit
# flushes a segment per thread); and every commit waits for the merges it started.
def _writing(ix: Store) -> tantivy.IndexWriter:
    """The index's writer, opened for the write at hand. Called under `ix.lock`."""
    if ix.writer is None:
        ix.writer = ix.index.writer(heap_size=ix.heap, num_threads=1)
    return ix.writer


def _commit(ix: Store) -> None:
    """Commit what the writer holds, let every merge the commit started finish, and reload; the writer is dropped,
    since tantivy's Python binding waits for its merging threads only by dropping it, and the next write opens one.
    Called under `ix.lock`. No writer: nothing pending, nothing to do."""
    if ix.writer is None:
        return
    ix.writer.commit()
    ix.writer.wait_merging_threads()
    ix.writer = None
    # Reads use the snapshot of the last reload, not the writer's view: reloaded here, a committed batch is visible to
    # `/search` and to `/healthz`'s count at once.
    ix.index.reload()


def _to_unix_seconds(iso: str) -> int:
    dt = datetime.fromisoformat(iso.replace("Z", "+00:00"))
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return int(dt.timestamp())


def _instant(v: object) -> bool:
    """An ISO instant `_to_unix_seconds` reads."""
    if not isinstance(v, str):
        return False
    try:
        _to_unix_seconds(v)
    except ValueError:
        return False
    return True


def num_docs(ix: Store) -> int:
    return ix.index.searcher().num_docs


def commit(ix: Store) -> None:
    """Commit the index's pending adds, if it has any (`bm25_orgs.py`, a group commit)."""
    with ix.lock:
        _commit(ix)


def index_docs(ix: Store, docs: list[dict], commit: bool) -> int:
    """Upsert semantics: delete whatever already carries this id, then add.

    The delete is a TERM delete on `id`'s raw field, so it matches exactly
    what was written and nothing tokenization could accidentally widen or
    narrow — the same reason `id` uses the raw tokenizer in the first place.
    Serialised by `ix.lock`: one writer, so a batch never races another
    batch's delete-then-add of the same id into an unpredictable order.
    """
    with ix.lock:
        writer = _writing(ix)
        for doc in docs:
            doc_id = str(doc["id"])
            document = ix.has["listing"] and doc.get("kind") == DOCUMENT
            writer.delete_documents_by_term("id", doc_id)
            d = tantivy.Document()
            d.add_text("id", doc_id)
            d.add_text("org", str(doc["org"]))
            d.add_text("container", str(doc["container"]))
            d.add_integer("occurred_at", _to_unix_seconds(str(doc["occurredAt"])))
            text = str(doc["text"])[:MAX_TEXT_CHARS]
            header = str(doc.get("header") or "")[:MAX_HEADER_CHARS]
            d.add_text("text", text)
            # The title the engine sends (a document's listing title, a slug like `note-05` included), else the first
            # line; its forms join the header's, so a key in a title is held as one in a header is.
            title = str(doc.get("title") or "")[:MAX_HEADER_CHARS]
            d.add_text("title", title or _title(text))
            if ix.has["header"]:
                d.add_text("header", str(doc.get("header") or "")[:MAX_HEADER_CHARS])
            if ix.has["variants"] and not document:
                d.add_text("variants", " ".join(_joined(text)))
            if ix.has["exact"] and not document:
                d.add_text("exact", text)
            if ix.has["terms"]:
                d.add_text("terms", " ".join(stream(text)))
            if ix.has["header_terms"]:
                d.add_text("header_terms", " ".join([*stream(header), *runs(header), *stream(title), *runs(title)]))
            if ix.has["runs"]:
                d.add_text("runs", " ".join(runs(text)))
            if ix.has["header_exact"] and not document:
                d.add_text("header_exact", str(doc.get("header") or "")[:MAX_HEADER_CHARS])
            if ix.has["figures"] and not document and doc.get("figures") is True:
                d.add_text("figures", "1")
            if ix.has["app"] and not document:
                for app in list(dict.fromkeys(str(a) for a in (doc.get("apps") or [])))[:MAX_APPS_PER_DOC]:
                    d.add_text("app", app)
            if document:
                d.add_text("kind", DOCUMENT)
                d.add_integer("modified", _to_unix_seconds(str(doc.get("modified") or doc["occurredAt"])))
                d.add_text("facet_app", str(doc.get("app") or ""))
                d.add_text("facet_container", str(doc["container"]))
            writer.add_document(d)
        if commit:
            _commit(ix)
    return len(docs)


def delete_docs(ix: Store, ids: list[str]) -> int:
    """Withdraw documents by id, with the same term delete on the raw `id` field an upsert begins with.

    Committed and reloaded at once, so the next `/search` cannot return an entry Postgres does not hold. Every hit is
    re-read under the fence anyway, so a missed delete costs a miss, never a leak; this keeps the index a mirror.
    """
    with ix.lock:
        writer = _writing(ix)
        for doc_id in ids:
            writer.delete_documents_by_term("id", str(doc_id))
        _commit(ix)
    return len(ids)


def close(ix: Store) -> None:
    """Drop the index's writer, if one is open, once its merges end, so its directory can go (`bm25_orgs.py`)."""
    with ix.lock:
        if ix.writer is not None:
            ix.writer.wait_merging_threads()
            ix.writer = None
