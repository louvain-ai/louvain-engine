"""The keyword index's shape (`bm25.py`): its analyzers, its fields and the joined spellings a document's compounds are
held as. Pure: no index, no environment."""

import re

import tantivy

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

# The optional fields, oldest first: an index built by an older sidecar holds a prefix of them (`bm25_store.open_store`).
OPTIONAL_FIELDS = (
    "header", "variants", "app", "exact", "terms", "header_terms", "runs", "header_exact", "listing", "figures",
)
# A document entry's `kind` (`listing`); a passage has none.
DOCUMENT = "document"
