import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { queryTerms, termRanges } from "../web/terms.js";

/** What a query lights in a text, as the text's own words. */
const lit = (query: string, text: string) =>
  termRanges(text, queryTerms(query)).map((r) => text.slice(r.start, r.end));

describe("what a query lights", () => {
  const cases: [string, string, string, string[]][] = [
    [
      "words where they start a word",
      "When does the lease renew?",
      "The lease renews; a release does not.",
      ["lease", "renews"],
    ],
    ["a figure whole, with its currency", "2,400", "a fee of GBP £2,400 a month", ["£2,400"]],
    ["a figure written without its separator", "2400", "a fee of GBP 2,400 a month", ["2,400"]],
    [
      "a figure whatever its thousands separator",
      "2.400",
      "costs 2,400 and 2 400 and 2400",
      ["2,400", "2 400", "2400"],
    ],
    ["never a part of another number", "400", "GBP 2,400 and 1400 and 400 desks", ["400"]],
    ["a decimal is not thousands", "2,400", "a ratio of 24.00 and 2.4", []],
    ["an identifier whole", "SUP-1042", "ticket SUP-1042 and SUP-10420 and 1042", ["SUP-1042"]],
    ["accents ignored both ways", "cafe résume", "the Café and a resumé", ["Café", "resumé"]],
    ["a query of punctuation alone", "?!, -", "anything at all.", []],
    ["the small words alone", "what was the", "what was the time", []],
  ];
  for (const [name, query, text, want] of cases)
    it(name, () => assert.deepEqual(lit(query, text), want));

  it("reads a query into identifiers, figures and words", () => {
    assert.deepEqual(queryTerms("Fee for SUP-1042: GBP 2,400?"), {
      words: ["fee", "gbp"],
      figures: ["2400"],
      ids: ["sup-1042"],
    });
  });
});
