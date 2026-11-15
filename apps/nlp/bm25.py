"""The BM25 keyword sidecar: a Tantivy index at the document grain, for the keyword leg of a search.

`ts_rank` scores every row matching any term before it sorts, so its cost grows with the matches; Tantivy keeps postings
sorted for top-k and answers in milliseconds. The fence is inside the query (`_fence`), never a post-filter, and the
engine re-reads every hit under its own fence. The index stores the ids and each record's text, so a hit carries a
snippet of it; what a citation quotes is still Postgres's. One writer behind
a lock; searches read the last reloaded snapshot concurrently. It never logs a document's text or a query.
"""

import json
import math
import os
import re
import socket
import threading
import time
import uuid
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import sidecar_auth
import tantivy
import analyzer
from analyzer import _DELIMITER, _tokens, delimited, keys, outside, runs, stream


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
MAX_TEXT_CHARS = 200_000
MAX_LIMIT = 200
DEFAULT_LIMIT = 20


# THE ANALYZERS, each with its accents folded (tantivy's `ascii_fold`, Lucene's ASCIIFoldingFilter): "Zoë" is held and
# asked as `zoe`, however a person types it. The stemmed one is `en_stem` with the fold before its stemmer; the unstemmed
# one is its split, its 40-character cap (a hash or a token run is not a word, and near-unique ones bloat the term
# dictionary) and its lower-casing, with no stemmer. An index built before the fold names tantivy's own `en_stem` and
# the unfolded `en_exact` (`folded=False`): it opens, is asked as it was built, and asks for a rebuild (`_open`).
STEM_TOKENIZER = "en_stem_folded"
EXACT_TOKENIZER = "en_exact_folded"
UNFOLDED = {STEM_TOKENIZER: "en_stem", EXACT_TOKENIZER: "en_exact"}


def _analyzer(*, stem: bool, fold: bool, cap: bool = True) -> tantivy.TextAnalyzer:
    built = tantivy.TextAnalyzerBuilder(tantivy.Tokenizer.simple())
    if cap:
        built = built.filter(tantivy.Filter.remove_long(40))
    built = built.filter(tantivy.Filter.lowercase())
    if fold:
        built = built.filter(tantivy.Filter.ascii_fold())
    if stem:
        built = built.filter(tantivy.Filter.stemmer("English"))
    return built.build()


def _schema(
    header: bool = True,
    variants: bool = True,
    app: bool = True,
    exact: bool = True,
    terms: bool = True,
    header_terms: bool = True,
    runs: bool = True,
    header_exact: bool = True,
    listing: bool = True,
    figures: bool = True,
    series: bool = False,
    folded: bool = True,
    stored_text: bool = True,
) -> tantivy.Schema:
    # `id`, `org` and `container` are exact strings (the raw tokenizer): a fence on a tokenizer that folds or splits is not
    # a fence. `occurred_at` is Unix seconds in a fast field, so `asOf` is a column scan. `text` is stemmed as the
    # database's English search is.
    stem, exact_tokenizer = (
        (STEM_TOKENIZER, EXACT_TOKENIZER) if folded else (UNFOLDED[STEM_TOKENIZER], UNFOLDED[EXACT_TOKENIZER])
    )
    sb = tantivy.SchemaBuilder()
    sb.add_text_field("id", stored=True, tokenizer_name="raw", index_option="basic")
    sb.add_text_field("org", stored=False, tokenizer_name="raw", index_option="basic")
    sb.add_text_field("container", stored=False, tokenizer_name="raw", index_option="basic")
    sb.add_integer_field("occurred_at", stored=False, indexed=True, fast=True)
    # STORED, so a hit carries a snippet of its own text (`_snippet`): an index built before it holds none and asks for
    # a rebuild. The text a citation quotes is still Postgres's; the snippet only says where the words fell.
    sb.add_text_field("text", stored=stored_text, tokenizer_name=stem, index_option="position")
    # The document's first line (a summary, a subject, a heading) scored as its own field (BM25F), so a term found there
    # can weigh above the same term in the body: a title is the author's one-line paraphrase of the document. Weighed at
    # `LOUVAIN_BM25_TITLE_BOOST`, 0 by default.
    sb.add_text_field("title", stored=False, tokenizer_name=stem, index_option="position")
    if header:
        # The record's header (`memory/passage-context.ts` `recordHeader`): a chat's channel and author, a mail's
        # subject and route, a ticket's key and status, a document's title — what situates the record, built from
        # its own presentation and listing row. Its own field, scored at `LOUVAIN_BM25_HEADER_BOOST` (0.5 by
        # default): a query that names the thing finds it, and a header word never outweighs the body's own.
        sb.add_text_field("header", stored=False, tokenizer_name=stem, index_option="position")
    if variants:
        # The joined spellings of the document's compounds (`_joined`): "seat-hours" as `seathours`, "SOC 2" as
        # `soc2`. `Tokenizer.simple()` splits on every non-alphanumeric, so the text field holds a compound only as its
        # parts, two common words, and a search for the rare compound weighs it as those. Asked only under
        # `LOUVAIN_BM25_VARIANTS=on` (`search`); written always, so turning it on needs no second rebuild.
        sb.add_text_field("variants", stored=False, tokenizer_name=stem, index_option="basic")
    if app:
        # Every app a search may name this record by, raw like `org`, one term each: the set the passage legs' app filter
        # matches, computed by the engine (`kg/read/bm25.ts` `appsOf`). A filtered search then ranks with the filter
        # inside the query, not paging after it. A narrowing, never the fence: the engine re-states every filter in SQL.
        sb.add_text_field("app", stored=False, tokenizer_name="raw", index_option="basic")
    if exact:
        # The same text unstemmed (`en_exact`: split and lower-cased, no stemmer), frequencies, no positions. The
        # stemmer folds a rare surface form into a common stem — a company called "Shipping" into `ship`,
        # "vectorization" into `vector` — and a word that named the document stops weighing anything.
        # Scored beside `text` at `LOUVAIN_BM25_EXACT_BOOST` (0, off by default): a surface form found here
        # only ever adds to what the stemmed field already matched.
        sb.add_text_field("exact", stored=False, tokenizer_name=exact_tokenizer, index_option="freq")
    if terms:
        # The word-delimiter step's forms (`analyzer.py`, the database's `search_delimited`): a delimited or mixed
        # token's parts and catenation, so "SUP-1042" holds `sup1042` and "2,400" holds `2400`. Asked only under
        # `LOUVAIN_BM25_ANALYZER=on`; written always, so turning it on needs no second rebuild.
        sb.add_text_field("terms", stored=False, tokenizer_name=exact_tokenizer, index_option="position")
    if header_terms:
        # The same step's forms for the header, so a key in a document's title weighs as the header does however the
        # search spells it ("fs4471" finds "datasheet-FS-4471-revA" there as "FS-4471" does). Asked with `terms`.
        sb.add_text_field("header_terms", stored=False, tokenizer_name=exact_tokenizer, index_option="position")
    if runs:
        # The runs of parts inside a document's keys (`analyzer.py` `runs`: "notes5" in
        # "field-service-scheduling-notes-5"), apart from `terms` as a shingle sub-field is, so they never lengthen the
        # field the document's own forms are scored in. Asked with `terms`.
        sb.add_text_field("runs", stored=False, tokenizer_name=exact_tokenizer, index_option="freq")
    if header_exact:
        # The HEADER's words unstemmed, as `exact` holds the body's: a word a document holds only in its title is held
        # (a typo and the last word's prefix are asked of it), since a person reads the title.
        sb.add_text_field("header_exact", stored=False, tokenizer_name=exact_tokenizer, index_option="freq")
    if listing:
        # A DOCUMENT ENTRY beside the passages: one per document, so the listing's page, total and facets are counted
        # in documents, inside the fence, by the index itself. `kind` keeps the two apart (none is a passage). An entry
        # holds only what `/list` matches, its title and text in the English and analyzer fields: never the `exact`,
        # `header_exact` and `variants` fields a typo or a prefix is asked of, nor the passages' `app`. `modified` is its date
        # order; its facets are its app and its container (`facet_container`, the fence's own value as a column).
        sb.add_text_field("kind", stored=False, tokenizer_name="raw", index_option="basic")
        if series:
            # The listing fields an earlier build wrote (a series flag and a connection id): read by nothing, kept only
            # so an index it built still opens, without the listing, until it is rebuilt.
            sb.add_integer_field("lead", stored=False, indexed=True, fast=True)
        sb.add_integer_field("modified", stored=False, indexed=True, fast=True)
        sb.add_text_field("facet_app", stored=False, tokenizer_name="raw", index_option="basic", fast=True)
        if series:
            sb.add_text_field("connection", stored=False, tokenizer_name="raw", index_option="basic", fast=True)
        else:
            sb.add_text_field("facet_container", stored=False, tokenizer_name="raw", index_option="basic", fast=True)
    if figures:
        # Whether the record STATES A FIGURE (any digit in its text, the passage legs' `digits` rule), sent by the
        # engine (`keywordDoc`), one raw term when it does: a search for figures narrows to it as a must clause beside
        # the fence, as `ids` and `apps` do. A narrowing, never the fence: the engine re-reads every hit's passage.
        sb.add_text_field("figures", stored=False, tokenizer_name="raw", index_option="basic")
    return sb.build()


_WORD = re.compile(r"[a-z0-9]+(?:-[a-z0-9]+)*")
MAX_VARIANT_PARTS = 8
MAX_VARIANTS_PER_DOC = 2_000


def _joined(text: str) -> list[str]:
    """The joined spellings of a text's compounds, first seen first: a hyphenated word with its hyphens removed, and a
    word of two to five letters followed by a word of digits ("soc 2" -> "soc2", an acronym and its number). A rule of
    shape, never a unit or abbreviation list. Body text only: a compound only in the header has no joined form."""
    words = _WORD.findall(text.lower())
    out: dict[str, None] = {}
    for i, w in enumerate(words):
        if "-" in w and len(w.split("-")) <= MAX_VARIANT_PARTS:
            out[w.replace("-", "")] = None
        nxt = words[i + 1] if i + 1 < len(words) else None
        if re.fullmatch(r"[a-z]{2,5}", w) and nxt is not None and nxt.isdigit():
            out[w + nxt] = None
        if len(out) >= MAX_VARIANTS_PER_DOC:
            break
    return list(out)


def _split(query: str) -> list[list[str]]:
    """A query word of letters and digits as its parts ("soc2" -> soc, 2), where every run of letters is two or more (a
    one-letter run is a stopword or a unit: "s3", "a100", "48h" are not split), so a document that wrote it spaced is
    found by the phrase."""
    out: list[list[str]] = []
    for w in _WORD.findall(query.lower()):
        if "-" in w:
            continue
        parts = re.findall(r"[a-z]+|[0-9]+", w)
        if 1 < len(parts) <= MAX_VARIANT_PARTS and all(len(p) >= 2 for p in parts if p[0].isalpha()):
            out.append(parts)
    return out


def _title(text: str) -> str:
    """The first non-empty line, cut short: a heading, a subject, a summary."""
    for line in text.split("\n"):
        line = line.strip()
        if line:
            return line[:200]
    return ""


SCHEMA = _schema()

os.makedirs(BM25_DIR, exist_ok=True)
# `reuse=True` opens an existing index at this path if one is there (same
# schema required) and creates a fresh one otherwise — the same directory a
# restart, a redeploy or `rebuild-bm25.ts` pointed at an already-populated
# volume all reopen without special-casing "does this exist yet".
HAS_HEADER = True
HAS_VARIANTS = True
HAS_APP = True
HAS_EXACT = True
HAS_TERMS = True
HAS_HEADER_TERMS = True
HAS_RUNS = True
HAS_HEADER_EXACT = True
HAS_LISTING = True
HAS_SNIPPETS = True
HAS_FIGURES = True
HAS_KIND = True
FOLDED = True
# An index on disk that no schema this sidecar knows opens: it is DERIVED (a rebuild replays the records), so the
# sidecar still starts, answers every route but `/healthz` with 409 `index_unreadable`, which a client reads as the
# keyword index being down, and `/healthz` asks for the rebuild that `./engine up` then makes.
UNREADABLE = False
# The optional fields, oldest first: an index built by an older sidecar holds a prefix of them.
OPTIONAL_FIELDS = (
    "header", "variants", "app", "exact", "terms", "header_terms", "runs", "header_exact", "listing", "figures",
)


def _open() -> tuple[tantivy.Schema, tantivy.Index, dict[str, bool]]:
    """The index with the newest schema it was built with: every field, then without the newest, and so on back to
    none. Adding a field never takes keyword search down: an older index runs without the newer fields until a reindex
    rebuilds it into an empty directory."""
    last: Exception | None = None
    for stored_text, folded in ((True, True), (False, True), (False, False)):
        for series in (False, True):
            for held in range(len(OPTIONAL_FIELDS), -1, -1):
                has = {f: i < held for i, f in enumerate(OPTIONAL_FIELDS)}
                if series and not has["listing"]:
                    continue
                schema = _schema(**has, series=series, folded=folded, stored_text=stored_text)
                try:
                    index = tantivy.Index(schema, path=BM25_DIR, reuse=True)
                except Exception as err:  # noqa: BLE001 - tantivy raises a bare ValueError on a schema mismatch
                    last = err
                    continue
                # An index an earlier build's listing made opens, and lists nothing until it is rebuilt.
                return schema, index, {
                    **has, "listing": has["listing"] and not series, "kind": has["listing"], "folded": folded,
                    "snippets": stored_text,
                }
    raise last if last else RuntimeError("bm25: no schema opened the index")


try:
    SCHEMA, INDEX, _HAS = _open()
    (
        HAS_HEADER, HAS_VARIANTS, HAS_APP, HAS_EXACT, HAS_TERMS, HAS_HEADER_TERMS, HAS_RUNS, HAS_HEADER_EXACT,
        HAS_LISTING, HAS_FIGURES,
    ) = (
        _HAS[f] for f in OPTIONAL_FIELDS
    )
    HAS_KIND = _HAS.pop("kind")
    FOLDED = _HAS.pop("folded")
    HAS_SNIPPETS = _HAS.pop("snippets")
    if not HAS_SNIPPETS:
        print(
            "bm25: index predates stored text; hits carry no snippet until "
            "it is rebuilt from the event log into an empty LOUVAIN_BM25_DIR",
            flush=True,
        )
    # The query's analyzers are the index's own: an unfolded index is asked unfolded, so it still finds what it holds.
    _EXACT_ANALYZER = _analyzer(stem=False, fold=FOLDED)
    if FOLDED:
        INDEX.register_tokenizer(STEM_TOKENIZER, _analyzer(stem=True, fold=True))
        INDEX.register_tokenizer(EXACT_TOKENIZER, _EXACT_ANALYZER)
    else:
        INDEX.register_tokenizer(UNFOLDED[EXACT_TOKENIZER], _EXACT_ANALYZER)
        print(
            "bm25: index predates the accent fold; accented words are matched only as written until "
            "it is rebuilt from the event log into an empty LOUVAIN_BM25_DIR",
            flush=True,
        )
    for field, has in _HAS.items():
        if not has:
            print(
                f"bm25: index predates the {field} field; it is off until "
                "it is rebuilt from the event log into an empty LOUVAIN_BM25_DIR",
                flush=True,
            )
except Exception as err:  # noqa: BLE001 - tantivy raises a bare ValueError on a schema mismatch
    if not os.path.exists(os.path.join(BM25_DIR, "meta.json")):
        raise SystemExit(
            f"bm25: cannot open the index at {os.path.abspath(BM25_DIR)} ({type(err).__name__}: {err})."
        ) from err
    # An index an earlier sidecar built with a schema this one does not know. Left on disk untouched (the rebuild
    # empties the directory); this process serves an empty index in memory and refuses every read and write of it.
    UNREADABLE = True
    print(
        f"bm25: cannot open the index at {os.path.abspath(BM25_DIR)}: an earlier release built it; "
        "it is refused until it is rebuilt from the records (./engine up does this)",
        flush=True,
    )
    SCHEMA = _schema()
    INDEX = tantivy.Index(SCHEMA)
    _HAS = {f: True for f in OPTIONAL_FIELDS}
    _EXACT_ANALYZER = _analyzer(stem=False, fold=True)
    INDEX.register_tokenizer(STEM_TOKENIZER, _analyzer(stem=True, fold=True))
    INDEX.register_tokenizer(EXACT_TOKENIZER, _EXACT_ANALYZER)

TITLE_BOOST = float(setting("BM25_TITLE_BOOST", "0"))
HEADER_BOOST = float(setting("BM25_HEADER_BOOST", "0.5"))
# Whether a search asks the compounds' joined spellings (`variants`) and a letters-and-digits word's parts (a phrase on
# `text`). Off by default; the field is written either way.
VARIANTS_ON = setting("BM25_VARIANTS", "off").strip().lower() == "on"
# Whether a search reads the analyzer's forms (`terms`, `analyzer.py`). The field is written either way.
ANALYZER_ON = setting("BM25_ANALYZER", "off").strip().lower() == "on"
EXACT_BOOST = float(setting("BM25_EXACT_BOOST", "0"))
MAX_HEADER_CHARS = 400
MAX_APPS_PER_DOC = 16

# Which process the writer is. An add sent with `commit: false` waits in this process's writer and dies with it; a
# client that adds, then commits in a separate request, compares the boot id of the two answers, so a restart between
# them is a retry and never a document marked indexed that the index lost.
BOOT_ID = uuid.uuid4().hex

_writer_lock = threading.Lock()
_writer = INDEX.writer(heap_size=BM25_HEAP_MB * 1024 * 1024)

# The query-time half of the stemmed analyzer, rebuilt: tantivy-py exposes no field's analyzer, and `term_query` expects
# the indexed (stemmed, folded) form. Punctuation is gone before a query exists, so a question never trips a
# query-language parser.
_QUERY_ANALYZER = _analyzer(stem=True, fold=FOLDED, cap=False)


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


def _num_docs() -> int:
    return INDEX.searcher().num_docs


def index_docs(docs: list[dict], commit: bool) -> int:
    """Upsert semantics: delete whatever already carries this id, then add.

    The delete is a TERM delete on `id`'s raw field, so it matches exactly
    what was written and nothing tokenization could accidentally widen or
    narrow — the same reason `id` uses the raw tokenizer in the first place.
    Serialised by `_writer_lock`: one writer, so a batch never races another
    batch's delete-then-add of the same id into an unpredictable order.
    """
    with _writer_lock:
        for doc in docs:
            doc_id = str(doc["id"])
            document = HAS_LISTING and doc.get("kind") == DOCUMENT
            _writer.delete_documents_by_term("id", doc_id)
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
            if HAS_HEADER:
                d.add_text("header", str(doc.get("header") or "")[:MAX_HEADER_CHARS])
            if HAS_VARIANTS and not document:
                d.add_text("variants", " ".join(_joined(text)))
            if HAS_EXACT and not document:
                d.add_text("exact", text)
            if HAS_TERMS:
                d.add_text("terms", " ".join(stream(text)))
            if HAS_HEADER_TERMS:
                d.add_text("header_terms", " ".join([*stream(header), *runs(header), *stream(title), *runs(title)]))
            if HAS_RUNS:
                d.add_text("runs", " ".join(runs(text)))
            if HAS_HEADER_EXACT and not document:
                d.add_text("header_exact", str(doc.get("header") or "")[:MAX_HEADER_CHARS])
            if HAS_FIGURES and not document and doc.get("figures") is True:
                d.add_text("figures", "1")
            if HAS_APP and not document:
                for app in list(dict.fromkeys(str(a) for a in (doc.get("apps") or [])))[:MAX_APPS_PER_DOC]:
                    d.add_text("app", app)
            if document:
                d.add_text("kind", DOCUMENT)
                d.add_integer("modified", _to_unix_seconds(str(doc.get("modified") or doc["occurredAt"])))
                d.add_text("facet_app", str(doc.get("app") or ""))
                d.add_text("facet_container", str(doc["container"]))
            _writer.add_document(d)
        if commit:
            _writer.commit()
            # Reads use the snapshot of the last reload, not the writer's view: reloaded here, a committed batch is
            # visible to `/search` and to `/healthz`'s count at once.
            INDEX.reload()
    return len(docs)


def delete_docs(ids: list[str]) -> int:
    """Withdraw documents by id, with the same term delete on the raw `id` field an upsert begins with.

    Committed and reloaded at once, so the next `/search` cannot return an entry Postgres does not hold. Every hit is
    re-read under the fence anyway, so a missed delete costs a miss, never a leak; this keeps the index a mirror.
    """
    with _writer_lock:
        for doc_id in ids:
            _writer.delete_documents_by_term("id", str(doc_id))
        _writer.commit()
        INDEX.reload()
    return len(ids)


def delete_org(org: str) -> None:
    """Withdraw every document of one org with one exact term delete on `org`'s raw field.

    Bounded whatever the org's size, and it needs no ids, which Postgres no longer holds once the org is deleted.
    Committed and reloaded at once, like every other write.
    """
    with _writer_lock:
        _writer.delete_documents_by_term("org", org)
        _writer.commit()
        INDEX.reload()


def _finite(v: object) -> bool:
    """A number a boost can be: not a bool (`True` is an int), not NaN or infinite (JSON's `Infinity`, `1e400`)."""
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) and abs(v) <= 1_000


class FilterUnsupported(Exception):
    """A filter this index cannot apply: one built before the field it needs. Never ignored: the caller is told."""


def _range(lo: int | None, hi: int | None, field: str = "occurred_at") -> tantivy.Query:
    return tantivy.Query.range_query(
        SCHEMA, field, tantivy.FieldType.Integer, lo, hi, include_lower=True, include_upper=True
    )


def _between(narrow: dict, field: str) -> list[tuple[tantivy.Occur, tantivy.Query]]:
    """`from`/`to` on a date field, inclusive, in whole seconds wider than asked (from rounded down, to up) so the
    engine's exact re-check in SQL decides the edges."""
    lo = narrow.get("from")
    hi = narrow.get("to")
    if not lo and not hi:
        return []
    return [
        (
            tantivy.Occur.Must,
            _range(
                _to_unix_seconds(str(lo)) if lo else None,
                _to_unix_seconds(str(hi)) + 1 if hi else None,
                field,
            ),
        )
    ]


def _narrowing(narrow: dict) -> list[tuple[tantivy.Occur, tantivy.Query]]:
    """The narrowings a search may carry, each a must clause beside the fence: `ids` (these entries only, which of them
    hold the search's words), `apps` (any of these, `app` field), `figures` (those that state a figure) and a
    time range `from`/`to` in whole seconds, wider than asked (from rounded down, to up) so the engine's exact re-check
    in SQL decides the edges. Only narrows; an index without the `app` or `figures` field refuses that filter rather than
    ignore it."""
    out: list[tuple[tantivy.Occur, tantivy.Query]] = []
    ids = narrow.get("ids")
    if ids is not None:
        # Elasticsearch's `ids` query: these entries only, by the raw `id` field the fence's reads already trust.
        out.append((tantivy.Occur.Must, tantivy.Query.term_set_query(SCHEMA, "id", [str(i) for i in ids])))
    apps = narrow.get("apps")
    if apps is not None:
        if not HAS_APP:
            raise FilterUnsupported("app")
        out.append((tantivy.Occur.Must, tantivy.Query.term_set_query(SCHEMA, "app", [str(a) for a in apps])))
    if narrow.get("figures") is True:
        if not HAS_FIGURES:
            raise FilterUnsupported("figures")
        out.append((tantivy.Occur.Must, tantivy.Query.term_query(SCHEMA, "figures", "1")))
    return [*out, *_between(narrow, "occurred_at")]


DOCUMENT = "document"


def _fence(
    org: str, containers: list[str], as_of: str | None, documents: bool = False
) -> list[tuple[tantivy.Occur, tantivy.Query]]:
    """THE FENCE, as MUST clauses: the org, the caller's readable containers and (when given) the as-of cutoff. One
    builder for every read, so `/search` and `/list` cannot hold two definitions of it. A read is of one
    grain: the passages, or (`documents`) the document entries, so neither counts the other."""
    must = [
        (tantivy.Occur.Must, tantivy.Query.term_query(SCHEMA, "org", org)),
        (tantivy.Occur.Must, tantivy.Query.term_set_query(SCHEMA, "container", containers)),
    ]
    if as_of:
        cutoff = tantivy.Query.range_query(
            SCHEMA, "occurred_at", tantivy.FieldType.Integer, None, _to_unix_seconds(as_of), include_upper=True
        )
        must.append((tantivy.Occur.Must, cutoff))
    if HAS_KIND:
        # A read is of one grain; an earlier build's document entries are never a passage hit either.
        kind = tantivy.Query.term_query(SCHEMA, "kind", DOCUMENT)
        must.append((tantivy.Occur.Must if documents else tantivy.Occur.MustNot, kind))
    return must


def _exact_should(query: str, boost: float) -> list[tuple[tantivy.Occur, tantivy.Query]]:
    """The query's surface forms against the unstemmed field, boosted: SHOULD, so they only ever add."""
    return [
        (tantivy.Occur.Should, tantivy.Query.boost_query(tantivy.Query.term_query(SCHEMA, "exact", tok), boost))
        for tok in dict.fromkeys(_EXACT_ANALYZER.analyze(query))
    ]


def _snippets(searcher: tantivy.Searcher, query: tantivy.Query) -> tantivy.SnippetGenerator | None:
    """tantivy's own snippet generator over the stored `text`, for the words `query` asks of it, or None where the
    index stores no text. Built per search, from the hits' searcher, so a snippet is only ever of a fenced hit."""
    return tantivy.SnippetGenerator.create(searcher, query, SCHEMA, "text") if HAS_SNIPPETS else None


def _highlight(query: str, matched: tantivy.Query) -> tantivy.Query:
    """The query a hit's snippet is drawn by (Elasticsearch's `highlight_query`), apart from the one that matched it:
    the search's plain words on `text` as the match asks them, and each key or figure as a phrase of its parts on
    `text`, where prose writes it ("SUP-1042" as sup then 1042), since the match asks a key of the joined-form fields,
    which the generator does not read. It only marks: it never finds or ranks. The matching query where there is no key."""
    parts = keys(query)
    if not parts:
        return matched
    should = []
    words = _text_query(outside(query), 0, 0, False)
    if words is not None:
        should.append((tantivy.Occur.Should, words))
    for key in parts:
        tokens = [t for part in key for t in _QUERY_ANALYZER.analyze(part)]
        if len(tokens) > 1:
            should.append((tantivy.Occur.Should, tantivy.Query.phrase_query(SCHEMA, "text", tokens)))
        elif tokens:
            should.append((tantivy.Occur.Should, tantivy.Query.term_query(SCHEMA, "text", tokens[0])))
    return tantivy.Query.boolean_query(should) if should else matched


def _snippet(generator: tantivy.SnippetGenerator | None, doc: tantivy.Document) -> dict | None:
    """A hit's snippet: the fragment of its text where the search's words fell (tantivy's default length) and the
    marked words, as `[start, end)` character offsets into the fragment. None without one: no stored text, or no word
    of the search in the text (a match on another field)."""
    if generator is None:
        return None
    snippet = generator.snippet_from_doc(doc)
    marks = [[h.start, h.end] for h in snippet.highlighted()]
    fragment = snippet.fragment()
    return {"text": fragment, "marks": marks} if fragment and marks else None


def search(
    org: str,
    containers: list[str],
    query: str,
    limit: int,
    as_of: str | None,
    title_boost: float | None = None,
    narrow: dict | None = None,
    exact_boost: float | None = None,
    order: str = "relevance",
) -> tuple[list[dict], int]:
    """The fenced matches, ranked by BM25, or with `order: "newest"` SORTED by when the record was said
    (`occurred_at`, newest first; a record entry's date, as `modified` is a document entry's): a sort, not a ranking, so
    each hit's score is 0. The fence and the narrowings are the same either way."""
    started = time.perf_counter()
    boost = TITLE_BOOST if title_boost is None else max(0.0, float(title_boost))
    if not containers:
        # Fail closed: no readable containers is not "search everything",
        # it is nothing to search — the same rule every other retrieval leg
        # of the engine applies.
        return [], 0
    text_query = _text_query(query, boost, exact_boost)
    if text_query is None:
        return [], 0
    limit = max(1, min(limit, MAX_LIMIT))

    must = [*_fence(org, containers, as_of), (tantivy.Occur.Must, text_query)]
    must.extend(_narrowing(narrow or {}))
    fenced = tantivy.Query.boolean_query(must)

    # A fresh searcher per call, per tantivy's own guidance: it is the cheap
    # handle that pins a consistent segment set for this query, not a shared
    # resource to hold onto — which is also what makes concurrent searches
    # safe against a write committing in another thread.
    searcher = INDEX.searcher()
    generator = _snippets(searcher, _highlight(query, text_query))
    if order == "newest":
        result = searcher.search(fenced, limit=limit, order_by_field="occurred_at", order=tantivy.Order.Desc)
        found = [(0.0, addr) for _, addr in result.hits]
    else:
        result = searcher.search(fenced, limit=limit)
        found = [(float(score), addr) for score, addr in result.hits]
    hits = []
    for score, addr in found:
        doc = searcher.doc(addr)
        hits.append({"id": doc.get_first("id"), "score": score, "snippet": _snippet(generator, doc)})
    took_ms = int(round((time.perf_counter() - started) * 1000))
    return hits, took_ms


# Meilisearch's matching strategy, Elasticsearch's relevance recipe within each tier (`strategy: "last"`).
# Every word of the search first, then the words less the last, and so on (Meilisearch `matchingStrategy: "last"`),
# each tier a bool of MUST clauses, one per word, ranked by BM25 with a match-phrase-with-slop SHOULD for closeness
# (Elasticsearch, "proximity for relevance"). Held-ness comes from the fenced tiers alone: no unfenced statistic decides
# anything or shortens any path, so a word only hidden documents hold costs the same calls as one nobody holds.
MAX_WORDS = 10
PROXIMITY_SLOP = 50
# The Snowball English stop list (snowballstem.org; PostgreSQL ships it as `english.stop` for its `english` text search
# configuration, the keyword path's stop words all along), never tantivy's built-in "english", Lucene's shorter list.
SNOWBALL_ENGLISH_STOP = (
    "i", "me", "my", "myself", "we", "our", "ours", "ourselves", "you", "your", "yours", "yourself", "yourselves",
    "he", "him", "his", "himself", "she", "her", "hers", "herself", "it", "its", "itself", "they", "them", "their",
    "theirs", "themselves", "what", "which", "who", "whom", "this", "that", "these", "those", "am", "is", "are",
    "was", "were", "be", "been", "being", "have", "has", "had", "having", "do", "does", "did", "doing", "a", "an",
    "the", "and", "but", "if", "or", "because", "as", "until", "while", "of", "at", "by", "for", "with", "about",
    "against", "between", "into", "through", "during", "before", "after", "above", "below", "to", "from", "up",
    "down", "in", "out", "on", "off", "over", "under", "again", "further", "then", "once", "here", "there", "when",
    "where", "why", "how", "all", "any", "both", "each", "few", "more", "most", "other", "some", "such", "no", "nor",
    "not", "only", "own", "same", "so", "than", "too", "very", "s", "t", "can", "will", "just", "don", "should",
    "now",
)
_STOP = (
    tantivy.TextAnalyzerBuilder(tantivy.Tokenizer.simple())
    .filter(tantivy.Filter.lowercase())
    .filter(tantivy.Filter.custom_stopword(list(SNOWBALL_ENGLISH_STOP)))
    .build()
)


def _held(fence: list, query: tantivy.Query) -> bool:
    """Whether a readable document matches: always asked under the fence, so the answer says nothing about the rest."""
    fenced = tantivy.Query.boolean_query([*fence, (tantivy.Occur.Must, query)])
    return len(INDEX.searcher().search(fenced, limit=1, count=False).hits) > 0


# Meilisearch's `minWordSizeForTypos` defaults: a word this long may carry one typo, two from the second.
ONE_TYPO_FROM = 5
TWO_TYPOS_FROM = 9
# Exact > prefix > typo. Prefix and fuzzy term queries score a constant, so the boosts alone order them.
PREFIX_BOOST = 2.0
TYPO_BOOST = 1.0
MIN_PREFIX = 3
# The unstemmed fields a prefix may complete in (words, keys and the runs inside keys) and a typo may correct in.
_PREFIX_FIELDS = ("exact", "header_exact", "terms", "header_terms", "runs")
_TYPO_FIELDS = ("exact", "header_exact")


def _typos(word: str) -> int:
    return 2 if len(word) >= TWO_TYPOS_FROM else 1 if len(word) >= ONE_TYPO_FROM else 0


def _any(queries: list[tantivy.Query]) -> tantivy.Query:
    return tantivy.Query.boolean_query([(tantivy.Occur.Should, q) for q in queries])


def _on(fields: tuple[str, ...], query) -> tantivy.Query:
    return _any([query(f) for f in fields if _HAS[f]])


def _form(chunk: str) -> tuple[str | None, bool]:
    """The word as the index holds it, and whether it is a key: a key as its joined form, a word as its one token."""
    asked = keys(chunk)
    plain = _EXACT_ANALYZER.analyze(chunk)
    if len(asked) == 1:
        return "".join(asked[0]), True
    return (plain[0], False) if not asked and len(plain) == 1 else (None, False)


def _widened(chunk: str, last: bool) -> tuple[tantivy.Query | None, tantivy.Query | None]:
    """A word no readable document holds, as a clause of the one query, the way Elasticsearch's `match_bool_prefix`
    reads a search and Meilisearch its last word: the last word as a prefix of the held terms, and any word as a fuzzy
    term within Meilisearch's typo allowance. A key is never edited. Returns the clause and its prefix part."""
    form, key = _form(chunk)
    if form is None:
        return None, None
    prefix = typo = None
    if last and len(form) >= MIN_PREFIX:
        prefix = _on(_PREFIX_FIELDS, lambda f: tantivy.Query.fuzzy_term_query(SCHEMA, f, form, 0, True, True))
    if not key and form.isalpha() and _typos(form):
        typo = _on(_TYPO_FIELDS, lambda f: tantivy.Query.fuzzy_term_query(SCHEMA, f, form, _typos(form), True, False))
    clauses = [tantivy.Query.boost_query(q, b) for q, b in ((prefix, PREFIX_BOOST), (typo, TYPO_BOOST)) if q]
    return (_any(clauses) if clauses else None), prefix


SAID = ("completed", "corrected", "dropped")


def _resolved(fence: list, words: list[tuple]) -> tuple[list, dict]:
    """When no readable document holds every word, each word is checked under the fence (the term suggester's
    `suggest_mode: missing`), and one nobody readable holds is asked as its clause (`_widened`). A clause that finds
    nothing readable either is not asked, and the page says so. A word the documents hold is never widened."""
    groups: list = []
    said: dict[str, list[str]] = {k: [] for k in SAID}
    for i, (chunk, asked, stems) in enumerate(words):
        if _held(fence, asked):
            groups.append((asked, stems))
            continue
        clause, prefix = _widened(chunk, i == len(words) - 1)
        if clause is not None and _held(fence, clause):
            groups.append((clause, []))
            said["completed" if prefix is not None and _held(fence, prefix) else "corrected"].append(chunk)
        else:
            said["dropped"].append(chunk)
    return groups, said


def _tier(fence: list, groups: list, narrow: dict) -> tantivy.Query:
    """One tier: every word a MUST, ranked by BM25 with a match-phrase-with-slop SHOULD for words close together."""
    tier = [(tantivy.Occur.Must, q) for q, _ in groups]
    stems = [s for _, words in groups for s in words]
    if len(stems) > 1:
        tier.append((tantivy.Occur.Should, tantivy.Query.phrase_query(SCHEMA, "text", stems, PROXIMITY_SLOP)))
    return tantivy.Query.boolean_query([*fence, *tier, *_narrowing(narrow)])


def _phrase_query(query: str) -> tantivy.Query | None:
    """Elasticsearch's `match_phrase`, for a listing that asks `phrase: true` (the documents that mention an
    identifier): every word held, a key as its joined form (`_words`, as a tier asks it), and the words, where there are
    more than one, side by side (slop 0) in the text or the header. None when the search has no word."""
    words = _words(query)
    if not words:
        return None
    must = [(tantivy.Occur.Must, q) for _, q, _ in words]
    stems = [s for _, _, word_stems in words for s in word_stems]
    if len(stems) > 1:
        fields = ["text", *(["header"] if HAS_HEADER else [])]
        side = [(tantivy.Occur.Should, tantivy.Query.phrase_query(SCHEMA, f, stems, 0)) for f in fields]
        must.append((tantivy.Occur.Must, tantivy.Query.boolean_query(side)))
    return tantivy.Query.boolean_query(must)


def _words(query: str) -> list[tuple]:
    """The search's words in order, at most `MAX_WORDS`, each with its query and its stems; a stop word is no word. A
    key is always asked as its joined form, whatever `LOUVAIN_BM25_ANALYZER` says for the plain `/search`: a key asked
    as its parts would match every sibling that shares one ("SUP-1042" as sup and 1042)."""
    chunks = [c for c in query.replace('"', " ").split() if keys(c) or _STOP.analyze(c)][:MAX_WORDS]
    return [
        (c, q, _QUERY_ANALYZER.analyze(outside(c))) for c in chunks if (q := _text_query(c, TITLE_BOOST, 0, True))
    ]


def search_last(org: str, containers: list[str], query: str, limit: int, as_of: str | None, narrow: dict) -> dict:
    """`/search` under `strategy: "last"`: every word, then the words less the last, each tier ranked by its own BM25,
    until `limit` are found. When the first tier finds something every word is held and nothing is checked word by
    word. The answer names the words completed, corrected or dropped, never the terms they matched, and `asked`, how
    many words the first tier asked for: a hit whose `words` is `asked` holds every word searched (the caller's match)."""
    words = _words(query)
    if not containers or not words:
        return {"hits": [], "asked": 0, **{k: [] for k in SAID}}
    limit = max(1, min(limit, MAX_LIMIT))
    fence = _fence(org, containers, as_of)
    groups, said = [(q, stems) for _, q, stems in words], {k: [] for k in SAID}
    searcher = INDEX.searcher()
    first = searcher.search(_tier(fence, groups, narrow), limit=limit).hits
    if not first:
        groups, said = _resolved(fence, words)
    seen: set[str] = set()
    hits: list[dict] = []
    for n in range(len(groups), 0, -1):
        found = first if first and n == len(groups) else searcher.search(
            _tier(fence, groups[:n], narrow), limit=limit + len(seen)
        ).hits
        generator = _snippets(searcher, _highlight(" ".join(c for c, _, _ in words[:n]), _tier(fence, groups[:n], narrow)))
        for score, addr in found:
            doc = searcher.doc(addr)
            doc_id = doc.get_first("id")
            if doc_id not in seen and len(hits) < limit:
                seen.add(doc_id)
                hits.append({"id": doc_id, "score": float(score), "words": n, "snippet": _snippet(generator, doc)})
        if len(hits) >= limit:
            break
    return {"hits": hits, "asked": len(groups), **said}


def _text_query(
    query: str, boost: float, exact_boost: float | None, analyzer: bool = ANALYZER_ON
) -> tantivy.Query | None:
    """The search's words as one SHOULD query over the text fields, or None when it has none. With `analyzer`, a key
    or figure is asked of the analyzer's fields as its joined form, never of English text as its parts."""
    tokens = _QUERY_ANALYZER.analyze(query or "")
    if not tokens:
        return None
    text_should = _asked("text", query, tokens, analyzer=analyzer)
    # `minimum_number_should_match=1`: OR semantics — at least one query term
    # has to match. Measured redundant (a should-only clause already refuses
    # a doc matching none of them, nested or not) but stated explicitly
    # because the clause sits inside an outer MUST and "at least one term
    # matches" is the contract a reviewer should be able to read off the code
    # rather than infer from tantivy's defaults.
    if boost > 0:
        # BM25F by hand: the same terms scored against the title field, the
        # whole clause boosted. SHOULD, so a document with no title match is
        # still a candidate on its body — the title only ever ADDS.
        title_should = _asked("title", query, tokens, boost, analyzer)
        text_should = [*text_should, *title_should]
    if HAS_HEADER and HEADER_BOOST > 0:
        # The header the same way: SHOULD, boosted, so it only ever ADDS to a document the body already names —
        # or makes a candidate of one whose header alone names what was asked (the contract by its title).
        header_should = _asked("header", query, tokens, HEADER_BOOST, analyzer)
        text_should = [*text_should, *header_should]
    if VARIANTS_ON and HAS_VARIANTS:
        text_should = [*text_should, *_variant_should(query)]
    if analyzer and HAS_TERMS:
        text_should = [*text_should, *_terms_should(query, "terms")]
    if analyzer and HAS_RUNS:
        text_should = [*text_should, *_keys_should(query, "runs")]
    if analyzer and HAS_HEADER_TERMS and HEADER_BOOST > 0:
        text_should = [*text_should, *_terms_should(query, "header_terms", HEADER_BOOST)]
    exact = EXACT_BOOST if exact_boost is None else max(0.0, float(exact_boost))
    if HAS_EXACT and exact > 0:
        text_should = [*text_should, *_exact_should(query, exact)]
    return tantivy.Query.boolean_query(text_should, minimum_number_should_match=1)


MAX_FACETS = 1_000


class ListingUnsupported(Exception):
    """An index built before the document entries: it cannot list. Said, never answered empty."""


def listing(org: str, containers: list[str], ask: dict) -> dict:
    """THE LISTING FROM THE INDEX: the readable document entries, matching the search's words when it has any, as a page
    (`order`: `newest` by `modified`, or `relevance`), its exact total and its facets by app and container, the
    fence's own values: the engine names a container's connection for each reader. Two narrowings are must clauses
    beside the fence: `from`/`to` on `modified` (`_between`), and `ids`, the entries the client names (Elasticsearch's
    `ids` query: a term set on `id`, which scores every entry alike and so leaves the order as it was). The facets
    count everything but the app filter, so a click on an app leaves them as they were. Fenced like every read; no
    readable container is an empty listing."""
    if not HAS_LISTING:
        raise ListingUnsupported("listing")
    empty = {"ids": [], "snippets": [], "total": 0, "facets": [], "facetsBounded": False}
    if not containers:
        return empty
    must = [*_fence(org, containers, ask.get("asOf"), documents=True)]
    query = str(ask.get("query") or "")
    if query:
        text_query = _phrase_query(query) if ask.get("phrase") is True else _text_query(query, TITLE_BOOST, 0)
        if text_query is None:
            return empty
        must.append((tantivy.Occur.Must, text_query))
    must.extend(_between(ask, "modified"))
    ids = ask.get("ids")
    if ids is not None:
        must.append((tantivy.Occur.Must, tantivy.Query.term_set_query(SCHEMA, "id", [str(i) for i in ids])))
    unfiltered = tantivy.Query.boolean_query(must)
    apps = ask.get("apps")
    if apps is not None:
        must.append((tantivy.Occur.Must, tantivy.Query.term_set_query(SCHEMA, "facet_app", [str(a) for a in apps])))
    page_query = tantivy.Query.boolean_query(must)
    searcher = INDEX.searcher()
    limit = max(1, min(int(ask.get("limit") or DEFAULT_LIMIT), MAX_LIMIT))
    offset = max(0, int(ask.get("offset") or 0))
    by_relevance = query != "" and ask.get("order") == "relevance"
    result = (
        searcher.search(page_query, limit=limit, offset=offset, count=True)
        if by_relevance
        else searcher.search(
            page_query, limit=limit, offset=offset, count=True, order_by_field="modified", order=tantivy.Order.Desc
        )
    )
    agg = searcher.aggregate(
        unfiltered,
        {"apps": {"terms": {"field": "facet_app", "size": MAX_FACETS},
                  "aggs": {"containers": {"terms": {"field": "facet_container", "size": MAX_FACETS}}}}},
    )
    facets = [
        {"app": app["key"], "container": box["key"], "count": box["doc_count"]}
        for app in agg["apps"]["buckets"]
        for box in app["containers"]["buckets"]
    ]
    facets.sort(key=lambda f: (-f["count"], f["app"], f["container"]))
    # A terms aggregation returns its top `MAX_FACETS` buckets and counts the rest apart: said, never dropped silently.
    rest = agg["apps"].get("sum_other_doc_count", 0) + sum(
        app["containers"].get("sum_other_doc_count", 0) for app in agg["apps"]["buckets"]
    )
    # A listing searched by words shows each entry's snippet where they fell; a listing without words, none.
    generator = _snippets(searcher, _highlight(query, text_query)) if query else None
    docs = [searcher.doc(addr) for _, addr in result.hits]
    return {"ids": [d.get_first("id") for d in docs], "snippets": [_snippet(generator, d) for d in docs],
            "total": result.count,
            "facets": facets, "facetsBounded": rest > 0}


def _asked(
    field: str, query: str, tokens: list[str], boost: float | None = None, analyzer: bool = ANALYZER_ON
) -> list[tuple[tantivy.Occur, tantivy.Query]]:
    """The query against one English field (`text`, `title`, `header`), SHOULD, boosted when `boost` is given. With the
    analyzer on, its plain words only: a key or figure is asked of the analyzer's fields (`terms`, `header_terms`),
    never of English text, where its parts are two common words ("NOTE5" is not a search for prose saying "note 5")
    and where its spellings are held differently ("FS-4471" as fs and 4471, "fs4471" whole). So every spelling of a
    key is one query. With it off, the query's own tokens, as the field was always asked."""
    words = _QUERY_ANALYZER.analyze(outside(query)) if analyzer and HAS_TERMS else tokens
    return [
        (
            tantivy.Occur.Should,
            tantivy.Query.term_query(SCHEMA, field, tok)
            if boost is None
            else tantivy.Query.boost_query(tantivy.Query.term_query(SCHEMA, field, tok), boost),
        )
        for tok in dict.fromkeys(words)
    ]


def _terms_should(
    query: str, field: str, boost: float | None = None
) -> list[tuple[tantivy.Occur, tantivy.Query]]:
    """The query through the same word-delimiter step, on one of its fields (`terms`, or `header_terms` boosted as the
    header is): its plain words as terms, and each key or figure as
    its joined form alone (never a part, never a phrase of parts, which prose can hold), so "2400" finds a document that
    wrote "2,400", "sup1042" and "note5" ones that wrote "SUP-1042" and "note-05", and "notes-5" one ending
    "...notes-5" (a document holds every run of its key's parts joined). SHOULD: they only ever add."""
    should = [
        (tantivy.Occur.Should, tantivy.Query.term_query(SCHEMA, field, tok))
        for tok in dict.fromkeys(_EXACT_ANALYZER.analyze(outside(query)))
    ]
    should.extend(_keys_should(query, field))
    return should if boost is None else [(occur, tantivy.Query.boost_query(q, boost)) for occur, q in should]


def _keys_should(query: str, field: str) -> list[tuple[tantivy.Occur, tantivy.Query]]:
    """Each key or figure of the query as its joined form, on `field`, as one SHOULD each. A key of digits alone is
    also asked as written ("2.03" as 23 or 203), since a document holds its digit chain as written
    (`catenate_numbers`) beside its parts with their zeros dropped. Exact terms scored by BM25, never a part."""
    should: list[tuple[tantivy.Occur, tantivy.Query]] = []
    for token, parts in _tokens(query):
        forms = ["".join(parts)]
        if all(p.isdigit() for p in parts) and _DELIMITER.sub("", token) not in forms:
            forms.append(_DELIMITER.sub("", token))
        # One term query per form, never a set query: a TermSetQuery scores a constant, with no BM25, and a key the
        # search names must weigh by its frequency and rarity like any word.
        either = [(tantivy.Occur.Should, tantivy.Query.term_query(SCHEMA, field, form)) for form in forms]
        should.append((tantivy.Occur.Should, either[0][1] if len(either) == 1 else tantivy.Query.boolean_query(either)))
    return should


def _variant_should(query: str) -> list[tuple[tantivy.Occur, tantivy.Query]]:
    """The query's compounds as the index holds them: each joined spelling a term on `variants`, each letters-and-digits
    word's parts a phrase on `text`. SHOULD, beside the query's own terms: they only ever add."""
    should: list[tuple[tantivy.Occur, tantivy.Query]] = []
    for joined in _joined(query):
        for tok in dict.fromkeys(_QUERY_ANALYZER.analyze(joined)):
            # Both fields: a document that wrote "SOC2" holds `soc2` in its text; one that wrote "seat-hours" holds
            # `seathour` only in `variants`.
            for field in ("text", "variants"):
                should.append((tantivy.Occur.Should, tantivy.Query.term_query(SCHEMA, field, tok)))
    for parts in _split(query):
        toks = [t for p in parts for t in _QUERY_ANALYZER.analyze(p)]
        if len(toks) > 1:
            should.append((tantivy.Occur.Should, tantivy.Query.phrase_query(SCHEMA, "text", toks)))
    return should


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
                {"ok": True, "role": "bm25", "docs": _num_docs(), "dir": os.path.abspath(BM25_DIR),
                 "rebuild": UNREADABLE or not FOLDED or not HAS_SNIPPETS or not all(_HAS.values()), "unreadable": UNREADABLE},
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
        if UNREADABLE:
            self._send(409, {"error": "index_unreadable", "rebuild": True})
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
                if not HAS_LISTING and any(doc.get("kind") == DOCUMENT for doc in docs):
                    # Never stored as a passage: the engine says once to reindex.
                    self._send(409, {"error": "listing_unsupported"})
                    return
                commit = req.get("commit", True) is not False
                n = index_docs(docs, commit)
                self._send(200, {"indexed": n, "committed": commit, "boot": BOOT_ID})
            elif self.path == "/delete":
                req = self._body()
                ids = req.get("ids")
                if not isinstance(ids, list) or not all(isinstance(i, str) and i for i in ids):
                    self._send(400, {"error": "ids must be a list of non-empty strings"})
                    return
                self._send(200, {"deleted": delete_docs(ids)})
            elif self.path == "/delete_org":
                req = self._body()
                org = req.get("org")
                if not isinstance(org, str) or not org:
                    self._send(400, {"error": "org is required"})
                    return
                delete_org(org)
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
                try:
                    if req.get("strategy") == "last":
                        self._send(200, search_last(org, [str(c) for c in containers], str(req.get("query") or ""),
                                                    limit, as_of, narrow))
                        return
                    hits, took_ms = search(
                        org, [str(c) for c in containers], str(req.get("query") or ""), limit, as_of, title_boost,
                        narrow, exact_boost, order,
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
        try:
            self._send(200, listing(org, [str(c) for c in containers], req))
        except ListingUnsupported:
            self._send(409, {"error": "listing_unsupported"})

    def log_message(self, *_args) -> None:
        """Silent: bodies are document text."""


if __name__ == "__main__":
    print(
        f"louvain bm25 sidecar on :{PORT} (dir {os.path.abspath(BM25_DIR)}, "
        f"heap {BM25_HEAP_MB}MB, {_num_docs()} docs, {sidecar_auth.describe(SIDECAR_TOKEN)})",
        flush=True,
    )
    serve(Handler, PORT)
