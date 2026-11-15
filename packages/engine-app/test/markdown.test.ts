import assert from "node:assert/strict";
import { it } from "node:test";
import { Lexer } from "marked";
import { citations } from "../web/cite.js";
import { blocks, type Tree } from "../web/md-tree.js";
import type { Token } from "../web/md-types.js";

/** The lexer the page loads, from the same package, read as the page reads it. */
const lex = (md: string) => Lexer.lex(md, { gfm: true }) as unknown as Token[];

const REF = "ab12cd34ef";
const OTHER = "0123456789";
const known = (ref: string) => ref === REF || ref === OTHER;
const tree = (md: string) => blocks(lex(md), known);

/** Every element a tree names, every key a node carries, and its text, in order. */
function walk(nodes: Tree[], seen = { tags: [] as string[], keys: new Set<string>(), text: "" }) {
  for (const n of nodes) {
    if (typeof n === "string") seen.text += n;
    else {
      for (const k of Object.keys(n)) seen.keys.add(k);
      if ("tag" in n) seen.tags.push(n.tag);
      if ("glue" in n) seen.text += `${n.glue}{${n.cite.join(",")}}`;
      if ("kids" in n) walk(n.kids, seen);
    }
  }
  return seen;
}

it("an answer's markdown: draws the elements an answer may use", () => {
  const md = `# Lease\n\n**Renews** on *1 September* [${REF}].\n\n- one\n- two\n\n3. three\n\n| a | b |\n|---|--:|\n| 1 | 2 |\n\n> quoted\n\n\`\`\`\ncode [${REF}]\n\`\`\`\n\n---`;
  assert.deepEqual(walk(tree(md)).tags, [
    ...[
      "h3",
      "p",
      "strong",
      "em",
      "ul",
      "li",
      "li",
      "ol",
      "li",
      "table",
      "thead",
      "tr",
      "th",
      "th",
    ],
    ...["tbody", "tr", "td", "td", "blockquote", "p", "pre", "code", "hr"],
  ]);
  const ol = tree("3. three\n4. four")[0];
  assert.ok(ol && typeof ol === "object" && "tag" in ol && ol.start === 3);
});

it("an answer's markdown: makes nothing an element or an attribute that the answer planted", () => {
  const planted = [
    '<img src=x onerror="alert(1)"> <script>alert(2)</script>',
    "[click me](javascript:alert(3)) and ![pic](https://example.com/x.png)",
    `<div style="color:red">styled</div>`,
    `[${REF}](javascript:alert(4)) and [${REF}]"><a href="x">`,
    `<span class="cited">[${REF}</span>]`,
    "[unknown](0000000000) and [link](https://example.com)",
  ].join("\n\n");
  const seen = walk(tree(planted));
  assert.deepEqual([...new Set(seen.tags)].sort(), ["p"]);
  assert.deepEqual([...seen.keys].sort(), ["cite", "glue", "kids", "tag"]);
  for (const raw of ["<img src=x", "<script>", "<div style", '<a href="x">'])
    assert.ok(seen.text.includes(raw), `${raw} stays text`);
  assert.ok(!seen.text.includes("javascript:"), "a link elsewhere is its words alone");
});

it("an answer's markdown: links only to a source shown in this answer", () => {
  assert.deepEqual(tree(`see [the lease](${REF}) and [that](0000000000)`), [
    { tag: "p", kids: ["see ", { open: REF, kids: ["the lease"] }, " and ", "that"] },
  ]);
});

const placed = (text: string) =>
  citations(text, known)
    .map((p) => (typeof p === "string" ? p : `${p.glue}{${p.refs.join(",")}}`))
    .join("");
const cases: [string, string, string][] = [
  ["before a full stop", `the hardware lab [${REF}].`, "the hardware lab.{ab12cd34ef}"],
  ["before a comma", `by 1 August [${REF}], then`, "by 1 August,{ab12cd34ef} then"],
  ["before a closing bracket", `(the lab [${REF}])`, "(the lab){ab12cd34ef}"],
  ["at the end of a line", `the lab [${REF}]`, "the lab{ab12cd34ef}"],
  ["two in a row", `the lab [${REF}] [${OTHER}].`, "the lab.{ab12cd34ef,0123456789}"],
  ["two in one bracket", `the lab [${REF}, ${OTHER}].`, "the lab.{ab12cd34ef,0123456789}"],
  ["a ref not shown stays", "the lab [ffffffffff].", "the lab [ffffffffff]."],
];
for (const [name, text, want] of cases) it(name, () => assert.equal(placed(text), want));

it("where a citation sits: holds in a list item and a table cell", () => {
  const seen = walk(tree(`- the lab [${REF}].\n\n| a |\n|---|\n| lab [${REF}]. |`));
  assert.equal(seen.text, "the lab.{ab12cd34ef}alab.{ab12cd34ef}");
});
