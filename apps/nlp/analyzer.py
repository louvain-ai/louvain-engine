"""The word-delimiter step of the one analyzer documents and searches pass through, the keyword index's (a build whose
database keeps an analyzer of its own holds it, `search_delimited`, to the same table). As Lucene's WordDelimiterGraphFilter (Elasticsearch
`word_delimiter_graph`) does it with `preserve_original`, `catenate_all` and its default `split_on_numerics`, after case
and accent folding: a token whose letters and digits are joined by an intra-word delimiter (`-` `.` `,` `_` `/`) or
run together also gives its parts and their catenation ("SUP-1042" -> sup, 1042, sup1042; "2,400" -> 2, 400, 2400),
a digit part compared as a number (its leading zeros dropped: "note-05" -> note, 5, note05, note5), and every run of
two or more parts joined, as a shingle filter with an empty separator ("a-b-c" also gives ab and bc), and with
`catenate_numbers` each chain of digits separated by delimiters joined, as written ("v2.3.1" gives 231, "x-01-02-03"
gives 010203); the database's half does not do this one.
Held to the same parity table as the SQL (`packages/engine/test/analyzer-cases.json`, `test_analyzer.py`)."""

import re

_ACCENTED = "àáâãäåçèéêëìíîïñòóôõöùúûüýÿ"
_PLAIN = "aaaaaaceeeeiiiinooooouuuuyy"
_FOLD = str.maketrans(_ACCENTED, _PLAIN)
_A = r"[^\W\d_]"  # a letter
_N = r"[^\W_]"  # a letter or a digit
# A delimited or mixed token: a run of letters and digits joined by intra-word delimiters (`_RUN`, taken whole, so it
# is matched once and in linear time) that holds a delimiter or a letter beside a digit (`_keyed`). Said as one pattern,
# `{_N}*(?:{_A}\d|\d{_A}){_N}*` tried at every position of a long run with no digit is quadratic: 4,096 letters took
# half a second per call.
_RUN = re.compile(rf"{_N}+(?:[-.,_/]{_N}+)*")
_MIXED = re.compile(rf"{_A}\d|\d{_A}")
_DELIMITER = re.compile(r"[-.,_/]")


def _keyed(run: str) -> bool:
    """Whether a run is a delimited or mixed token: a delimiter in it, or a letter beside a digit."""
    return bool(_DELIMITER.search(run) or _MIXED.search(run))


def _keyed_runs(text: str) -> list[str]:
    """The text's delimited and mixed tokens, in order."""
    return [m.group(0) for m in _RUN.finditer(text) if _keyed(m.group(0))]


def _tokens(text: str) -> list[tuple[str, list[str]]]:
    """Each delimited or mixed token of `text`, folded, with its parts: split at its delimiters and between letters
    and digits, a digit part compared as a number (its leading zeros dropped: "note-05" -> note, 5)."""
    out: list[tuple[str, list[str]]] = []
    for token in _keyed_runs((text or "").lower().translate(_FOLD)):
        spaced = _DELIMITER.sub(" ", token)
        spaced = re.sub(rf"({_A})(\d)", r"\1 \2", spaced)
        spaced = re.sub(rf"(\d)({_A})", r"\1 \2", spaced)
        out.append((token, [re.sub(r"^0+(?=\d)", "", p) for p in spaced.split()]))
    return out


MAX_SHINGLE_PARTS = 8


def _shingles(parts: list[str]) -> list[str]:
    """A token's contiguous runs of two or more parts, joined, shorter first, the whole left out (it is the token's
    catenation): a shingle filter with an empty separator (Lucene's ShingleFilter, Elasticsearch `shingle` with
    `token_separator: ""`), so a search's key is found inside a longer one ("notes-5" in
    "field-service-scheduling-notes-5") as one form no prose holds. A token of more than `MAX_SHINGLE_PARTS` parts
    gives none. A run begins with a letter, as a key does: one that begins with digits is a date's, a
    version's or a file name's pieces, so "build-4-12-34.md" holds neither 1234 nor 34md."""
    n = len(parts)
    if n > MAX_SHINGLE_PARTS:
        return []
    return [
        "".join(parts[i : i + size])
        for size in range(2, n)
        for i in range(n - size + 1)
        if re.match(_A, parts[i])
    ]


def _numbers(token: str) -> list[str]:
    """`catenate_numbers`, as Elasticsearch documents it for `word_delimiter_graph`: "produces catenated tokens for
    chains of numeric characters separated by non-alphabetic delimiters. For example: 01-02-03 -> 010203"
    (elastic.co, Word delimiter graph token filter). Each chain of two or more digit parts, as written. A token that is
    all digits has none: its catenation is already given, and Lucene's filter outputs one combination once."""
    chains = re.findall(r"\d+(?:[-.,_/]\d+)+", token)
    if re.fullmatch(r"[\d\-.,_/]+", token):
        return []
    return [_DELIMITER.sub("", chain) for chain in chains]


def stream(text: str) -> list[str]:
    """The step's forms for a document, in order and with repeats: each token's parts, then its catenation as written
    and as numbers, then its runs of digit parts joined (`_numbers`). The runs of parts inside a token are `runs`,
    indexed apart, as a shingle sub-field is, so they do not lengthen the field a document's other forms are scored
    in."""
    return [
        form
        for token, parts in _tokens(text)
        for form in [*parts, _DELIMITER.sub("", token), "".join(parts), *_numbers(token)]
    ]


def runs(text: str) -> list[str]:
    """The runs of parts inside each token of `text` (`_shingles`), in order and with repeats."""
    return [form for _, parts in _tokens(text) for form in _shingles(parts)]


def delimited(text: str) -> list[str]:
    """The step's forms for `text`, in order, each once: its forms and its runs (the parity table's set)."""
    return list(dict.fromkeys([*stream(text), *runs(text)]))


def keys(query: str) -> list[list[str]]:
    """A search's delimited or mixed tokens, each as its parts: asked as their catenation alone, which a document holds
    as one of its runs (`_shingles`), never as a part or a phrase of parts, so "SUP-1042" never matches "SUP-1043" and
    "NOTE5" never prose that says "note 5"."""
    return [parts for _, parts in _tokens(query)]


_LEAD = re.compile(r"\s*[\[(]?\s*")


def lead(text: str) -> str | None:
    """The key `text` opens with, as the step catenates it (`catenate_all`: its parts joined, "SUP-1042" and "sup1042"
    alike give sup1042), after at most one bracket ("[ENG-4902] ...", "ENG-4902: ..."); None when it opens with no
    delimited or mixed token. One form for a title and a search, so a key however it is written identifies the title it
    opens."""
    folded = (text or "").lower().translate(_FOLD)
    start = _LEAD.match(folded)
    run = _RUN.match(folded, start.end() if start else 0)
    token = run if run and _keyed(run.group(0)) else None
    if not token:
        return None
    end = token.end()
    if end < len(folded) and re.match(_N, folded[end]):
        return None
    _, parts = _tokens(token.group(0))[0]
    return "".join(parts)


def outside(query: str) -> str:
    """The search with its delimited and mixed tokens taken out: its plain words."""
    return _RUN.sub(lambda m: " " if _keyed(m.group(0)) else m.group(0), (query or "").lower().translate(_FOLD))
