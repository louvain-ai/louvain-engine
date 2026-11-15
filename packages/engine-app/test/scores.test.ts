import assert from "node:assert/strict";
import { it } from "node:test";
import { headline, ordinal, reasons } from "../web/scores.js";

/** A result's numbers, each field read by its presence. */

it("a result with no numbers shows none, and says why in one sentence", () => {
  const match = { words: true, meaning: null };
  assert.equal(headline(match), null);
  assert.deepEqual(reasons(match, 3), [
    "It holds the words of the search.",
    "A search for a name or a figure is matched by the documents that hold it, not scored by meaning.",
  ]);
});

it("a similarity alone is the headline, as a figure without a meter", () => {
  const match = { words: false, meaning: 0.4712 };
  assert.deepEqual(headline(match), { figure: "0.47", name: "similarity", meter: null });
  assert.deepEqual(reasons(match, 1), [
    "It does not hold the words of the search.",
    "Similarity 0.47: how close its best passage is in meaning to the search, 0 to 1.",
  ]);
});

it("a relevance leads with a meter, and the ranks before combining are said in words", () => {
  const match = { words: true, meaning: 0.61, relevance: 0.83, ranks: { words: 1, meaning: 97 } };
  assert.deepEqual(headline(match), { figure: "0.83", name: "relevance", meter: 0.83 });
  assert.deepEqual(reasons(match, 2), [
    "It holds the words of the search.",
    "Relevance 0.83: the reranker's judgement of how well it answers the search, 0 to 1.",
    "Similarity 0.61: how close its best passage is in meaning to the search, 0 to 1.",
    "Ranked 1st by its words, 97th by meaning; 2nd once the two were combined.",
  ]);
});

it("an exact hit says so first, and a list that did not find it says that", () => {
  const match = {
    words: true,
    meaning: 0.47,
    exact: true as const,
    ranks: { words: 1, meaning: null },
  };
  const said = reasons(match, 1);
  assert.equal(said[0], "Exact: the search is this document's own identifier or title.");
  assert.equal(
    said.at(-1),
    "Ranked 1st by its words, not found by meaning; 1st once the two were combined.",
  );
});

it("a words-only row with its rank shows the rank as its figure", () => {
  const match = { words: true, meaning: null, ranks: { words: 3, meaning: null } };
  assert.deepEqual(headline(match), { figure: "#3", name: "rank by its words", meter: null });
  assert.equal(
    reasons(match, 3).at(-1),
    "Ranked 3rd by its words, not found by meaning; 3rd once the two were combined.",
  );
});

it("orders read as words", () => {
  assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21, 22, 97, 101, 111].map(ordinal), [
    ...[
      "1st",
      "2nd",
      "3rd",
      "4th",
      "11th",
      "12th",
      "13th",
      "21st",
      "22nd",
      "97th",
      "101st",
      "111th",
    ],
  ]);
});
