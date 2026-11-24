import assert from "node:assert/strict";
import { test } from "node:test";
import { displayAuthor } from "../src/read/originals/metadata.js";

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

/**
 * A connection's own subject (`installer-<connection uuid>`) is an identifier for a connection's owner: a LinkedIn
 * conversation showed the owner's own messages as sent by it. Never a byline, at write or at read.
 */
test("a connection's installer subject is no author; words that merely start with it are kept", () => {
  assert.equal(displayAuthor("installer-0b5e2c1a-7d4f-4e2b-9a61-3c8d5f0e1b27"), null);
  assert.equal(displayAuthor(" INSTALLER-0B5E2C1A-7D4F-4E2B-9A61-3C8D5F0E1B27 "), null);
  assert.equal(displayAuthor("installer-scoped OAuth"), "installer-scoped OAuth");
  assert.equal(displayAuthor("Dana Installer"), "Dana Installer");
});
