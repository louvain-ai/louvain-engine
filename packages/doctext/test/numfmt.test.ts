import assert from "node:assert/strict";
import test from "node:test";
import { BUILTIN_NUMBER_FORMATS, formatNumber } from "../src/numfmt.js";

/**
 * A number as its file formats it (`numfmt.ts`): what the grid draws for a numeric cell whose style names a
 * format. Anything the formatter does not draw faithfully is null, so the caller keeps the plain value.
 */

const builtin = (id: number): string => BUILTIN_NUMBER_FORMATS.get(id) ?? "";

test("built-in formats: thousands, fixed decimals, percent", () => {
  assert.equal(formatNumber(1234567.891, builtin(3)), "1,234,568");
  assert.equal(formatNumber(1234567.891, builtin(4)), "1,234,567.89");
  assert.equal(formatNumber(0.125, builtin(9)), "13%");
  assert.equal(formatNumber(0.0013, builtin(10)), "0.13%");
  assert.equal(formatNumber(42, builtin(1)), "42");
  assert.equal(formatNumber(42, builtin(2)), "42.00");
  assert.equal(formatNumber(-1234.5, builtin(4)), "-1,234.50");
  assert.equal(
    formatNumber(-1234.5, builtin(39)),
    "(1,234.50)",
    "a negative section draws its own sign",
  );
  assert.equal(formatNumber(1234.5, builtin(37)), "1,235 ");
});

test("a currency in quotes, as a locale tag, or bare", () => {
  assert.equal(formatNumber(1234.5, '"£"#,##0.00'), "£1,234.50");
  assert.equal(formatNumber(1234.5, "[$€-1809]#,##0.00"), "€1,234.50");
  assert.equal(formatNumber(1234.5, "#,##0.00 [$€-407]"), "1,234.50 €");
  assert.equal(formatNumber(1234.5, "$#,##0"), "$1,235");
  assert.equal(formatNumber(-1234.5, '"£"#,##0.00'), "-£1,234.50", "the sign leads the symbol");
  assert.equal(
    formatNumber(-1234.5, '"£"#,##0.00;[Red]"£"-#,##0.00'),
    "£-1,234.50",
    "a colour is dropped",
  );
});

test("rounding is half away from zero on what the sheet stores, and a ranged decimal trims", () => {
  assert.equal(formatNumber(1.005, "0.00"), "1.01", "not the binary 1.00");
  assert.equal(formatNumber(2.5, "0"), "3");
  assert.equal(formatNumber(1.5, "0.0#"), "1.5");
  assert.equal(formatNumber(1.567, "0.0#"), "1.57");
  assert.equal(formatNumber(0.5, "#.00"), ".50");
  assert.equal(formatNumber(7, "000"), "007");
  assert.equal(formatNumber(-0.001, "0.00"), "0.00", "never -0.00");
});

test("a trailing comma scales by a thousand; a literal suffix stays", () => {
  assert.equal(formatNumber(1_234_567, '#,##0,"k"'), "1,235k");
  assert.equal(formatNumber(1_234_567, '0.0,, "m"'), "1.2 m");
});

test("sections: positive, negative, zero", () => {
  const code = '#,##0;(#,##0);"–"';
  assert.equal(formatNumber(1200, code), "1,200");
  assert.equal(formatNumber(-1200, code), "(1,200)");
  assert.equal(formatNumber(0, code), "–");
});

test("a custom date or time code draws the date as written", () => {
  // 46266 is a day in September; .5 is noon.
  assert.equal(formatNumber(46266, "d mmm yyyy"), "1 Sep 2026");
  assert.equal(formatNumber(46266, "dd/mm/yyyy"), "01/09/2026");
  assert.equal(formatNumber(46266, "dddd, mmmm d"), "Tuesday, September 1");
  assert.equal(
    formatNumber(46266.5, "yyyy-mm-dd hh:mm"),
    "2026-09-01 12:00",
    "mm after hh is minutes",
  );
  assert.equal(formatNumber(46266.75, "h:mm AM/PM"), "6:00 PM");
  assert.equal(
    formatNumber(46266, "[$-409]mmm-yy"),
    "Sep-26",
    "a locale tag changes nothing drawn",
  );
  assert.equal(formatNumber(0, "d mmm yyyy", true), "1 Jan 1904", "the 1904 date system");
});

test("what it does not draw faithfully is null, and the caller keeps its value", () => {
  assert.equal(formatNumber(1234.5, "General"), null);
  assert.equal(formatNumber(1234.5, "@"), null);
  assert.equal(formatNumber(1234.5, "0.00E+00"), null, "scientific");
  assert.equal(formatNumber(0.5, "# ?/?"), null, "a fraction");
  assert.equal(formatNumber(150, '[>100]"big";"small"'), null, "a conditional section");
  assert.equal(formatNumber(1.25, "[h]:mm"), null, "elapsed time");
  assert.equal(formatNumber(1.25, "hh:mm:ss.0"), null, "fractional seconds");
  assert.equal(formatNumber(Number.NaN, "0.00"), null);
  assert.equal(formatNumber(1e25, "0.00"), null, "past what a fixed string holds");
});
