import { zipSync } from "fflate";

/**
 * Real files of every supported format, built here.
 *
 * Nothing is checked in as a binary, for two reasons. A committed .docx is a
 * fixture nobody can read in a diff, so a change to it is invisible in review;
 * and a fixture produced by the same library that parses it can hide a
 * round-trip agreement a real document would not share. These are assembled
 * from the format specifications' own structure — a .docx really is
 * `word/document.xml` in a zip — which is what the reader has to cope with.
 */

/** The sentence every fixture carries, checked for verbatim. */
export const NEEDLE = "The annual fee is GBP 195,000.";
export const TITLE = "Renewal terms for Acme Corp";

const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);

/**
 * A minimal, valid, one-page PDF with a real Helvetica content stream.
 *
 * Hand-built because no dependency here can write one, and because what pdf.js
 * has to read on the way in is a content stream of `Tj` operators — which is
 * exactly what a word processor emits.
 */
export function makePdf(lines: string[]): Uint8Array {
  const literal = (line: string): string =>
    line.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
  const content = `BT /F1 12 Tf 72 720 Td 14 TL\n${lines
    .map((line) => `(${literal(line)}) Tj T*`)
    .join("\n")}\nET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] " +
      "/Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, index) => {
    offsets.push(out.length);
    out += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) out += `${String(offset).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return utf8(out);
}

/** A PDF of several pages, one content stream each — for the page and time bounds. */
export function makePdfPages(pages: string[][]): Uint8Array {
  const literal = (line: string): string =>
    line.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
  const font = 3 + pages.length * 2;
  const objects: string[] = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${pages.map((_, i) => `${3 + i * 2} 0 R`).join(" ")}] /Count ${pages.length} >>`,
  ];
  pages.forEach((lines, i) => {
    const content = `BT /F1 12 Tf 72 720 Td 14 TL\n${lines
      .map((line) => `(${literal(line)}) Tj T*`)
      .join("\n")}\nET`;
    objects.push(
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] " +
        `/Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${4 + i * 2} 0 R >>`,
      `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    );
  });
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, index) => {
    offsets.push(out.length);
    out += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) out += `${String(offset).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return utf8(out);
}

/**
 * Hostile archives, built here for the same reason the documents are: a zip
 * bomb checked in is a fixture nobody can read in a diff. Each starts as a
 * real zip and then has its central directory rewritten — which is all an
 * attacker has to do, because the directory is where a reader learns sizes.
 */
export function withDeclaredSize(
  zip: Uint8Array,
  name: string,
  sizes: { declared?: number; compressed?: number },
): Uint8Array {
  const out = zip.slice();
  const view = new DataView(out.buffer);
  const target = new TextEncoder().encode(name);
  for (let at = 0; at + 46 <= out.byteLength; at++) {
    if (view.getUint32(at, true) !== 0x02014b50) continue;
    const length = view.getUint16(at + 28, true);
    const found = out.subarray(at + 46, at + 46 + length);
    if (found.length !== target.length || !found.every((b, i) => b === target[i])) continue;
    if (sizes.compressed !== undefined) view.setUint32(at + 20, sizes.compressed, true);
    if (sizes.declared !== undefined) view.setUint32(at + 24, sizes.declared, true);
    return out;
  }
  throw new Error(`no central directory entry for ${name}`);
}

export { zipSync };

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';

export function makeDocx(): Uint8Array {
  const paragraph = (text: string): string =>
    `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
  const cell = (text: string): string => `<w:tc>${paragraph(text)}</w:tc>`;
  const document = `<?xml version="1.0" encoding="UTF-8"?>
<w:document ${W}><w:body>
${paragraph(TITLE)}
${paragraph(NEEDLE)}
<w:p><w:r><w:instrText>MERGEFIELD Recipient</w:instrText></w:r></w:p>
<w:p><w:del><w:r><w:t>The annual fee is GBP 250,000.</w:t></w:r></w:del></w:p>
<w:tbl>
<w:tr>${cell("Term")}${cell("Value")}</w:tr>
<w:tr>${cell("Notice period")}${cell("90 days")}</w:tr>
</w:tbl>
</w:body></w:document>`;
  const footnotes = `<?xml version="1.0"?><w:footnotes ${W}>${paragraph(
    "Fees are reviewed annually by Jay Harlow.",
  )}</w:footnotes>`;
  return zipSync({
    "[Content_Types].xml": utf8('<?xml version="1.0"?><Types/>'),
    "word/document.xml": utf8(document),
    "word/footnotes.xml": utf8(footnotes),
  });
}

export function makeXlsx(): Uint8Array {
  const shared = ["Renewals", TITLE, NEEDLE, "Notice period", "Owner is Jay Harlow"];
  const sst = `<?xml version="1.0"?><sst count="${shared.length}" uniqueCount="${shared.length}">${shared
    .map((s) => `<si><t>${s}</t></si>`)
    .join("")}</sst>`;
  const sheet1 = `<?xml version="1.0"?><worksheet><sheetData>
<row r="1"><c r="A1" t="s"><v>1</v></c></row>
<row r="2"><c r="A2" t="s"><v>2</v></c></row>
<row r="3"><c r="A3" t="s"><v>3</v></c><c r="B3"><v>90</v></c></row>
<row r="4"><c r="B4"><f>B3*2</f><v>180</v></c></row>
</sheetData></worksheet>`;
  const sheet2 = `<?xml version="1.0"?><worksheet><sheetData>
<row r="1"><c r="A1" t="s"><v>4</v></c></row>
</sheetData></worksheet>`;
  return zipSync({
    "xl/workbook.xml": utf8(
      '<?xml version="1.0"?><workbook xmlns:r="x"><sheets>' +
        '<sheet name="Renewals" sheetId="1" r:id="rId1"/>' +
        '<sheet name="Notes" sheetId="2" r:id="rId2"/>' +
        "</sheets></workbook>",
    ),
    "xl/_rels/workbook.xml.rels": utf8(
      '<?xml version="1.0"?><Relationships>' +
        '<Relationship Id="rId1" Target="worksheets/sheet1.xml"/>' +
        '<Relationship Id="rId2" Target="worksheets/sheet2.xml"/>' +
        "</Relationships>",
    ),
    "xl/sharedStrings.xml": utf8(sst),
    "xl/worksheets/sheet1.xml": utf8(sheet1),
    "xl/worksheets/sheet2.xml": utf8(sheet2),
  });
}

export function makePptx(): Uint8Array {
  const slide = `<?xml version="1.0"?><p:sld xmlns:a="x" xmlns:p="y"><p:cSld><p:spTree>
<p:sp><p:txBody><a:p><a:r><a:t>${TITLE}</a:t></a:r></a:p></p:txBody></p:sp>
<p:sp><p:txBody><a:p><a:r><a:t>${NEEDLE}</a:t></a:r></a:p></p:txBody></p:sp>
</p:spTree></p:cSld></p:sld>`;
  const notes = `<?xml version="1.0"?><p:notes xmlns:a="x" xmlns:p="y"><p:cSld><p:spTree>
<p:sp><p:txBody><a:p><a:r><a:t>Confirm the discount with legal.</a:t></a:r></a:p></p:txBody></p:sp>
</p:spTree></p:cSld></p:notes>`;
  const second = `<?xml version="1.0"?><p:sld xmlns:a="x" xmlns:p="y"><p:cSld><p:spTree>
<p:sp><p:txBody><a:p><a:r><a:t>Next steps</a:t></a:r></a:p></p:txBody></p:sp>
</p:spTree></p:cSld></p:sld>`;
  return zipSync({
    "ppt/presentation.xml": utf8('<?xml version="1.0"?><p:presentation xmlns:p="y"/>'),
    "ppt/slides/slide1.xml": utf8(slide),
    "ppt/slides/slide2.xml": utf8(second),
    "ppt/notesSlides/notesSlide1.xml": utf8(notes),
  });
}

export function makeOdt(): Uint8Array {
  const content = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-content
  xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"
  xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0">
<office:body><office:text>
<text:h>${TITLE}</text:h><text:p>${NEEDLE}</text:p>
</office:text></office:body></office:document-content>`;
  return zipSync({
    mimetype: utf8("application/vnd.oasis.opendocument.text"),
    "content.xml": utf8(content),
  });
}

export function makeEpub(): Uint8Array {
  const chapter = `<html><head><title>x</title><style>p{color:crimson}</style></head>
<body><h1>${TITLE}</h1><p>${NEEDLE}</p></body></html>`;
  return zipSync({
    mimetype: utf8("application/epub+zip"),
    "OEBPS/content.opf": utf8('<?xml version="1.0"?><package/>'),
    "OEBPS/ch1.xhtml": utf8(chapter),
  });
}

export function makeRtf(): Uint8Array {
  return utf8(
    "{\\rtf1\\ansi\\ansicpg1252\\deff0" +
      "{\\fonttbl{\\f0\\froman Times New Roman;}}" +
      "{\\colortbl;\\red0\\green0\\blue0;}" +
      `\\f0\\fs24 ${TITLE}\\par\n${NEEDLE}\\par\n` +
      "Signed by Jay Harlow\\'99s office.\\par\n}",
  );
}

export function makeHtml(): Uint8Array {
  return utf8(
    `<html><head><style>body{color:red}</style><script>var tracker=1</script></head>` +
      `<body><h1>${TITLE}</h1><p>${NEEDLE}</p><!-- an internal note --></body></html>`,
  );
}

/** A zip that is not any known document format. */
export function makePlainZip(): Uint8Array {
  return zipSync({ "notes.txt": utf8(NEEDLE) });
}

/**
 * A letter as people write one in Word: a title, headings, bold and italic, a bulleted list with a nested item, a
 * numbered list, a table, one hidden run, and characters Markdown would read as formatting. Names are invented.
 */
export function makeLetterDocx(): Uint8Array {
  const run = (text: string, props = ""): string =>
    `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ""}<w:t xml:space="preserve">${text}</w:t></w:r>`;
  const para = (runs: string, props = ""): string =>
    `<w:p>${props ? `<w:pPr>${props}</w:pPr>` : ""}${runs}</w:p>`;
  const styled = (style: string, text: string): string =>
    para(run(text), `<w:pStyle w:val="${style}"/>`);
  const item = (num: number, level: number, text: string): string =>
    para(run(text), `<w:numPr><w:ilvl w:val="${level}"/><w:numId w:val="${num}"/></w:numPr>`);
  const cell = (text: string): string => `<w:tc>${para(run(text))}</w:tc>`;
  const document = `<?xml version="1.0" encoding="UTF-8"?>
<w:document ${W}><w:body>
${styled("Title", "Letter of intent")}
${para(run("Between ") + run("Northwind Trading Ltd", "<w:b/>") + run(" and ") + run("Harbour Lane Partners", "<w:i/>") + run("."))}
${styled("Heading1", "Proposed terms")}
${item(1, 0, "An exclusive period of 60 days")}
${item(1, 1, "extendable once by agreement")}
${item(1, 0, "A purchase price of GBP 4.2m")}
${styled("Heading2", "Next steps")}
${item(2, 0, "Signed heads of terms")}
${item(2, 0, "Due diligence starts")}
${para(run("Our position: ") + run("walk away below 3.9m", "<w:vanish/>") + run("open to discussion."))}
<w:tbl>
<w:tr>${cell("Milestone")}${cell("Date")}</w:tr>
<w:tr>${cell("Heads of terms")}${cell("1 December")}</w:tr>
</w:tbl>
${para(run("Fees * 2 # [draft] &lt;b&gt;x&lt;/b&gt; &amp; co | 1. not a list"))}
</w:body></w:document>`;
  const styles = `<?xml version="1.0"?><w:styles ${W}>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Heading1"/></w:style>
</w:styles>`;
  const level = (ilvl: number, fmt: string): string =>
    `<w:lvl w:ilvl="${ilvl}"><w:numFmt w:val="${fmt}"/></w:lvl>`;
  const numbering = `<?xml version="1.0"?><w:numbering ${W}>
<w:abstractNum w:abstractNumId="0">${level(0, "bullet")}${level(1, "bullet")}</w:abstractNum>
<w:abstractNum w:abstractNumId="1">${level(0, "decimal")}</w:abstractNum>
<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
<w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>
</w:numbering>`;
  return zipSync({
    "[Content_Types].xml": utf8('<?xml version="1.0"?><Types/>'),
    "word/document.xml": utf8(document),
    "word/styles.xml": utf8(styles),
    "word/numbering.xml": utf8(numbering),
  });
}
