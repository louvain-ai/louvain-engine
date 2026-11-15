import assert from "node:assert/strict";
import test from "node:test";
import { xlsxText } from "../src/zip-xlsx.js";
import { zipSync } from "./fixtures.js";

/**
 * A workbook reads the same whoever wrote it. XML does not order a tag's attributes and writers do not agree:
 * Excel writes a relationship's `Id` before its `Target` and a sheet's `name` before its `r:id`; openpyxl writes
 * `Target` first, with an absolute `/xl/…` path, and every cell as an inline string. Read in order, an openpyxl
 * workbook would have no sheet targets: its text would be its sheet names and its grid empty. Both writers' shapes must
 * give the same rows in the text and in the grid.
 */

const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);

/** As openpyxl writes it: Target before Id, absolute paths, inline strings, a frozen header, an autofilter. */
function openpyxlStyle(): Uint8Array {
  return zipSync({
    "xl/workbook.xml": utf8(
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" name="Bugs" sheetId="1" state="visible" r:id="rId1"/></sheets></workbook>',
    ),
    "xl/_rels/workbook.xml.rels": utf8(
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="/xl/worksheets/sheet1.xml" Id="rId1"/><Relationship Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml" Id="rId2"/></Relationships>',
    ),
    "xl/worksheets/sheet1.xml": utf8(
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:E3"/>' +
        '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' +
        "<sheetData>" +
        '<row r="1"><c r="A1" s="1" t="inlineStr"><is><t>id</t></is></c><c r="B1" s="1" t="inlineStr"><is><t>issue</t></is></c><c r="C1" t="inlineStr"><is><t>done</t></is></c><c r="D1" t="inlineStr"><is><t>total</t></is></c><c r="E1" t="inlineStr"><is><t>check</t></is></c></row>' +
        '<row r="2"><c r="A2" t="n"><v>1</v></c><c r="B2" t="inlineStr"><is><r><t>ask </t></r><r><rPr><b/></rPr><t>hard-fails</t></r></is></c><c r="C2" t="b"><v>1</v></c><c r="D2" t="str"><f>A2&amp;"x"</f><v>1x</v></c><c r="E2" t="e"><v>#DIV/0!</v></c></row>' +
        '<row r="3"><c r="A3" t="n"><v>2</v></c><c r="B3" t="inlineStr"><is><t>reverses who asked</t></is></c><c r="C3" t="b"><v>0</v></c></row>' +
        '</sheetData><autoFilter ref="A1:E3"/></worksheet>',
    ),
  });
}

/** As Excel writes it: Id before Target, relative paths, a shared string table. */
function excelStyle(): Uint8Array {
  return zipSync({
    "xl/workbook.xml": utf8(
      '<workbook xmlns:r="r"><sheets><sheet name="Bugs" sheetId="1" r:id="rId1"/></sheets></workbook>',
    ),
    "xl/_rels/workbook.xml.rels": utf8(
      '<Relationships><Relationship Id="rId1" Type="worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
    ),
    "xl/sharedStrings.xml": utf8(
      "<sst><si><t>id</t></si><si><t>issue</t></si><si><t>ask hard-fails</t></si><si><t>reverses who asked</t></si></sst>",
    ),
    "xl/worksheets/sheet1.xml": utf8(
      '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row r="2"><c r="A2"><v>1</v></c><c r="B2" t="s"><v>2</v></c></row><row r="3"><c r="A3"><v>2</v></c><c r="B3" t="s"><v>3</v></c></row></sheetData></worksheet>',
    ),
  });
}

test("an openpyxl workbook (Target before Id, inline strings) reads its rows in the text", () => {
  const bytes = openpyxlStyle();
  const text = xlsxText(bytes).text;
  assert.match(text, /^## Bugs\nid\tissue\tdone\ttotal\tcheck\n/);
  assert.match(
    text,
    /1\task hard-fails\tTRUE\t1x\t#DIV\/0!/,
    "rich runs joined; boolean, formula string, error",
  );
  assert.match(text, /2\treverses who asked\tFALSE/);
  assert.ok(!text.includes('A2&"x"'), "never the formula");
});

test("an Excel workbook (Id before Target, shared strings) reads the same rows", () => {
  const bytes = excelStyle();
  assert.match(
    xlsxText(bytes).text,
    /^## Bugs\nid\tissue\n1\task hard-fails\n2\treverses who asked$/,
  );
});

test("a sheet tag with r:id before name is still found", () => {
  const bytes = zipSync({
    "xl/workbook.xml": utf8(
      '<workbook xmlns:r="r"><sheets><sheet r:id="rId1" sheetId="1" name="Late"/></sheets></workbook>',
    ),
    "xl/_rels/workbook.xml.rels": utf8(
      '<Relationships><Relationship Target="worksheets/sheet1.xml" Id="rId1"/></Relationships>',
    ),
    "xl/worksheets/sheet1.xml": utf8(
      '<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>here</t></is></c></row></sheetData></worksheet>',
    ),
  });
  assert.equal(xlsxText(bytes).text, "## Late\nhere");
});
