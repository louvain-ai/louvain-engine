import assert from "node:assert/strict";
import { it } from "node:test";
import { Lexer } from "marked";
import type { Token } from "../web/md-types.js";
import { plainText } from "../web/snippet.js";
import { queryTerms, termRanges } from "../web/terms.js";

/** The lexer the page loads, from the same package, read as the page reads it. */
const lex = (md: string) => Lexer.lex(md, { gfm: true }) as unknown as Token[];

const snippet = (md: string) => plainText(lex(md));

it("a snippet is its words without markdown's marks, on one line", () => {
  const passage =
    "# Incident report INC-2026-07\n\nINC-2026-07: escalated from support ticket SUP-1042.\n\n## Timeline\n\n- **Downtime**: 6 hours 40 minutes.\n- Fixed in `4.3.1`.";
  assert.equal(
    snippet(passage),
    "Incident report INC-2026-07 INC-2026-07: escalated from support ticket SUP-1042. Timeline Downtime: 6 hours 40 minutes. Fixed in 4.3.1.",
  );
});

it("a snippet with no markdown is left as it was written", () => {
  const text = "Halvard Marine reports: FS-4471 sensors drop off the network after three days.";
  assert.equal(snippet(text), text);
});

it("the query lights the same words once the marks are gone", () => {
  const words = snippet("## Timeline\n\n- **SUP-1042** escalated to INC-2026-07");
  const lit = termRanges(words, queryTerms("SUP-1042 timeline")).map((r) =>
    words.slice(r.start, r.end),
  );
  assert.deepEqual(lit, ["Timeline", "SUP-1042"]);
});
