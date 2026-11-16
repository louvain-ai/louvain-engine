import assert from "node:assert/strict";
import { test } from "node:test";

/**
 * The same token written several ways is one (`relevance.ts` `literalsOf`, `fold`): a figure with or without its
 * separators, an identifier joined, hyphenated or spaced, a word with or without its accents. No database: the
 * extraction and the fold only; the SQL side folds and joins the passage's text the same way.
 */
const { fold, literalsOf, wordsOf } = await import("../src/kg/read/relevance.js");

test("every written form of a figure is the same bare digits", () => {
  for (const q of ["2400", "2,400", "2.400", "2 400", "£2,400", "a fee of GBP 2,400 a month"])
    assert.deepEqual(literalsOf(q), ["2400"], q);
});

test("an identifier joined or hyphenated is one literal, and its digits are not a second", () => {
  for (const q of ["sup1042", "SUP-1042", "Sup-1042"])
    assert.deepEqual(literalsOf(q), ["sup1042"], q);
  // Spaced, it is two words, which the word test finds in "SUP-1042" (held as "sup" and "1042"): its digits stay a figure.
  assert.deepEqual(literalsOf("sup 1042"), ["1042"]);
  assert.deepEqual(literalsOf("PO-4471 and 400"), ["po4471", "400"]);
  assert.deepEqual(literalsOf("highfield"), []);
});

test("an identifier however hyphenated is one literal, and its pieces are neither words nor figures", () => {
  assert.deepEqual(literalsOf("3f2b8c1e-9d4a-4e7b-a6c2-5d8e1f0b7a93"), [
    "3f2b8c1e9d4a4e7ba6c25d8e1f0b7a93",
  ]);
  assert.deepEqual(literalsOf("INC-2026-07"), ["inc202607"]);
  assert.equal(wordsOf("SUP-1042 escalation").trim(), "escalation");
  assert.equal(wordsOf("3f2b8c1e-9d4a-4e7b-a6c2-5d8e1f0b7a93").trim(), "");
  // A word without a digit is a word, hyphenated or not; a figure alone is a figure.
  assert.equal(wordsOf("on-call rota").trim(), "on-call rota");
  assert.deepEqual(literalsOf("2026-11-14"), ["2026", "11", "14"]);
  // A figure's pieces are not words either: "2,400" is the figure 2400, never "2" and "400".
  assert.equal(wordsOf("GBP 2,400 fee").replace(/\s+/g, " ").trim(), "gbp fee");
  // A figure written twice in two spellings is one figure twice, never "2,400 240" and a stray "0" taken as a word.
  assert.deepEqual(literalsOf("2400 2,400 2400 2,400"), ["2400"]);
  assert.equal(wordsOf("2400 2,400 2400 2,400").trim(), "");
});

test("accents and capitals fold away", () => {
  assert.equal(fold("Café"), "cafe");
  assert.equal(fold("Ångström NAÏVE"), "angstrom naive");
});
