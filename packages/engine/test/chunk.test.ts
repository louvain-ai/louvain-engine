import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { chunk } from "../src/ingest/cut.js";
import { openPassageRules } from "../src/ingest/passage-rules.js";

/**
 * A document is cut into the same passages every time: what is embedded and indexed is these exact strings, so a
 * change to the cut is a change to every index built from it. Each case pins the pieces' lengths and a hash of the
 * pieces themselves, under the open build's rules: a text is one part.
 */
const paragraph = (n: number) =>
  `Paragraph ${n} opens with a plain claim about the quarterly plan. It goes on for a while, naming the people who own each part and the dates they promised. A third sentence adds the budget, the risks and what happens if the supplier is late! Is the fourth one a question? It ends here.`;

const CASES: Record<string, string> = {
  "a short message is one passage, its whitespace folded": "Hello  team,\n\nthe deploy is   done.",
  "a multi-paragraph document is cut at sentences with an overlap": Array.from(
    { length: 9 },
    (_, i) => paragraph(i + 1),
  ).join("\n\n"),
  "a sentence longer than a passage is cut at its lines, then between words": `${"word ".repeat(400)}\n${"line ".repeat(50)}`,
  "a sheet with no sentence ends is cut at its lines": Array.from(
    { length: 120 },
    (_, i) => `row ${i},alpha,beta,gamma,${i * 7},delta`,
  ).join("\n"),
  "a mail's footer is cut with its message: the open build knows no mail": `${paragraph(1)}\n\n--\nUnsubscribe | Privacy Policy | Preferences\nSent from the mail service, 1 Example Street`,
};

const pin = (text: string) => {
  const pieces = chunk(openPassageRules, text);
  return {
    lengths: pieces.map((p) => p.length),
    hash: createHash("sha256").update(JSON.stringify(pieces)).digest("hex").slice(0, 16),
  };
};

const EXPECTED: Record<string, { lengths: number[]; hash: string }> = {
  "a short message is one passage, its whitespace folded": {
    lengths: [31],
    hash: "38944ad7d7e4bec1",
  },
  "a multi-paragraph document is cut at sentences with an overlap": {
    lengths: [845, 828, 871, 334],
    hash: "2f873f10218d7cb8",
  },
  "a sentence longer than a passage is cut at its lines, then between words": {
    lengths: [779, 899, 809],
    hash: "b73115b169c59f93",
  },
  "a sheet with no sentence ends is cut at its lines": {
    lengths: [890, 883, 883, 883, 867, 174],
    hash: "46823c69007aae62",
  },
  "a mail's footer is cut with its message: the open build knows no mail": {
    lengths: [372],
    hash: "cb099c00de7ea816",
  },
};

for (const [name, text] of Object.entries(CASES))
  test(name, () => {
    assert.deepEqual(pin(text), EXPECTED[name]);
  });
