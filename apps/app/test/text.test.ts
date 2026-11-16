import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { locate, paragraphs, unwrap } from "../web/text.js";

const DOC =
  "# Harbour Street office: lease renewal\n\nFrom: Facilities\nDate: 2026-03-04\n\n" +
  "The lease on the Harbour Street office renews on 1 September 2026 for a further three years. The landlord\n" +
  "has offered the same floor at 4% above the current rent.\n";

describe("words on the page", () => {
  it("finds a search's passage in its document, its spaces squeezed and its ellipsis dropped", () => {
    const passage =
      "From: Facilities Date: 2026-03-04 The lease on the Harbour Street office renews on 1 September…";
    const at = locate(DOC, passage);
    assert.ok(at);
    assert.equal(DOC.slice(at.start, at.start + 16), "From: Facilities");
    assert.equal(DOC.slice(at.end - 11, at.end), "1 September");
    assert.equal(locate(DOC, "nothing like this is in it"), null);
  });

  it("places a passage of repeated words by the part of it that occurs once", () => {
    const filler = "Tools hang on shadow boards so a missing one is seen at once. ".repeat(40);
    const doc = `${filler}\n\nThe torque wrench is calibrated every ninety days.\n\n${filler}`;
    const passage = `${filler.slice(-200)}The torque wrench is calibrated every ninety days.`;
    const at = locate(doc, passage);
    assert.ok(at);
    assert.match(doc.slice(at.start, at.end), /torque wrench is calibrated every ninety days\.$/);
  });

  it("flows a hand-wrapped paragraph and keeps short lines, without moving a single character", () => {
    const flowing = unwrap(DOC);
    assert.equal(flowing.length, DOC.length);
    assert.equal(
      paragraphs(flowing).at(-1)?.end,
      DOC.length - 1,
      "a paragraph ends before the file's last newline",
    );
    assert.match(flowing, /The landlord has offered/);
    assert.match(flowing, /From: Facilities\nDate/);
    assert.deepEqual(
      paragraphs(flowing).map(({ start, end }) => flowing.slice(start, end).slice(0, 12)),
      ["# Harbour St", "From: Facili", "The lease on"],
    );
  });
});
