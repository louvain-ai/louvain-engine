"""The analyzer's delimited and mixed tokens (`analyzer._RUN`, `_keyed`) are exactly the ones the one pattern they
replace finds, `{_N}+(?:[-.,_/]{_N}+)+|{_N}*(?:{_A}\\d|\\d{_A}){_N}*`, which was quadratic on a long run of letters with
no digit (a 4,096-letter lookup took the keyword index past its client's timeout). The old pattern is the oracle here,
over generated strings of letters, digits, delimiters, spaces, brackets and an accented letter, from a fixed seed:
the tokens, the plain words (`outside`) and the key a text opens with (`lead`) are the same.

    apps/nlp/.venv/bin/python apps/nlp/test_analyzer_linear.py
"""

import random
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import analyzer  # noqa: E402

OLD = re.compile(rf"{analyzer._N}+(?:[-.,_/]{analyzer._N}+)+|{analyzer._N}*(?:{analyzer._A}\d|\d{analyzer._A}){analyzer._N}*")
ALPHABET = "ab9z01-._/, ([é"
CASES = 5000


def old_lead(text: str) -> str | None:
    folded = (text or "").lower().translate(analyzer._FOLD)
    start = analyzer._LEAD.match(folded)
    token = OLD.match(folded, start.end() if start else 0)
    if not token:
        return None
    end = token.end()
    if end < len(folded) and re.match(analyzer._N, folded[end]):
        return None
    _, parts = analyzer._tokens(token.group(0))[0]
    return "".join(parts)


def main() -> None:
    rng = random.Random(20261115)
    for i in range(CASES):
        text = "".join(rng.choice(ALPHABET) for _ in range(rng.randint(0, 24)))
        folded = text.lower().translate(analyzer._FOLD)
        want = OLD.findall(folded)
        got = analyzer._keyed_runs(folded)
        assert got == want, f"tokens of {text!r}: {got} != {want}"
        assert analyzer.outside(text) == OLD.sub(" ", folded), f"outside of {text!r}"
        assert analyzer.lead(text) == old_lead(text), f"lead of {text!r}: {analyzer.lead(text)} != {old_lead(text)}"
    print(f"ok: test_analyzer_linear ({CASES} strings)")


if __name__ == "__main__":
    main()
