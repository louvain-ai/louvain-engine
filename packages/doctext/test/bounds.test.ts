import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ICAL from "ical.js";
import PostalMime from "postal-mime";
import { assertLinearWork, assertLinearWorkAsync } from "../../engine-core/test/work.js";
import { type Ical, readCalendar } from "../src/calendar-read.js";
import { readEmail } from "../src/email-read.js";
import { extractText, ZIP_LIMITS } from "../src/index.js";
import { xmlText } from "../src/xml.js";
import { docxText } from "../src/zip-word.js";
import { calendarArithmetic } from "./calendar-work.js";
import { makeDocx, makePdfPages, NEEDLE, withDeclaredSize, zipSync } from "./fixtures.js";

/**
 * A file is hostile input from anyone who can send one.
 *
 * Every test here is a way a document could be made to cost the reader more
 * than it is worth: memory past the machine, time past the deadline, or a text
 * so large the caps downstream see it only after it has been decoded and tidied
 * whole. Each answer must be a fact about the file (`reason`, `truncated`),
 * never an exception, because an exception makes a caller retry the same file for ever.
 */

const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);

const offHeap = (): number => process.memoryUsage().arrayBuffers;

test("a .docx of a few hundred bytes declaring a 2 GB document is refused before anything is allocated", async () => {
  const tiny = zipSync({ "word/document.xml": utf8("<w:document/>") });
  const bomb = withDeclaredSize(tiny, "word/document.xml", { declared: 2 ** 31 });
  assert.ok(bomb.byteLength < 400, `the hostile file is ${bomb.byteLength} bytes`);
  const before = offHeap();
  const result = await extractText(bomb, { filename: "invoice.docx" });
  const grew = offHeap() - before;
  assert.equal(result.kind, "docx");
  assert.equal(result.reason, "too-large");
  assert.match(result.detail ?? "", /too large when decompressed/);
  assert.equal(result.text, "");
  assert.ok(grew < 16 * 1024 * 1024, `allocated ${grew} bytes off the heap`);
  /*
   * Refused before one byte is inflated, shown by what the refusal could not have read, never by a clock: with the
   * member's compressed bytes replaced by garbage, the bomb is still refused as too large (only the declared size is
   * read), while the honest file with the same garbage is not called too large (it is read, and fails reading).
   */
  const garbled = (zip: Uint8Array): Uint8Array => {
    const out = zip.slice();
    const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
    assert.equal(view.getUint32(0, true), 0x04034b50, "a local file header first");
    const compressed = view.getUint32(18, true);
    const start = 30 + view.getUint16(26, true) + view.getUint16(28, true);
    assert.ok(compressed > 0, "the local header states the compressed size");
    out.fill(0xff, start, start + compressed);
    return out;
  };
  const refused = await extractText(garbled(bomb), { filename: "invoice.docx" });
  assert.equal(refused.reason, "too-large", "the declared size alone refused it");
  const honest = await extractText(garbled(tiny), { filename: "invoice.docx" });
  assert.equal(
    honest.reason,
    "damaged",
    "the same garbage in an honest file is inflated, and fails there",
  );
});

test("a member that expands more than 200× is refused as a bomb, not read", async () => {
  // 4 MiB of one repeated tag deflates to a few kilobytes: a bomb's shape.
  const body = `<w:document><w:body>${"<w:p/>".repeat((4 * 1024 * 1024) / 6)}</w:body></w:document>`;
  const bomb = zipSync({ "word/document.xml": utf8(body) }, { level: 9 });
  assert.ok(bomb.byteLength * ZIP_LIMITS.MAX_RATIO < body.length, "the fixture is past the ratio");
  const result = await extractText(bomb, { filename: "ratio.docx" });
  assert.equal(result.reason, "too-large");
  assert.match(result.detail ?? "", /expands more than 200 times/);
});

test("a small, repetitive part under the ratio floor is still read", async () => {
  // Blank table rows compress absurdly well and are ordinary in a real document.
  const docx = zipSync({
    "word/document.xml": utf8(
      `<w:document><w:body><w:p><w:r><w:t>${NEEDLE}</w:t></w:r></w:p>${"<w:p/>".repeat(20_000)}</w:body></w:document>`,
    ),
  });
  const result = await extractText(docx, { filename: "blank-rows.docx" });
  assert.equal(result.reason, undefined, JSON.stringify(result.detail));
  assert.ok(result.text.includes(NEEDLE));
});

test("a central directory that LIES LOW is refused the moment the member inflates past it", async () => {
  // Varied text so it deflates modestly, then the directory claims 1 KB.
  const lines = Array.from(
    { length: 4_000 },
    (_, i) => `<w:p><w:r><w:t>Line ${i} ${i * 7919}</w:t></w:r></w:p>`,
  );
  const real = zipSync({
    "word/document.xml": utf8(`<w:document><w:body>${lines.join("")}</w:body></w:document>`),
  });
  const liar = withDeclaredSize(real, "word/document.xml", { declared: 1_024 });
  const result = await extractText(liar, { filename: "liar.docx" });
  assert.equal(result.reason, "too-large");
  assert.match(result.detail ?? "", /inflates past the/);
});

test("the parts a reader asks for may not declare more than 256 MB between them", async () => {
  const sheets: Record<string, Uint8Array> = {
    "xl/workbook.xml": utf8("<workbook><sheets/></workbook>"),
  };
  for (let i = 1; i <= 5; i++) sheets[`xl/worksheets/sheet${i}.xml`] = utf8("<worksheet/>");
  let workbook = zipSync(sheets);
  // 60 MB each at a plausible 60× ratio: under every per-member limit, over the total.
  for (let i = 1; i <= 5; i++)
    workbook = withDeclaredSize(workbook, `xl/worksheets/sheet${i}.xml`, {
      declared: 60 * 1024 * 1024,
      compressed: 1024 * 1024,
    });
  const result = await extractText(workbook, { filename: "wide.xlsx" });
  assert.equal(result.kind, "xlsx");
  assert.equal(result.reason, "too-large");
  assert.match(result.detail ?? "", /more than 256 MB/);
});

test("a member declaring more than 64 MB is refused whatever its ratio", async () => {
  const docx = withDeclaredSize(makeDocx(), "word/document.xml", {
    declared: 65 * 1024 * 1024,
    compressed: 2 * 1024 * 1024,
  });
  const result = await extractText(docx, { filename: "huge.docx" });
  assert.equal(result.reason, "too-large");
  assert.match(result.detail ?? "", /the limit is 64 MB/);
});

test("a directory that points outside the file is damaged, not a read past the end", async () => {
  const docx = withDeclaredSize(makeDocx(), "word/document.xml", { compressed: 10_000_000 });
  const result = await extractText(docx, { filename: "pointer.docx" });
  assert.ok(result.reason === "damaged" || result.reason === "too-large", JSON.stringify(result));
  assert.equal(result.text, "");
});

test("a large accepted document is inflated only as far as the text the caller keeps", async () => {
  const paragraphs = Array.from(
    { length: 20_000 },
    (_, i) => `<w:p><w:r><w:t>Clause ${i}: the parties agree to term ${i}.</w:t></w:r></w:p>`,
  );
  const docx = zipSync({
    "word/document.xml": utf8(`<w:document><w:body>${paragraphs.join("")}</w:body></w:document>`),
  });
  const result = await extractText(docx, { filename: "long.docx", maxChars: 2_000 });
  assert.equal(result.reason, undefined);
  assert.equal(result.truncated, true);
  assert.ok(result.text.length <= 2_000, `${result.text.length} characters`);
  assert.ok(result.text.startsWith("Clause 0:"), result.text.slice(0, 40));
});

test("a plain text file is cut BEFORE decoding, on a character boundary", async () => {
  // Two-byte characters throughout: a cut through one would fail the UTF-8
  // decode and drop the whole file to cp1252 — "Ã©" instead of "é".
  const text = `${"café ".repeat(400_000)}`;
  const result = await extractText(utf8(text), { filename: "big.txt", maxChars: 1_000 });
  assert.equal(result.truncated, true);
  assert.ok(result.text.length <= 1_000);
  assert.ok(result.text.includes("café"), result.text.slice(0, 40));
  assert.ok(!result.text.includes("Ã"), "decoded as UTF-8, not as cp1252");
});

test("pdf: the page cap and the character cap both stop the read early, and say so", async () => {
  const pages = Array.from({ length: 6 }, (_, i) => [`Page ${i + 1} of the renewal.`, NEEDLE]);
  const capped = await extractText(makePdfPages(pages), { filename: "six.pdf", maxPages: 2 });
  assert.equal(capped.meta.pages, 6);
  assert.equal(capped.meta.pagesRead, 2);
  assert.equal(capped.truncated, true);
  assert.ok(!capped.text.includes("Page 3"));

  const short = await extractText(makePdfPages(pages), { filename: "six.pdf", maxChars: 10 });
  assert.equal(short.meta.pagesRead, 1, "a page is only started while the text is under the cap");
  assert.equal(short.truncated, true);
});

test("pdf: a document that cannot be opened within the deadline is a fact, not a hang", async () => {
  const result = await extractText(makePdfPages([[NEEDLE]]), {
    filename: "slow.pdf",
    deadlineMs: 0,
  });
  assert.equal(result.kind, "pdf");
  assert.equal(result.reason, "timed-out");
  assert.match(result.detail ?? "", /within the time allowed/);
});

test("pdf.js as shipped compiles no document content into JavaScript", () => {
  // `isEvalSupported` is pdf.js's switch for compiling font programs with `new Function`; this fails when an
  // upgrade brings that path or switch, so it is caught rather than missed.
  const require = createRequire(import.meta.url);
  for (const file of [
    "pdfjs-dist/legacy/build/pdf.mjs",
    "pdfjs-dist/legacy/build/pdf.worker.mjs",
  ]) {
    const source = readFileSync(require.resolve(file), "utf8");
    assert.doesNotMatch(source, /isEvalSupported/, file);
    assert.doesNotMatch(source, /new Function\s*\(/, file);
    assert.doesNotMatch(source, /[^.\w]eval\s*\(/, file);
  }
});

/**
 * Markup built to defeat a pattern (`tags.ts`). A regex scanner retries from every `<`, so a member of one repeated
 * fragment costs time quadratic in its length, synchronously, where no deadline reaches. The read must be linear, not
 * merely fast: the time for a flood of 4N is compared with N (median of seven alternating runs each), since an
 * absolute budget measures the machine and N against 2N is too close under load. At 4N linear is ×4 and quadratic
 * ×16, so the threshold (8) sits a factor of two from each. Under 100 ms a ratio is scheduling noise, and a flood
 * that reads that fast at 4N is not quadratic.
 */
/**
 * Each flood is about 125 KB per N. The two that cost real time per byte (`<row>` and a bare `<`) are sized so their
 * baseline is at least 100 ms, because a smaller baseline lets runner noise alone push the ratio past the threshold,
 * so their N is ten times the others'. The rest read too fast for the ratio check and meet only the 10-second ceiling.
 */
const FLOODS: [string, (n: number) => string, number][] = [
  ["an unterminated comment, repeated", (n) => "<!--".repeat(n), 31_250],
  ["a tag opened and never closed, repeated", (n) => "<a ".repeat(n), 41_500],
  ["an unterminated quoted attribute", (n) => `<a b="${"x".repeat(n)}`, 125_000],
  ["a row opened and never closed, repeated", (n) => "<row>".repeat(n), 250_000],
  ["an unterminated CDATA section, repeated", (n) => "<![CDATA[".repeat(n), 13_750],
  ["a processing instruction never ended, repeated", (n) => "<?pi ".repeat(n), 25_000],
  ["a bare <, repeated", (n) => "<".repeat(n), 1_250_000],
];

for (const [what, flood, n] of FLOODS) {
  test(`xml: ${what} reads in linear time`, () => {
    assertLinearWork(
      what,
      flood,
      (xml) => xmlText(xml, { breakAfter: new Set(["p"]), skip: new Set(["style"]) }),
      n,
    );
  });
}

/** Filler a deflater cannot squeeze past the 200× bomb ratio, so the flood reaches the reader rather than the refusal. */
function noise(length: number): string {
  let seed = 1;
  let out = "";
  while (out.length < length) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    out += seed.toString(36);
  }
  return out.slice(0, length);
}

function hostileWorkbook(sheetXml: string): Uint8Array {
  return zipSync({
    "xl/workbook.xml": utf8(
      '<?xml version="1.0"?><workbook xmlns:r="x"><sheets><sheet name="S" sheetId="1" r:id="rId1"/></sheets></workbook>',
    ),
    "xl/_rels/workbook.xml.rels": utf8(
      '<?xml version="1.0"?><Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
    ),
    "xl/worksheets/sheet1.xml": utf8(`<?xml version="1.0"?><worksheet><sheetData>${sheetXml}`),
  });
}

test("xlsx: a sheet of rows, cells and values never closed reads as text in linear time", async () => {
  const books = new Map(
    [10_000, 40_000].map((rows) => [
      rows,
      hostileWorkbook(
        Array.from({ length: rows }, (_, i) => `<row r="${i + 1}"><c><v>${noise(4)}`).join(""),
      ),
    ]),
  );
  const read = await extractText(books.get(10_000) as Uint8Array, { filename: "rota.xlsx" });
  assert.equal(read.kind, "xlsx");
  await assertLinearWorkAsync(
    "a hostile workbook, read as text",
    (rows) => books.get(rows) as Uint8Array,
    async (book) => {
      await extractText(book, { filename: "rota.xlsx" });
    },
    10_000,
  );
});

/**
 * A document view's readers too: the Word reader's hidden-run walk (`docxText` `visibleOnly`) and its style lookups, and
 * the recalculated workbook's cell rewrite (`keepSavedWhereRecalcErred`), all read through the tokenizer. These cases
 * check the work they do; the counter cannot see a pattern backtracking inside one call, so a pattern would pass them
 * slowly, and the guard against patterns is the source check in `tags.test.ts`.
 */
const W_NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
function hostileDocx(document: string, styles: string): Uint8Array {
  return zipSync({
    "word/document.xml": utf8(`<w:document ${W_NS}><w:body>${document}`),
    "word/styles.xml": utf8(`<w:styles ${W_NS}>${styles}`),
  });
}

test("docx: runs, paragraph styles and based-on styles never closed read (visible only) in linear time", () => {
  const docs = new Map(
    [10_000, 40_000].map((k) => [
      k,
      hostileDocx(
        `<w:p><w:pPr>${Array.from({ length: k }, () => `<w:pStyle ${noise(4)} `).join("")}</w:pPr>` +
          Array.from({ length: k }, () => `<w:r ${noise(4)} `).join(""),
        `<w:style w:type="paragraph" w:styleId="a">${Array.from({ length: k }, () => `<w:basedOn ${noise(4)} `).join("")}</w:style>`,
      ),
    ]),
  );
  docxText(docs.get(10_000) as Uint8Array, 400_000, { visibleOnly: true });
  assertLinearWork(
    "a hostile Word document, read visible only",
    (k) => docs.get(k) as Uint8Array,
    (doc) => docxText(doc, 400_000, { visibleOnly: true }),
    10_000,
  );
});

test("xlsx: thousands of sheet tags naming one part read that part once, and are capped as the grid caps them", async () => {
  const sheet = utf8(
    `<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>${noise(2_000)}</t></is></c></row></sheetData></worksheet>`,
  );
  const books = new Map(
    [5_000, 20_000].map((k) => [
      k,
      zipSync({
        "xl/workbook.xml": utf8(
          `<workbook xmlns:r="x"><sheets>${Array.from({ length: k }, (_, i) => `<sheet name="S${i}" r:id="rId1"/>`).join("")}</sheets></workbook>`,
        ),
        "xl/_rels/workbook.xml.rels": utf8(
          '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
        ),
        "xl/worksheets/sheet1.xml": sheet,
      }),
    ]),
  );
  const read = await extractText(books.get(20_000) as Uint8Array, { filename: "many.xlsx" });
  assert.equal(read.kind, "xlsx");
  assert.equal(read.truncated, true, "past MAX_SHEETS the read says it stopped");
  assert.ok(((read.meta?.sheets as string[] | undefined) ?? []).length <= 256);
  await assertLinearWorkAsync(
    "sheet tags naming one part",
    (k) => books.get(k) as Uint8Array,
    (book) => extractText(book, { filename: "many.xlsx" }),
    5_000,
  );
});

test("xlsx: formatted empty rows do not spend the row cap, so the data after them is read", async () => {
  const empties = Array.from({ length: 6_000 }, (_, i) => `<row r="${i + 1}" ht="15"/>`).join("");
  const book = hostileWorkbook(
    `${empties}<row r="6001"><c r="A6001" t="inlineStr"><is><t>after the empties</t></is></c></row></sheetData></worksheet>`,
  );
  const read = await extractText(book, { filename: "formatted.xlsx" });
  assert.match(read.text, /after the empties/);
});

// ————— a calendar (`calendar.ts`): bounded before `ical.js` parses it, whose parse no timer can stop —————

const calendar = (...lines: string[]) =>
  new TextEncoder().encode(
    ["BEGIN:VCALENDAR", "VERSION:2.0", ...lines, "END:VCALENDAR", ""].join("\r\n"),
  );
const event = (i: number, ...more: string[]) => [
  "BEGIN:VEVENT",
  `UID:${i}`,
  "DTSTART:20261001T090000Z",
  `SUMMARY:Event ${i}`,
  ...more,
  "END:VEVENT",
];

test("a calendar with more lines than a calendar has is refused before it is parsed", async () => {
  const { MAX_CALENDAR_LINES } = await import("../src/calendar-limits.js");
  const lines = Array.from({ length: MAX_CALENDAR_LINES + 10 }, (_, i) => `X-PAD:${i}`);
  const read = await extractText(calendar(...lines), { filename: "flood.ics" });
  assert.equal(read.reason, "too-large");
});

test("one property folded into a line past the cap is refused, however it was folded", async () => {
  const { MAX_CALENDAR_LINE } = await import("../src/calendar-limits.js");
  const folds = Array.from(
    { length: Math.ceil(MAX_CALENDAR_LINE / 70) + 10 },
    () => ` ${"x".repeat(70)}`,
  );
  const read = await extractText(calendar(...event(1, "DESCRIPTION:start", ...folds)), {
    filename: "fold.ics",
  });
  assert.equal(read.reason, "too-large");
});

test("a calendar reads at most MAX_CALENDAR_EVENTS events and says it stopped", async () => {
  const { MAX_CALENDAR_EVENTS } = await import("../src/calendar-limits.js");
  const events = Array.from({ length: MAX_CALENDAR_EVENTS + 5 }, (_, i) => event(i)).flat();
  const read = await extractText(calendar(...events), { filename: "many.ics" });
  assert.equal(read.meta.events, MAX_CALENDAR_EVENTS);
  assert.equal(read.truncated, true);
  assert.doesNotMatch(read.text, new RegExp(`Event ${MAX_CALENDAR_EVENTS}\\b`));
});

test("a recurrence is said, never expanded: a rule for a hundred million occurrences reads at once", async () => {
  const huge = calendar(...event(1, "RRULE:FREQ=SECONDLY;COUNT=100000000"));
  const once = calendar(...event(1, "RRULE:FREQ=SECONDLY;COUNT=1"));
  const read = await extractText(huge, { filename: "rrule.ics" });
  assert.match(read.text, /Repeats: every second \(FREQ=SECONDLY;COUNT=100000000\)/);
  // Not a clock, since times measure the runner's load: what the read computed is counted (`calendar-work.ts`), and a
  // rule for a hundred million occurrences computes exactly what a rule for one does, with no occurrence expanded.
  const hugeWork = calendarArithmetic(huge);
  assert.equal(hugeWork.occurrences, 0, "no occurrence was computed");
  assert.deepEqual(
    hugeWork,
    calendarArithmetic(once),
    "the rule for a hundred million reads as the rule for one",
  );
});

test("a line of more parameters than a calendar's is refused before it is parsed (review P1)", async () => {
  const { MAX_CALENDAR_PARAMETERS } = await import("../src/calendar-limits.js");
  const flood = `X-A${";A=1".repeat(MAX_CALENDAR_PARAMETERS + 1)}:v`;
  const read = await extractText(calendar(...event(1, flood)), { filename: "params.ics" });
  assert.equal(read.reason, "too-large");
  // A `;` in a value is text, not a parameter: a description of many clauses is read.
  const prose = `DESCRIPTION:${"a\\; ".repeat(MAX_CALENDAR_PARAMETERS * 4)}end`;
  const kept = await extractText(calendar(...event(2, prose)), { filename: "prose.ics" });
  assert.equal(kept.reason, undefined, kept.detail);
});

test("a calendar's parse is linear in its lines, with as many parameters per line as it allows (review P1)", async () => {
  const { MAX_CALENDAR_PARAMETERS } = await import("../src/calendar-limits.js");
  // The adversarial shape: every line as parameter-heavy as the cap lets through.
  const heavy = `X-A${";A=1".repeat(MAX_CALENDAR_PARAMETERS)}:v`;
  // Counted, not timed: this process's bounds check, then the reader's own `readCalendar` run here, where its
  // characters can be counted (the reader process's copy is out of the counter's sight).
  await assertLinearWorkAsync(
    "a calendar of parameter-heavy lines",
    (n) => calendar(...event(1, ...Array.from({ length: n }, () => heavy))),
    async (file) => {
      await extractText(file, { filename: "linear.ics" });
      readCalendar(ICAL as unknown as Ical, new TextDecoder().decode(file), {
        maxEvents: 1_000,
        deadline: Number.POSITIVE_INFINITY,
      });
    },
    2_000,
  );
});

test("a hang at the file's worst: a DURATION of a hundred quintillion weeks finishes inside its deadline", async () => {
  const hang = calendar(
    ...event(1, "DURATION:P99999999999999999999W"),
    ...event(2, "DURATION:-PT99999999999999999999S"),
  );
  // The deadline is generous so a slow runner never times out an honest read; what proves the hang gone is what the
  // read computed against two ordinary events (`calendar-work.ts`), never milliseconds: no duration is added to a
  // time, so no month is walked past an ordinary event's.
  const read = await extractText(hang, { filename: "hang.ics", deadlineMs: 30_000 });
  assert.notEqual(read.reason, "timed-out");
  const ordinary = calendar(...event(1, "DURATION:PT1H"), ...event(2, "DURATION:PT30M"));
  const hangWork = calendarArithmetic(hang);
  assert.equal(hangWork.durationsAdded, 0, "no end was computed");
  assert.deepEqual(hangWork, calendarArithmetic(ordinary), "the hang reads as two ordinary events");
});

// The reader spins forever, so settling at all proves the kill; the test's own timeout is far from a slow runner's noise.
test("a reader in its own process is killed at its deadline, whatever it is doing", {
  timeout: 15_000,
}, async () => {
  const { inWorker } = await import("../src/worker.js");
  const { WorkerDeadline } = await import("../src/worker-errors.js");
  await assert.rejects(
    inWorker(
      new URL("./fixtures/spin-worker.ts", import.meta.url),
      {},
      { deadline: Date.now() + 300 },
    ),
    WorkerDeadline,
  );
});

// ————— a saved email (`email.ts`): our byte cap first, then postal-mime's limits passed explicitly —————

const mail = (...lines: string[]) => new TextEncoder().encode(lines.join("\r\n"));

test("an email nested deeper than MAX_EMAIL_NESTING multipart levels is refused as too large", async () => {
  const { MAX_EMAIL_NESTING } = await import("../src/email-limits.js");
  const depth = MAX_EMAIL_NESTING + 4;
  const open = Array.from({ length: depth }, (_, i) => [
    `--b${i}`,
    `Content-Type: multipart/mixed; boundary="b${i + 1}"`,
    "",
  ]).flat();
  const close = Array.from({ length: depth + 1 }, (_, i) => `--b${depth - i}--`);
  const read = await extractText(
    mail(
      "Subject: deep",
      'Content-Type: multipart/mixed; boundary="b0"',
      "",
      ...open,
      `--b${depth}`,
      "Content-Type: text/plain",
      "",
      "bottom",
      ...close,
    ),
    { filename: "deep.eml" },
  );
  assert.equal(read.reason, "too-large", read.detail);
});

test("an email whose headers pass MAX_EMAIL_HEADERS is refused as too large", async () => {
  const { MAX_EMAIL_HEADERS } = await import("../src/email-limits.js");
  const pad = Array.from(
    { length: Math.ceil(MAX_EMAIL_HEADERS / 60) + 10 },
    (_, i) => `X-Pad-${i}: ${"x".repeat(50)}`,
  );
  const read = await extractText(mail("Subject: heavy", ...pad, "", "body"), {
    filename: "heavy.eml",
  });
  assert.equal(read.reason, "too-large", read.detail);
});

test("an email larger than MAX_EMAIL_BYTES is refused before it is parsed", async () => {
  const { MAX_EMAIL_BYTES } = await import("../src/email-limits.js");
  const read = await extractText(mail("Subject: big", "", "x".repeat(MAX_EMAIL_BYTES + 10)), {
    filename: "big.eml",
    maxBytes: MAX_EMAIL_BYTES * 2,
  });
  assert.equal(read.reason, "too-large");
});

test("an email past its deadline is timed out", async () => {
  const read = await extractText(mail("Subject: late", "", "body"), {
    filename: "late.eml",
    deadlineMs: -1,
  });
  assert.equal(read.reason, "timed-out");
});

test("a forward nested past MAX_EMAIL_FORWARDS is named, not parsed", async () => {
  const { MAX_EMAIL_FORWARDS } = await import("../src/email-limits.js");
  let inner = ["Subject: innermost", "Content-Type: text/plain", "", "the bottom of the chain"];
  for (let i = 0; i < MAX_EMAIL_FORWARDS + 2; i++)
    inner = [
      `Subject: forward ${i}`,
      `Content-Type: multipart/mixed; boundary="f${i}"`,
      "",
      `--f${i}`,
      "Content-Type: message/rfc822",
      "",
      ...inner,
      `--f${i}--`,
    ];
  const read = await extractText(mail(...inner), { filename: "chain.eml" });
  assert.equal(read.reason, undefined, read.detail);
  assert.doesNotMatch(read.text, /the bottom of the chain/, "the deepest message is not parsed");
});

test("an email's parse is linear in its address list", async () => {
  const { MAX_EMAIL_NESTING, MAX_EMAIL_HEADERS, MAX_EMAIL_FORWARDS } = await import(
    "../src/email.js"
  );
  const limits = {
    maxNestingDepth: MAX_EMAIL_NESTING,
    maxHeadersSize: MAX_EMAIL_HEADERS,
    maxRfc822NestingDepth: MAX_EMAIL_FORWARDS,
  };
  // Counted, not timed: the reader's own `readEmail` run here, where its characters can be counted. N is sized so 4N
  // stays under the header cap and is parsed, since a refusal would time the refusal.
  await assertLinearWorkAsync(
    "an email with a long To: list",
    (n) =>
      mail(
        `To: ${Array.from({ length: n }, (_, i) => `Person ${i} <p${i}@acme.example>`).join(", ")}`,
        "Subject: many",
        "",
        "body",
      ),
    async (file) => {
      const read = await extractText(file, { filename: "many.eml" });
      assert.equal(read.reason, undefined, read.detail);
      await readEmail(PostalMime, file, limits);
    },
    1_500,
  );
});

test("a reader that runs out of its process's memory is refused as too large, not damaged", async () => {
  const { inWorker } = await import("../src/worker.js");
  const { WorkerOutOfMemory } = await import("../src/worker-errors.js");
  await assert.rejects(
    inWorker(
      new URL("./fixtures/hog-worker.ts", import.meta.url),
      {},
      { deadline: Date.now() + 20_000, heapMb: 32 },
    ),
    WorkerOutOfMemory,
  );
});

test("the review's 19 MB format=flowed mail, well formed and under the byte cap, is too large rather than damaged", async () => {
  const body = Buffer.from("a \r\n".repeat(5_000_000));
  const head = Buffer.from(
    "From: a@acme.example\r\nSubject: flowed\r\nContent-Type: text/plain; charset=utf-8; format=flowed\r\n\r\n",
  );
  const read = await extractText(new Uint8Array(Buffer.concat([head, body])), {
    filename: "flowed.eml",
    maxBytes: 32 * 1024 * 1024,
    // What this proves is which refusal it gets, not how fast: the default deadline can race the heap refusal on a
    // slow runner, so it is generous enough that the reader always runs out of memory first.
    deadlineMs: 300_000,
  });
  // It needs more than the reader's thread is given (WORKER_HEAP_MB): refused for its size, never "damaged".
  assert.equal(read.reason, "too-large", read.detail);
});

// ————— the reader process (`worker.ts`): a thread's heap limit is not isolation; a process boundary is —————

test("the review's flowed mail at a small heap: the reader process dies alone, and this process gets too-large", async () => {
  const { inWorker, siblingModule } = await import("../src/worker.js");
  const { WorkerOutOfMemory } = await import("../src/worker-errors.js");
  const bytes = new TextEncoder().encode(
    `From: a@x.test\r\nSubject: flowed\r\nContent-Type: text/plain; format=flowed\r\n\r\n${"a \r\n".repeat(5_000_000)}`,
  );
  // At 128 MB a thread's out-of-memory aborts the whole process that runs it (exit 134); here it is the child's.
  await assert.rejects(
    inWorker(
      siblingModule("email-worker", new URL("../src/worker.ts", import.meta.url).href),
      { bytes, limits: { maxNestingDepth: 16, maxHeadersSize: 262_144, maxRfc822NestingDepth: 3 } },
      { deadline: Date.now() + 30_000, heapMb: 128 },
    ),
    WorkerOutOfMemory,
  );
  assert.ok(process.memoryUsage().rss > 0, "and this process is still here to say so");
});

test("a reader that ignores SIGTERM is killed at its deadline, and no child process outlives the read", async () => {
  const { inWorker } = await import("../src/worker.js");
  const { WorkerDeadline } = await import("../src/worker-errors.js");
  const { execFileSync } = await import("node:child_process");
  // This process's children (the TypeScript loader keeps one of its own), before and after.
  const children = () => {
    try {
      return new Set(
        execFileSync("pgrep", ["-P", String(process.pid)], { encoding: "utf8" })
          .split(/\s+/)
          .filter(Boolean),
      );
    } catch {
      // pgrep exits 1 when it finds none.
      return new Set<string>();
    }
  };
  const before = children();
  await assert.rejects(
    inWorker(
      new URL("./fixtures/stubborn-worker.ts", import.meta.url),
      {},
      { deadline: Date.now() + 500 },
    ),
    WorkerDeadline,
  );
  const left = [...children()].filter((pid) => !before.has(pid));
  assert.deepEqual(left, [], "the killed reader was reaped before the caller heard");
});

test("a reader's environment is an allowlist: no database URL, key or token reaches it", async () => {
  const { inWorker } = await import("../src/worker.js");
  process.env.DATABASE_URL = "postgres://secret@db/prod";
  process.env.OPENROUTER_API_KEY = "sk-secret";
  try {
    const names = await inWorker<string[]>(
      new URL("./fixtures/env-worker.ts", import.meta.url),
      {},
      { deadline: Date.now() + 10_000 },
    );
    assert.ok(
      !names.includes("DATABASE_URL") && !names.includes("OPENROUTER_API_KEY"),
      names.join(","),
    );
    assert.ok(
      names.every(
        (name) => ["NODE_ENV", "TSX_TSCONFIG_PATH"].includes(name) || name.startsWith("__"),
      ),
      names.join(","),
    );
  } finally {
    delete process.env.DATABASE_URL;
    delete process.env.OPENROUTER_API_KEY;
  }
});

test("at most MAX_READERS read at once in a process; the next waits for a slot", async () => {
  const { inWorker } = await import("../src/worker.js");
  const { MAX_READERS } = await import("../src/worker-pool.js");
  const nap = new URL("./fixtures/nap-worker.ts", import.meta.url);
  const starts = await Promise.all(
    Array.from({ length: MAX_READERS + 1 }, () =>
      inWorker<number>(nap, {}, { deadline: Date.now() + 20_000 }),
    ),
  );
  const sorted = [...starts].sort((a, b) => a - b);
  const last = sorted.at(-1) ?? 0;
  const first = sorted[0] ?? 0;
  assert.ok(
    last - first >= 350,
    `the extra reader started ${last - first} ms after the first, after a slot freed`,
  );
});

test("a fork that never starts is ReaderUnavailable inside its deadline, frees its slot, and is never 'damaged'", async () => {
  const { inWorker } = await import("../src/worker.js");
  const { ReaderUnavailable } = await import("../src/worker-errors.js");
  const { MAX_READERS } = await import("../src/worker-pool.js");
  const nap = new URL("./fixtures/nap-worker.ts", import.meta.url);
  const real = process.execPath;
  // A spawn that fails (a missing binary here; EAGAIN under pressure) emits 'error' and never 'exit'; settled on
  // 'exit', two such reads would hold both slots for ever and every later read would time out.
  process.execPath = "/nonexistent/node";
  try {
    // Settled as ReaderUnavailable (below) is settled before the deadline: a read that waited it out is WorkerDeadline.
    const failed = await Promise.allSettled(
      Array.from({ length: MAX_READERS }, () =>
        inWorker(nap, {}, { deadline: Date.now() + 1_000 }),
      ),
    );
    for (const outcome of failed) {
      assert.equal(outcome.status, "rejected");
      const reason = (outcome as PromiseRejectedResult).reason;
      assert.ok(reason instanceof ReaderUnavailable);
      // A missing binary is a broken deployment, not load: it is not the free retry a shortage is.
      assert.equal(reason.transient, false);
      assert.equal(reason.code, "ENOENT");
    }
    // Through extractText: the host's failure is thrown for the caller to retry, never recorded on the file.
    const invite = new TextEncoder().encode(
      [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "BEGIN:VEVENT",
        "UID:1",
        "DTSTART:20261001T090000Z",
        "END:VEVENT",
        "END:VCALENDAR",
        "",
      ].join("\r\n"),
    );
    await assert.rejects(extractText(invite, { filename: "a.ics" }), ReaderUnavailable);
  } finally {
    process.execPath = real;
  }
  // Both slots are given back: the next read runs.
  assert.equal(
    typeof (await inWorker<number>(nap, {}, { deadline: Date.now() + 10_000 })),
    "number",
  );
});

test("a reader whose own code will not load is the deployment's fault, never the file's", async () => {
  const { inWorker } = await import("../src/worker.js");
  const { ReaderUnavailable } = await import("../src/worker-errors.js");
  // A build missing its entry: the entry the reader forks does not exist.
  const error = await inWorker(
    new URL("./fixtures/no-such-worker.ts", import.meta.url),
    {},
    { deadline: Date.now() + 20_000 },
  ).then(
    () => null,
    (e: unknown) => e,
  );
  assert.ok(
    error instanceof ReaderUnavailable,
    `a missing entry is ReaderUnavailable, not a failed read: ${String(error)}`,
  );
  assert.equal(
    error.transient,
    false,
    "not a shortage that passes: attempts are used and it is reported",
  );
  assert.equal(error.code, "ERR_MODULE_NOT_FOUND");
});

/**
 * `boundedZip`: a document view's Word layout and its fallback open the zip themselves, with no bound. They are
 * handed this instead — every member inflated under `ZIP_LIMITS`, packed again stored, so a bomb is refused before
 * either sees it, a lying directory is refused while inflating, and an honest file keeps every byte.
 */
test("a reader that opens the zip itself gets the parts bounded and stored, or a refusal", async () => {
  const { boundedZip, DecompressionRefused } = await import("../src/index.js");
  const { unzipSync } = await import("fflate");
  const body = `<w:document><w:body>${"<w:p/>".repeat((4 * 1024 * 1024) / 6)}</w:body></w:document>`;
  assert.throws(
    () => boundedZip(zipSync({ "word/document.xml": utf8(body) }, { level: 9 })),
    DecompressionRefused,
    "a ratio bomb",
  );
  const lines = Array.from(
    { length: 4_000 },
    (_, i) => `<w:p><w:r><w:t>Line ${i} ${i * 7919}</w:t></w:r></w:p>`,
  );
  const real = zipSync({
    "word/document.xml": utf8(`<w:document><w:body>${lines.join("")}</w:body></w:document>`),
  });
  assert.throws(
    () => boundedZip(withDeclaredSize(real, "word/document.xml", { declared: 1_024 })),
    DecompressionRefused,
    "a directory that lies low",
  );
  const honest = makeDocx();
  const stored = boundedZip(honest);
  const before = unzipSync(honest);
  const after = unzipSync(stored);
  assert.deepEqual(Object.keys(after).sort(), Object.keys(before).sort());
  for (const name of Object.keys(before)) assert.deepEqual(after[name], before[name], name);
  // Stored: the local header's method is 0, so whatever opens it next inflates nothing.
  assert.equal(new DataView(stored.buffer, stored.byteOffset).getUint16(8, true), 0);
});
