import assert from "node:assert/strict";
import { test } from "node:test";
import { displayAuthor } from "../src/sources/metadata.js";

/**
 * A connector that cannot tell who wrote a record says `actor: "unknown"`, and the viewer printed it as a
 * name. A placeholder is no author: the listing carries none, and the viewer leaves the line out. The names are invented.
 */
test("a placeholder author is no author; a name is kept as written", () => {
  assert.equal(displayAuthor("unknown"), null);
  assert.equal(displayAuthor(" Unknown "), null);
  assert.equal(displayAuthor(""), null);
  assert.equal(displayAuthor(null), null);
  assert.equal(displayAuthor(undefined), null);
  assert.equal(displayAuthor("Priya Nair"), "Priya Nair");
  assert.equal(displayAuthor("unknown.person@acme.test"), "unknown.person@acme.test");
});

/** A connector's own system actor, stamped on a record with no author, is no more a person than "unknown". */
test("a connector's system actor is no author; a bot's name and a person's are kept", () => {
  assert.equal(displayAuthor("microsoft-entra-system"), null);
  assert.equal(displayAuthor("google-directory-system"), null);
  assert.equal(displayAuthor("system"), null);
  assert.equal(displayAuthor("dependabot[bot]"), "dependabot[bot]");
  assert.equal(displayAuthor("Systems Team"), "Systems Team");
  assert.equal(displayAuthor("ops@system.acme.test"), "ops@system.acme.test");
});
