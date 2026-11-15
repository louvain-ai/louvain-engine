import assert from "node:assert/strict";
import { test } from "node:test";
import { assertLinearWork } from "../../engine-core/test/work.js";
import { decodeEntities, stripHtml } from "../src/text.js";

/**
 * `stripHtml` meets HTML a source controls — a mail body, a helpdesk note, an
 * attachment. It was four regular expressions, three of which backtracked, so
 * 120 KB of the wrong characters held the event loop for seconds. It is one
 * linear pass now, and these pin both halves: it still reads HTML the way a
 * person does, and no input makes it slow.
 */

test("stripHtml keeps a reader's structure", () => {
  assert.equal(stripHtml("<p>one</p><p>two</p>"), "one\ntwo");
  assert.equal(stripHtml("a<b>c</b>d"), "a c d");
  assert.equal(stripHtml("line<br/>next<BR>last"), "line\nnext\nlast");
  assert.equal(
    stripHtml("<style>p{color:red}</style>Hello <script>x()</script>world"),
    "Hello world",
  );
  assert.equal(stripHtml("<STYLE type='x'>a</Style>kept"), "kept");
  assert.equal(stripHtml("Hi , there ! &amp; bye"), "Hi, there! & bye");
  assert.equal(stripHtml("a < b and c > d"), "a d");
  assert.equal(stripHtml("x < y"), "x < y");
  assert.equal(stripHtml("<>"), "<>");
  assert.equal(stripHtml("<p>a</p>\n\n\n\n<p>b</p>"), "a\n\nb");
  assert.equal(stripHtml("<style>unclosed <b>bold</b>"), "unclosed bold");
});

test("stripHtml is linear on hostile input", () => {
  // Linear, asserted as the characters read at 4N against N (`work.ts`): never a budget in milliseconds, nor a
  // ratio of CPU time, which a loaded runner stretches.
  const hostile: Record<string, (n: number) => string> = {
    "<style": (n) => "<style".repeat(n / 6),
    "<script": (n) => "<script".repeat(n / 7),
    "<": (n) => "<".repeat(n),
    spaces: (n) => `a${" ".repeat(n)}b`,
    "<a ": (n) => "<a ".repeat(n / 3),
    "&#x": (n) => `&#x${"1".repeat(n)}`,
  };
  for (const [name, shape] of Object.entries(hostile))
    assertLinearWork(name, shape, stripHtml, 120_000);
});

test("decodeEntities reads every HTML reference once, as HTML reads it (entities)", () => {
  // Names the old 27-entry table lacked: accented letters, arrows, guillemets.
  assert.equal(decodeEntities("caf&eacute; &Uuml;ber &laquo;x&raquo; &rarr;"), "café Über «x» →");
  // A numeric reference in 128–159 is Windows-1252, as HTML reads it: Outlook's apostrophe, not a C1 control.
  assert.equal(decodeEntities("don&#146;t &#150; &#x93;q&#x94;"), "don’t – “q”");
  // ONE pass: an escaped reference stays an escaped reference.
  assert.equal(decodeEntities("&#38;lt;b&#38;gt; &amp;amp;"), "&lt;b&gt; &amp;");
  // HTML's legacy forms without the `;`.
  assert.equal(decodeEntities("a&nbspb &amp c &copy 2026"), "a b & c © 2026");
  // The engine's own reading: spaces are spaces, joiners and soft hyphens are nothing, and invisible padding goes.
  assert.equal(
    decodeEntities("a&nbsp;b&ensp;c&thinsp;d co&shy;op x&zwnj;&#847;y"),
    "a b c d coop xy",
  );
  // What names nothing is left as written; a reference to no character is dropped.
  assert.equal(
    decodeEntities("AT&T &zzzq; &lang=en &#0;&#xD800;&#99999999;&#x110000;!"),
    "AT&T &zzzq; &lang=en !",
  );
  // HTML's own rule, not a guess: `&not` is a legacy name, so `&notit;` reads `¬it;` in every browser.
  assert.equal(decodeEntities("&notit;"), "¬it;");
});
