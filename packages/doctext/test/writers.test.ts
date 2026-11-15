import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import test from "node:test";
import { extractText, readerVersionOf } from "../src/index.js";

/**
 * Every writer's file reads, and reads the same until the reader's version says otherwise.
 *
 * `fixtures/writers/` holds real files from real producers (`generate.py` makes the open-source ones; a file a
 * person saves there from any office suite is picked up with no code). For each:
 *   - it is read, not refused (its "nearly empty" check, `readWarning`, is `@louvain/document-views`');
 *   - where a `<file>.golden.json` exists, its text is exactly the golden text for this reader version. A reader
 *     change that alters the text without bumping the format's number in `versions.ts` fails, because readings
 *     already made are re-read only when the number moves; a bump fails too, until the golden is reviewed and
 *     rewritten (`UPDATE_GOLDEN=1 pnpm --filter @louvain/doctext test`).
 */

const DIR = new URL("./fixtures/writers/", import.meta.url);
const READABLE = /\.(xlsx|docx|pptx|pdf|odt|ods|odp|epub|rtf|html|csv|txt|md|ics|eml|vtt|srt)$/i;
const update = process.env.UPDATE_GOLDEN === "1";
type Golden = { kind: string; readerVersion: number; text: string };

const files = readdirSync(DIR).filter((name) => READABLE.test(name));

test("the writer corpus is not empty", () => {
  assert.ok(files.length >= 5, `found ${files.length} files in fixtures/writers`);
});

for (const name of files) {
  test(`${name} is read whole`, async () => {
    const bytes = new Uint8Array(readFileSync(new URL(name, DIR)));
    const read = await extractText(bytes, { filename: name });
    assert.equal(read.reason, undefined, `${name}: ${read.detail ?? ""}`);
    assert.equal(read.readerVersion, readerVersionOf(read.kind));

    const goldenUrl = new URL(`${name}.golden.json`, DIR);
    if (update) {
      const golden: Golden = {
        kind: read.kind,
        readerVersion: read.readerVersion,
        text: read.text,
      };
      writeFileSync(goldenUrl, `${JSON.stringify(golden, null, 2)}\n`);
      return;
    }
    if (!existsSync(goldenUrl)) return;
    const golden = JSON.parse(readFileSync(goldenUrl, "utf8")) as Golden;
    assert.equal(
      golden.readerVersion,
      read.readerVersion,
      `${name}: the ${read.kind} reader is now version ${read.readerVersion}; review its reading and rewrite the golden (UPDATE_GOLDEN=1)`,
    );
    assert.equal(
      read.text,
      golden.text,
      `${name}: the ${read.kind} reader reads it differently at the same version — bump READER_VERSIONS.${read.kind} in versions.ts so readings already made are read again`,
    );
  });
}

// What the open-source writers' files must say, cell by cell and paragraph by paragraph (`generate.py`).
const MUST = {
  xlsx: [
    "## Bugs",
    "id\tissue\tpriority\topened\tblocking",
    "Totals row counted twice",
    "Parser drops inline strings",
    // A date is a date, never its serial number; an empty cell keeps its column (xlsx reader).
    "1\tParser drops inline strings\tP0\t2026-09-01\tTRUE",
    "2\tEmpty cell shifts columns\t\t2026-09-02\tFALSE",
    "## Notes",
    "A second sheet is named in the text.",
  ],
  docx: [
    "Reading pipeline",
    "Quarterly review of the reading pipeline.",
    "Every sheet, paragraph and slide must reach the text.",
    "Owner: the platform team.",
    "Totals row counted twice",
  ],
  pptx: [
    "Reading pipeline",
    "Every cell reaches the text.",
    "Next steps",
    "Add writers to the corpus.",
  ],
};

for (const [name, kind] of [
  ["openpyxl.xlsx", "xlsx"],
  ["xlsxwriter.xlsx", "xlsx"],
  ["python-docx.docx", "docx"],
  ["python-pptx.pptx", "pptx"],
] as const) {
  test(`${name} carries every cell or paragraph its writer put in`, async () => {
    const read = await extractText(new Uint8Array(readFileSync(new URL(name, DIR))), {
      filename: name,
    });
    for (const want of MUST[kind])
      assert.ok(read.text.includes(want), `${name} is missing “${want}”`);
  });
}
