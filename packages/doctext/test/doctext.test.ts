import assert from "node:assert/strict";
import test from "node:test";
import { classifyFile, extractText } from "../src/index.js";
import { tidy } from "../src/plain.js";
import {
  makeDocx,
  makeEpub,
  makeHtml,
  makeOdt,
  makePdf,
  makePlainZip,
  makePptx,
  makeRtf,
  makeXlsx,
  NEEDLE,
  TITLE,
  zipSync,
} from "./fixtures.js";
import { looksReadable } from "./looks-readable.js";

const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);

/**
 * Every assertion here is a claim the package's docstrings make. The one
 * repeated across every format is that the figure survives verbatim: a reader
 * that returns "195,000" from a file that says "GBP 195,000." would have the
 * verifier strike the only number in the answer, and a document extracted into
 * something almost right is worse than one not extracted at all.
 */

test("pdf: the text of a real content stream, with the page count", async () => {
  const result = await extractText(makePdf([TITLE, NEEDLE, "Signed 3 September 2026."]), {
    filename: "renewal.pdf",
  });
  assert.equal(result.kind, "pdf");
  assert.ok(result.text.includes(NEEDLE), result.text);
  assert.ok(result.text.includes("Signed 3 September 2026."));
  assert.equal(result.meta.pages, 1);
  assert.equal(result.reason, undefined);
});

test("pdf: no text layer is reported, not returned as empty", async () => {
  const result = await extractText(makePdf([]), { filename: "scan.pdf" });
  assert.equal(result.kind, "pdf");
  assert.equal(result.meta.noTextLayer, true);
  assert.equal(result.reason, undefined, "a scan is a readable file with no text, not a failure");
});

test("docx: paragraphs, table rows on one line, footnotes, and no tracked deletions", async () => {
  const result = await extractText(makeDocx(), { filename: "renewal.docx" });
  assert.equal(result.kind, "docx");
  assert.ok(result.text.includes(NEEDLE), result.text);
  assert.ok(
    result.text.includes("Notice period\t90 days"),
    `a table row must stay one line: ${JSON.stringify(result.text)}`,
  );
  assert.ok(result.text.includes("Fees are reviewed annually by Jay Harlow."), "footnote");
  assert.ok(!result.text.includes("MERGEFIELD"), "a field code is not text anybody wrote");
  assert.ok(
    !result.text.includes("250,000"),
    "deleted text under tracked changes is history, not content",
  );
  assert.equal(result.meta.tables, 1);
});

test("xlsx: every sheet, named, with cached values and never a formula", async () => {
  const result = await extractText(makeXlsx(), { filename: "renewals.xlsx" });
  assert.equal(result.kind, "xlsx");
  assert.ok(result.text.includes(NEEDLE), result.text);
  assert.ok(result.text.includes("Owner is Jay Harlow"), "the second sheet is read");
  assert.deepEqual(result.meta.sheets, ["Renewals", "Notes"]);
  assert.ok(result.text.includes("## Renewals"), "a sheet is named");
  assert.ok(result.text.includes("Notice period\t90"), "a row stays one line");
  assert.ok(!result.text.includes("B3*2"), "a formula is not a fact anybody stated");
  assert.ok(result.text.includes("180"), "its cached value is");
});

test("pptx: slides in order, with the speaker notes", async () => {
  const result = await extractText(makePptx(), { filename: "deck.pptx" });
  assert.equal(result.kind, "pptx");
  assert.ok(result.text.includes(NEEDLE), result.text);
  assert.ok(result.text.includes("Confirm the discount with legal."), "notes pane");
  assert.equal(result.meta.slides, 2);
  assert.ok(
    result.text.indexOf("## Slide 1") < result.text.indexOf("## Slide 2"),
    "slides keep their order",
  );
});

const STYLE_ID = "{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}";

/** One slide: a text box with `box`, then a styled table the way PowerPoint writes it (style id as element text). */
function tableDeck(box: string): Uint8Array {
  const cell = (t: string): string =>
    `<a:tc><a:txBody><a:p><a:r><a:t>${t}</a:t></a:r></a:p></a:txBody><a:tcPr/></a:tc>`;
  const row = (...c: string[]): string => `<a:tr h="370840">${c.map(cell).join("")}</a:tr>`;
  const slide = `<?xml version="1.0"?><p:sld xmlns:a="x" xmlns:p="y"><p:cSld><p:spTree>
<p:sp><p:txBody><a:p><a:r><a:t>${box}</a:t></a:r></a:p></p:txBody></p:sp>
<p:graphicFrame><a:graphic><a:graphicData><a:tbl>
<a:tblPr firstRow="1" bandRow="1"><a:tableStyleId>${STYLE_ID}</a:tableStyleId></a:tblPr>
<a:tblGrid><a:gridCol w="1"/><a:gridCol w="1"/></a:tblGrid>
${row("Metric", "Q3 2026")}${row("Revenue", "EUR 18.4M")}
</a:tbl></a:graphicData></a:graphic></p:graphicFrame>
</p:spTree></p:cSld></p:sld>`;
  return zipSync({ "ppt/slides/slide1.xml": utf8(slide) });
}

test("pptx: a styled table reads its cells in order, never its style id", async () => {
  const result = await extractText(tableDeck("Q3 in numbers"), { filename: "deck.pptx" });
  assert.ok(!result.text.includes(STYLE_ID), result.text);
  assert.ok(!result.text.includes("5C22544A"), result.text);
  assert.ok(
    result.text.includes("Metric\tQ3 2026\t\nRevenue\tEUR 18.4M\t") ||
      result.text.indexOf("Metric") < result.text.indexOf("Q3 2026"),
    result.text,
  );
  const order = ["Q3 in numbers", "Metric", "Q3 2026", "Revenue", "EUR 18.4M"].map((w) =>
    result.text.indexOf(w),
  );
  assert.ok(
    order.every((at, i) => at >= 0 && (i === 0 || at > (order[i - 1] ?? 0))),
    result.text,
  );
});

test("pptx: an identifier a person typed on a slide is content and stays", async () => {
  const result = await extractText(tableDeck(`Ref ${STYLE_ID}`), { filename: "deck.pptx" });
  assert.equal(result.text.split(STYLE_ID).length - 1, 1, result.text);
  assert.ok(result.text.includes(`Ref ${STYLE_ID}`), result.text);
});

/** `mc:AlternateContent`: one piece of content in two forms. `branches` is the block's inside. */
const alternate = (branches: string): string =>
  `<mc:AlternateContent>${branches}</mc:AlternateContent>`;
const choice = (inner: string): string => `<mc:Choice Requires="wps">${inner}</mc:Choice>`;
const fallback = (inner: string): string => `<mc:Fallback>${inner}</mc:Fallback>`;
const slideP = (t: string): string => `<a:p><a:r><a:t>${t}</a:t></a:r></a:p>`;
const wordP = (t: string): string => `<w:p><w:r><w:t>${t}</w:t></w:r></w:p>`;

async function slideRead(body: string): Promise<string> {
  const slide = `<p:sld xmlns:a="x" xmlns:p="y" xmlns:mc="z"><p:cSld><p:spTree>${body}</p:spTree></p:cSld></p:sld>`;
  const bytes = zipSync({ "ppt/slides/slide1.xml": utf8(slide) });
  const read = await extractText(bytes, { filename: "deck.pptx" });
  return read.text;
}

async function wordRead(body: string): Promise<string> {
  const document = `<w:document xmlns:w="w" xmlns:mc="z" xmlns:v="v"><w:body>${body}</w:body></w:document>`;
  return (
    await extractText(zipSync({ "word/document.xml": utf8(document) }), { filename: "a.docx" })
  ).text;
}

const count = (text: string, word: string): number => text.split(word).length - 1;

test("pptx: alternate content reads once, the Fallback only when the Choice has no words", async () => {
  const box = (t: string): string => `<p:sp><p:txBody>${slideP(t)}</p:txBody></p:sp>`;
  const twice = await slideRead(alternate(choice(box("Q3 plan")) + fallback(box("Q3 plan"))));
  assert.equal(count(twice, "Q3 plan"), 1, twice);
  const graphic = await slideRead(
    alternate(
      choice("<p:graphicFrame><a:graphic/></p:graphicFrame>") + fallback(box("Words only here")),
    ),
  );
  assert.equal(count(graphic, "Words only here"), 1, graphic);
  const nested = await slideRead(
    alternate(
      choice(box("Outer") + alternate(choice(box("Inner")) + fallback(box("Inner")))) +
        fallback(box("Outer")),
    ),
  );
  assert.equal(count(nested, "Outer"), 1, nested);
  assert.equal(count(nested, "Inner"), 1, nested);
  const deep = await slideRead(
    alternate(
      choice("<p:pic/>") + fallback(alternate(choice("<p:pic/>") + fallback(box("Deep words")))),
    ),
  );
  assert.equal(count(deep, "Deep words"), 1, deep);
});

test("docx: a text box written twice (DrawingML and VML) reads once", async () => {
  const run = (inner: string): string => `<w:p><w:r>${inner}</w:r></w:p>`;
  const twice = await wordRead(
    run(
      alternate(
        choice(`<w:drawing><w:txbxContent>${wordP("Boxed")}</w:txbxContent></w:drawing>`) +
          fallback(
            `<w:pict><v:textbox><w:txbxContent>${wordP("Boxed")}</w:txbxContent></v:textbox></w:pict>`,
          ),
      ),
    ) + wordP("After"),
  );
  assert.equal(count(twice, "Boxed"), 1, twice);
  assert.ok(twice.includes("After"), twice);
  const only = await wordRead(
    run(
      alternate(choice("<w:drawing/>") + fallback(`<w:pict>${wordP("Fallback words")}</w:pict>`)),
    ),
  );
  assert.equal(count(only, "Fallback words"), 1, only);
  const nested = await wordRead(
    run(
      alternate(
        choice(alternate(choice(wordP("Nest")) + fallback(wordP("Nest")))) +
          fallback(wordP("Nest")),
      ),
    ),
  );
  assert.equal(count(nested, "Nest"), 1, nested);
});

test("odf: an OpenDocument text file", async () => {
  const result = await extractText(makeOdt(), { filename: "renewal.odt" });
  assert.equal(result.kind, "odf");
  assert.ok(result.text.includes(NEEDLE), result.text);
});

test("epub: chapters, without the stylesheet", async () => {
  const result = await extractText(makeEpub(), { filename: "book.epub" });
  assert.equal(result.kind, "epub");
  assert.ok(result.text.includes(NEEDLE), result.text);
  assert.ok(!result.text.includes("crimson"), "a stylesheet is character data and is not text");
});

test("rtf: control words dropped, escapes resolved, tables not read as prose", async () => {
  const result = await extractText(makeRtf(), { filename: "renewal.rtf" });
  assert.equal(result.kind, "rtf");
  assert.ok(result.text.includes(NEEDLE), result.text);
  assert.ok(!result.text.includes("Times New Roman"), "the font table is not prose");
  assert.ok(result.text.includes("Jay Harlow™"), `\\'99 is cp1252: ${result.text}`);
});

test("html: block structure kept, script and style dropped", async () => {
  const result = await extractText(makeHtml(), { filename: "page.html" });
  assert.equal(result.kind, "html");
  assert.ok(result.text.includes(NEEDLE));
  assert.ok(!result.text.includes("tracker"), "a script is not text");
  assert.ok(!result.text.includes("color:red"));
});

test("csv, md and txt are read as themselves", async () => {
  const csv = await extractText(utf8(`term,value\nfee,"${NEEDLE}"\n`), {
    filename: "renewals.csv",
  });
  assert.equal(csv.kind, "text");
  assert.ok(csv.text.includes(NEEDLE));

  const md = await extractText(utf8(`# ${TITLE}\n\n${NEEDLE}\n`), { filename: "notes.md" });
  assert.ok(md.text.includes(NEEDLE));

  const txt = await extractText(utf8(NEEDLE), { filename: "notes.txt" });
  assert.ok(txt.text.includes(NEEDLE));
});

test("a file's bytes outrank its name and its declared type", async () => {
  // The expensive direction: a PDF decoded as text is a page of mojibake that
  // would be chunked, embedded and offered to a reader as evidence.
  const renamed = await extractText(makePdf([NEEDLE]), {
    filename: "actually-a-pdf.txt",
    mimeType: "text/plain",
  });
  assert.equal(renamed.kind, "pdf");
  assert.ok(renamed.text.includes(NEEDLE));

  // And the ordinary direction: a mail client that says octet-stream.
  const mislabelled = await extractText(makeDocx(), {
    filename: "renewal.docx",
    mimeType: "application/octet-stream",
  });
  assert.equal(mislabelled.kind, "docx");
  assert.ok(mislabelled.text.includes(NEEDLE));
});

test("a zip that is no known document defers to the name", async () => {
  const result = await extractText(makePlainZip(), { filename: "bundle.zip" });
  assert.equal(result.kind, "binary");
  assert.equal(result.reason, "unsupported-format");
});

test("legacy Office is refused by name, never decoded as text", async () => {
  const ole = new Uint8Array(64);
  ole.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  const result = await extractText(ole, { filename: "old.doc" });
  assert.equal(result.kind, "legacy-office");
  assert.equal(result.reason, "legacy-office");
  assert.equal(result.text, "");
  assert.match(result.detail ?? "", /97-2003/);
});

test("an image is unsupported rather than mojibake", async () => {
  const png = new Uint8Array([
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a,
    ...new Array(64).fill(0),
  ]);
  const result = await extractText(png, { filename: "photo.png", mimeType: "image/png" });
  assert.equal(result.kind, "binary");
  assert.equal(result.text, "");
  assert.equal(result.reason, "unsupported-format");
});

test("a damaged file answers, and never throws", async () => {
  const broken = await extractText(utf8("%PDF-1.4\nnot really a pdf at all"), {
    filename: "broken.pdf",
  });
  assert.equal(broken.kind, "pdf");
  assert.ok(broken.reason === "damaged" || broken.text === "", JSON.stringify(broken));

  const truncatedZip = await extractText(makeDocx().subarray(0, 40), {
    filename: "half.docx",
  });
  assert.ok(truncatedZip.reason !== undefined, JSON.stringify(truncatedZip));
});

test("the caps are answers about the file, not failures", async () => {
  const empty = await extractText(new Uint8Array(0), { filename: "nothing.txt" });
  assert.equal(empty.reason, "empty");

  const big = await extractText(utf8("x".repeat(2048)), {
    filename: "huge.txt",
    maxBytes: 1024,
  });
  assert.equal(big.reason, "too-large");
  assert.match(big.detail ?? "", /limit/);

  const long = await extractText(utf8(`${"filler line\n".repeat(500)}${NEEDLE}`), {
    filename: "long.txt",
    maxChars: 200,
  });
  assert.equal(long.truncated, true);
  assert.ok(long.text.length <= 200);
});

test("encodings: a BOM is evidence, and no file is dropped for its encoding", async () => {
  const bom = new Uint8Array([0xef, 0xbb, 0xbf, ...utf8("£195,000 per year")]);
  const result = await extractText(bom, { filename: "fee.txt" });
  assert.ok(result.text.startsWith("£195,000"), JSON.stringify(result.text));

  // cp1252 bytes: "caf\xe9" — invalid UTF-8, and must not be refused.
  const latin = new Uint8Array([0x63, 0x61, 0x66, 0xe9, 0x20, 0xa3, 0x39, 0x35]);
  const fallback = await extractText(latin, { filename: "note.txt" });
  assert.equal(fallback.reason, undefined);
  assert.ok(fallback.text.includes("café"), JSON.stringify(fallback.text));
});

test("looksReadable decides what is worth downloading, and errs towards looking", () => {
  assert.equal(looksReadable("contract.pdf", "application/pdf"), true);
  assert.equal(looksReadable("notes.md"), true);
  assert.equal(looksReadable("deck.pptx"), true);
  assert.equal(looksReadable("photo.png", "image/png"), false);
  assert.equal(looksReadable("clip.mp4", "video/mp4"), false);
  assert.equal(looksReadable("old.doc"), false, "no reader, so not worth the bytes");
  assert.equal(looksReadable("archive.zip", "application/zip"), false);
  assert.equal(
    looksReadable("report", ""),
    true,
    "an unknown name with no type is worth one download",
  );
});

test("classifyFile labels a file nobody downloaded", () => {
  assert.equal(classifyFile("q3.xlsx"), "xlsx");
  assert.equal(classifyFile("readme"), "text");
  assert.equal(classifyFile("a.bin", "application/octet-stream"), "binary");
  assert.equal(classifyFile("report", ""), "unknown", "no name, no type, no opinion");
  assert.equal(classifyFile(undefined, "application/pdf"), "pdf");
});

/**
 * The bug a hand-built fixture cannot have. A real PDF's text layer carries
 * NUL bytes — pdf.js emits U+0000 where a glyph maps to nothing — and Postgres
 * refuses U+0000 inside `jsonb`, so a document carrying one would be lost on
 * the accept path and nothing downstream would see it.
 */
test("a NUL in the text does not survive to the database", async () => {
  const hostile = "Compensation: \u00a390,000 to \u00a3130,000 \u0000\u0007\nSigned off today";
  const result = await extractText(utf8(hostile), { filename: "salary.txt" });
  // biome-ignore lint/suspicious/noControlCharactersInRegex: proving they are gone
  assert.ok(!/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(result.text), result.text);
  // Stripped, not cut: the words either side are untouched.
  assert.ok(result.text.includes("\u00a390,000 to \u00a3130,000"), result.text);
  assert.ok(result.text.includes("Signed off today"), result.text);
});

/**
 * A lone surrogate is a valid JavaScript string and not valid UTF-8, so it
 * fails at the same boundary as a NUL. Checked against `tidy` directly because
 * no byte sequence decodes to one — it can only arrive from a reader that
 * built the string itself, which is exactly what pdf.js does.
 */
test("a lone surrogate does not survive either", () => {
  const cleaned = tidy("Signed off\uD800 today, fee \u00a3195,000\uDC00.");
  assert.ok(
    !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(cleaned),
    JSON.stringify(cleaned),
  );
  assert.equal(cleaned, "Signed off today, fee \u00a3195,000.");
  assert.equal(JSON.parse(JSON.stringify({ t: cleaned })).t, cleaned);
});

// ————— locators —————
//
// The whole value of a locator is that the range it names contains the text a
// citation would point at. A locator that is merely present is worse than
// none: it would put a highlight on the wrong page of somebody's contract with
// every appearance of precision. So every check below slices the text with the
// locator's own offsets and reads what is there.

test("a PDF locator names the page its text is actually on", async () => {
  const result = await extractText(
    makePdf(["Renewal terms for Acme Corp", NEEDLE, "Signed 3 September 2026."]),
    { filename: "renewal.pdf" },
  );
  assert.equal(result.locators.length, 1, "one page, one locator");
  const [only] = result.locators;
  assert.equal(only?.page, 1);
  assert.ok(
    result.text.slice(only?.start, only?.end).includes(NEEDLE),
    JSON.stringify(result.text.slice(only?.start, only?.end)),
  );
});

test("a workbook gets one locator per sheet, each holding that sheet's own text", async () => {
  const result = await extractText(makeXlsx(), { filename: "renewals.xlsx" });
  assert.deepEqual(
    result.locators.map((l) => l.sheet),
    ["Renewals", "Notes"],
  );
  const [renewals, notes] = result.locators;
  const inRenewals = result.text.slice(renewals?.start, renewals?.end);
  const inNotes = result.text.slice(notes?.start, notes?.end);
  assert.ok(inRenewals.includes(NEEDLE), inRenewals);
  assert.ok(inNotes.includes("Owner is Jay Harlow"), inNotes);
  // And the sheets do not bleed into each other, which is the failure a
  // careless offset produces and a present-but-wrong locator hides.
  assert.ok(!inRenewals.includes("Owner is Jay Harlow"));
  assert.ok(!inNotes.includes(NEEDLE));
});

test("a deck gets one locator per slide, in order", async () => {
  const result = await extractText(makePptx(), { filename: "deck.pptx" });
  assert.deepEqual(
    result.locators.map((l) => l.slide),
    [1, 2],
  );
  const [first, second] = result.locators;
  assert.ok(result.text.slice(first?.start, first?.end).includes(NEEDLE));
  assert.ok(result.text.slice(second?.start, second?.end).includes("Next steps"));
  assert.ok((first?.end ?? 0) <= (second?.start ?? 0), "ranges do not overlap");
});

test("a format with no pages has no locators, and needs none", async () => {
  for (const [name, bytes] of [
    ["notes.txt", utf8(NEEDLE)],
    ["renewal.docx", makeDocx()],
  ] as const) {
    const result = await extractText(bytes, { filename: name });
    assert.deepEqual(result.locators, [], `${name} is one flow of text`);
  }
});

test("the character cap moves no locator and leaves none pointing past the end", async () => {
  const long = await extractText(makePdf([NEEDLE, "filler ".repeat(200)]), {
    filename: "long.pdf",
    maxChars: 60,
  });
  assert.equal(long.truncated, true);
  for (const locator of long.locators) {
    assert.ok(locator.end <= long.text.length, `${locator.end} > ${long.text.length}`);
    assert.ok(locator.start < locator.end, "an empty range is not a range");
  }
});
