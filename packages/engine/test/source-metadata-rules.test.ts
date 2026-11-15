import assert from "node:assert/strict";
import { test } from "node:test";
import type { Revision } from "../src/ingest/revision.js";
import { type SourceRules, sourceMetadata } from "../src/sources/metadata.js";

/**
 * THE OPEN WRITER IS GENERIC; A BUILD'S RULES ARE ASKED FIRST (`SourceOrigin.rules`). Without rules a source is what it
 * states: its native id (else its event), its link, its first line, its kind by event kind. Rules may recover an id from
 * the event's key, scope a native id by its collection, skip a lead before the title, and name a kind; what the source
 * itself states still wins.
 */
const event = {
  id: "01K4S7MJA7NKCFQA22HMGPXDZQ",
  idempotencyKey: "legacy:abc123",
  kind: "message",
  occurredAt: "2026-01-02T03:04:05.000Z",
  actor: { sourceUserId: "u1", displayName: "Ann" },
  body: { text: "Lead line.\n\nThe renewal is signed." },
  source: { connector: "mailer", workspace: "shared-1", container: "box-a" },
} as unknown as Revision;
const plain = { presentation: () => ({ success: false as const }) };

test("without rules: the event's own id, no link, the first line, a message", () => {
  const m = sourceMetadata(event, "org-1", plain);
  assert.equal(m?.nativeId, `event:${event.id}`);
  assert.equal(m?.url, null);
  assert.equal(m?.title, "Lead line.");
  assert.equal(m?.kind, "message");
});

test("with rules: a recovered id and its link, a scoped native id, the lead skipped, the kind named", () => {
  const rules: SourceRules = {
    recoveredId: (e) => /^legacy:(\w+)$/.exec(e.idempotencyKey)?.[1],
    recoveredLink: (_e, id) => `https://mail.example/${id}`,
    scopesNativeId: (e) => e.source.workspace.startsWith("shared-"),
    titleText: (_e, text) => text.slice(text.indexOf("\n\n") + 2),
    kind: () => "email",
  };
  const m = sourceMetadata(event, "org-1", { ...plain, rules });
  assert.equal(m?.nativeId, JSON.stringify(["box-a", "abc123"]));
  assert.equal(m?.url, "https://mail.example/abc123");
  assert.equal(m?.title, "The renewal is signed.");
  assert.equal(m?.kind, "email");
  assert.notEqual(m?.id, sourceMetadata(event, "org-1", plain)?.id);
  const stated = {
    ...event,
    source: {
      ...event.source,
      nativeId: "N1",
      ref: "https://x.example/1",
      type: "ticket",
      title: "Given",
    },
  } as Revision;
  const s = sourceMetadata(stated, "org-1", { ...plain, rules });
  assert.equal(
    s?.nativeId,
    JSON.stringify(["box-a", "N1"]),
    "a stated id is still scoped by the collection",
  );
  assert.equal(s?.url, "https://x.example/1");
  assert.equal(s?.kind, "ticket");
  assert.equal(s?.title, "Given");
});
