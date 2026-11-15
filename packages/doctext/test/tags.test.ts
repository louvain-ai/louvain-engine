import assert from "node:assert/strict";
import test from "node:test";
import { attrValue } from "../src/tag-attrs.js";
import { firstElement, xmlElements, xmlTagAttrs } from "../src/tag-elements.js";
import { xmlTokens } from "../src/tags.js";
import { xmlText } from "../src/xml.js";
import { referenceXmlText } from "./reference/regex-xml.js";

/**
 * The linear tokenizer (`tags.ts`): what it does at the edges, and that on well-formed XML it reads exactly what a
 * regex scanner reads (`test/reference/regex-xml.ts`, kept only for this comparison).
 */

const kinds = (xml: string) =>
  [...xmlTokens(xml)].map((t) =>
    t.kind === "tag"
      ? `${t.closing ? "/" : ""}${t.name}${t.selfClosing ? "/" : ""}${t.attrs ? `[${t.attrs}]` : ""}`
      : t.kind === "gap"
        ? "gap"
        : `${t.kind}:${xml.slice(t.start, t.end)}`,
  );

test("a tag's attributes may hold a quoted `>`; a self-closing tag says so", () => {
  assert.deepEqual(kinds(`<a b="x>y" c='1>2'/>z`), [`a/[ b="x>y" c='1>2']`, "text:z"]);
});

test("a stray `<` that opens nothing is a character of the text", () => {
  assert.deepEqual(kinds("a < b <3 c"), ["text:a ", "text:<", "text: b ", "text:<", "text:3 c"]);
  assert.equal(xmlText("<p>a < b</p>"), "a < b");
});

test("CDATA is text, taken as written; comments, instructions and declarations separate text", () => {
  assert.deepEqual(kinds("x<![CDATA[<b>]]>y<!-- c -->z<?pi?>w<!DOCTYPE d>v"), [
    "text:x",
    "cdata:<b>",
    "text:y",
    "gap",
    "text:z",
    "gap",
    "text:w",
    "gap",
    "text:v",
  ]);
});

test("markup with no terminator ends the text: nothing after it is read", () => {
  // Each terminator is absent from everything after it, so the tail (text and tags) is dropped.
  for (const tail of ["<!-- never closed", "<![CDATA[ never", "<?pi never", `<a b="never`])
    assert.equal(
      xmlText(`<p>kept</p>${tail} <p>dropped</p>`, { breakAfter: new Set(["p"]) }),
      "kept\n",
    );
  // A tag with no `>` anywhere after it: the text after it is dropped too.
  assert.equal(
    xmlText("<p>kept</p><a never closed, dropped", { breakAfter: new Set(["p"]) }),
    "kept\n",
  );
});

test("nested elements of one name end at the first close, as the lazy patterns did", () => {
  const [outer] = [...xmlElements("<row><row>a</row>b</row><row>c</row>", "row")];
  assert.equal(outer?.inner, "<row>a");
  assert.equal(firstElement("<x/><x>2</x>", "x")?.selfClosing, true);
  assert.deepEqual(
    [...xmlElements("<row>open", "row")],
    [],
    "an element never closed yields nothing",
  );
});

test("attributes are read by name after whitespace: `xr:r` is not `r`, and `r:id` is its own name", () => {
  const attrs = ` xr:r="wrong" r="C3" r:id="rId7" data-r="no"`;
  assert.equal(attrValue(attrs, "r"), "C3");
  assert.equal(attrValue(attrs, "r:id"), "rId7");
  assert.equal(attrValue(` data-r="no"`, "r"), undefined);
  assert.equal(attrValue(` r="unterminated`, "r"), undefined);
  assert.deepEqual([...xmlTagAttrs(`<w:c a="1"/><c b="2">x</c></c>`, "c")], [` a="1"`, ` b="2"`]);
});

/** Seeded, so a failure is the same document every run. */
function generator(seed: number) {
  let s = seed;
  const r = () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
  const pick = <T>(a: readonly T[]): T => a[Math.floor(r() * a.length)] as T;
  const names = ["w:p", "w:t", "w:tab", "p", "span", "style", "w:instrText", "c", "v", "a:t"];
  const words = [
    "hello",
    "a &amp; b",
    "x &lt; y",
    "caf&#233;",
    "tab\there",
    "Q3 > Q2",
    "“quoted”",
    " ",
  ];
  const el = (depth: number): string => {
    const n = pick(names);
    const attrs = r() < 0.5 ? ` a="1" b='x>y' c="${pick(["", "z/", "&amp;"])}"` : "";
    if (r() < 0.15) return `<${n}${attrs}/>`;
    let inner = "";
    for (let i = Math.floor(r() * 4); i > 0; i--) {
      const t = r();
      if (t < 0.4) inner += pick(words);
      else if (t < 0.5) inner += "<!-- note > here -->";
      else if (t < 0.55) inner += "<![CDATA[raw & text]]>";
      else if (t < 0.6) inner += '<?pi x="1"?>';
      else if (depth < 4) inner += el(depth + 1);
    }
    return `<${n}${attrs}>${inner}</${n}>`;
  };
  return () => `<?xml version="1.0"?><!DOCTYPE x>${el(0)}${el(0)}`;
}

test("on well-formed XML the tokenizer reads exactly what the regex scanner read (seeded, 2,000 documents)", () => {
  const rules = {
    breakAfter: new Set(["p"]),
    tabAfter: new Set(["tab"]),
    skip: new Set(["style", "instrtext"]),
  };
  const next = generator(7);
  for (let i = 0; i < 2_000; i++) {
    const doc = next();
    assert.equal(xmlText(doc, rules), referenceXmlText(doc, rules), doc);
  }
});

test("a document's references read as HTML reads them: every name, Windows-1252 numerics, once (reader 2)", () => {
  assert.equal(
    xmlText("<w:p><w:t>Caf&eacute; &laquo;Q3&raquo; don&#146;t &#38;lt;b&#38;gt;</w:t></w:p>", {
      breakAfter: new Set(["p"]),
    }),
    "Café «Q3» don’t &lt;b&gt;\n",
  );
});

/**
 * No reader matches markup with a pattern. The work counter (`engine-core/test/work.ts`) cannot see a
 * regular expression backtracking inside one call, which is how a pattern goes quadratic while counting as one
 * linear pass, so the timing floods in `bounds.test.ts` pass on it. So this is a source check: every pattern literal that starts at a `<` in the Office
 * readers is one of the few listed here, each linear by construction (a sticky name, a split on one fixed tag, an
 * escape). A new one belongs in the tokenizer (`tags.ts`); one that must be a pattern is added here with why.
 */
test("the Office readers match no markup with a regular expression", async () => {
  const { readFileSync } = await import("node:fs");
  const allowed: Record<string, string[]> = {
    // The tokenizer's own sticky name read: one position, never retried.
    "tags.ts": ["/<(\\/?)([A-Za-z_][\\w.:-]*)/y"],
    // The zip readers (every `zip*.ts` is read, below; these are the ones that allow a literal). The shared-strings
    // split on one fixed tag (`split` scans once).
    "zip-sheet-parts.ts": ["/<(?:\\w+:)?si>/", "/<\\/(?:\\w+:)?si>/"],
    "xml.ts": [],
    "tag-elements.ts": [],
    "tag-attrs.ts": [],
  };
  // Every zip module is read, whether or not it is listed: a new one cannot slip past by not being named.
  const { readdirSync } = await import("node:fs");
  const zips = readdirSync(new URL("../src/", import.meta.url)).filter((f) =>
    /^zip(-[\w-]+)?\.ts$/.test(f),
  );
  assert.ok(zips.length >= 2, "the zip modules were found");
  for (const listed of Object.keys(allowed))
    if (listed.startsWith("zip"))
      assert.ok(zips.includes(listed), `${listed} is listed but does not exist`);
  for (const file of zips) allowed[file] ??= [];
  for (const [file, ok] of Object.entries(allowed)) {
    const source = readFileSync(new URL(`../src/${file}`, import.meta.url), "utf8");
    const code = source
      .split("\n")
      .filter((line) => !/^\s*(\*|\/\/|\/\*\*)/.test(line))
      .join("\n");
    const found = [...code.matchAll(/(?<![\w)\]])\/<(?:\\\/|[^/\n])*\/[gimsuy]*/g)].map(
      (m) => m[0],
    );
    const stray = found.filter((literal) => !ok.includes(literal));
    assert.deepEqual(stray, [], `${file}: a markup pattern outside the tokenizer`);
    assert.ok(!/new RegExp\([`"']</.test(code), `${file}: a markup pattern built at run time`);
  }
});
