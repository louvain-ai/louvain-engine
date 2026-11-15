import assert from "node:assert/strict";
import { test } from "node:test";
import { scrubMessage } from "../src/observability/scrub.js";

const SECRET = "ZZQX-tenant-secret-renewal-value-8827";
test("a plain Error carrying a question keeps its static shape only", () => {
  assert.equal(
    scrubMessage(`reader failed for question: what is the ${SECRET} for Acme?`),
    "reader failed for question: …",
  );
  assert.equal(scrubMessage(`no evidence for '${SECRET}'`), "no evidence for '…'");
  assert.equal(scrubMessage(`no evidence for \`${SECRET}\``), "no evidence for `…`");
  // An open quote at the end of a cut message still closes over the rest.
  assert.equal(scrubMessage(`bad name "${SECRET}`), 'bad name "…"');
});

test("details, addresses, identifiers and long numbers are removed from what remains", () => {
  assert.equal(
    scrubMessage(`conflict Key (email)=(${SECRET}) on row`),
    "conflict Key (…)=(…) on row",
  );
  assert.equal(
    scrubMessage("fetch to https://user:pw@api.example.com/v1/entities/Acme%20Renewal?q=1 failed"),
    "fetch to https://api.example.com/… failed",
  );
  assert.equal(scrubMessage("sent to priya@acme.example today"), "sent to <email> today");
  assert.equal(
    scrubMessage(
      "org 3f2b8c1e-9a4d-4e2b-8f1a-0c9d8e7f6a5b missing, token deadbeefdeadbeefdeadbeef",
    ),
    "org <uuid> missing, token <hex>",
  );
  assert.equal(scrubMessage("invoice 20260914 overdue"), "invoice <n> overdue");
});

test("only the first line leaves: a second line is a detail, a query or a stack", () => {
  assert.equal(scrubMessage(`statement failed\nDETAIL: ${SECRET}\nselect 1`), "statement failed");
});

test("a message stays bounded however long the input", () => {
  const out = scrubMessage("x".repeat(5_000));
  assert.ok(out.length <= 201, `length ${out.length}`);
});
