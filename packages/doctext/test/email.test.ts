import assert from "node:assert/strict";
import test from "node:test";
import { classifyFile, extractText, readableExtensions } from "../src/index.js";
import { looksReadable } from "./looks-readable.js";

/**
 * A saved email is read as the mail (`email.ts`): its headers, its body (the plain part, else the HTML
 * read as text) and the names of what was attached, never the MIME source with its base64 and quoted-printable.
 */

const utf8 = (text: string) => new TextEncoder().encode(text);
const eml = (...lines: string[]) => utf8(lines.join("\r\n"));

test("an .eml and a message/rfc822 part are an email, still accepted, and read again from text", () => {
  assert.equal(classifyFile("forwarded.eml"), "eml");
  assert.equal(classifyFile("attachment", "message/rfc822"), "eml");
  assert.ok(readableExtensions().includes(".eml"));
  assert.equal(looksReadable("forwarded.eml"), true);
});

test("headers, a quoted-printable body and an encoded subject read as a person reads them", async () => {
  const read = await extractText(
    eml(
      "From: Priya Nair <priya@acme.example>",
      "To: Sam <sam@acme.example>, bob@acme.example",
      "Subject: =?UTF-8?Q?Pricing_review=E2=80=99s_notes?=",
      "Date: Wed, 30 Sep 2026 09:00:00 +1300",
      "MIME-Version: 1.0",
      "Content-Type: text/plain; charset=utf-8",
      "Content-Transfer-Encoding: quoted-printable",
      "",
      "We=E2=80=99ll hold the price at 40 a seat.&#160;Thanks.",
      "",
    ),
    { filename: "notes.eml" },
  );
  assert.equal(read.reason, undefined);
  assert.equal(
    read.text,
    [
      "From: Priya Nair <priya@acme.example>",
      "To: Sam <sam@acme.example>, bob@acme.example",
      "Date: Wed, 30 Sep 2026 09:00:00 +1300",
      "Subject: Pricing review’s notes",
      "",
      "We’ll hold the price at 40 a seat. Thanks.",
    ].join("\n"),
  );
});

test("an HTML-only mail is read as text, and an attachment is named, never read", async () => {
  const pdf = Buffer.from("%PDF-1.4 secret figures inside").toString("base64");
  const read = await extractText(
    eml(
      "From: a@acme.example",
      "Subject: Contract",
      "MIME-Version: 1.0",
      'Content-Type: multipart/mixed; boundary="b1"',
      "",
      "--b1",
      "Content-Type: text/html; charset=utf-8",
      "",
      "<p>Please find the <b>contract</b> attached.</p>",
      "--b1",
      'Content-Type: application/pdf; name="contract.pdf"',
      'Content-Disposition: attachment; filename="contract.pdf"',
      "Content-Transfer-Encoding: base64",
      "",
      pdf,
      "--b1--",
      "",
    ),
    { filename: "contract.eml" },
  );
  assert.match(read.text, /Please find the contract attached\./);
  assert.match(read.text, /Attached: contract\.pdf \(application\/pdf\)/);
  assert.doesNotMatch(
    read.text,
    /secret figures|JVBERi/,
    "the attachment's bytes are not in the text",
  );
  assert.equal(read.meta.attachments, 1);
});
