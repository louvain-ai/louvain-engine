import assert from "node:assert/strict";
import { test } from "node:test";
import { conversationOf } from "../src/kg/core/conversation.js";

/**
 * A message is read in its conversation (`kg/core/conversation.ts`): the pure
 * half — which conversation a body names. `CONVERSATION_KEY_SQL` is its SQL twin.
 */

test("the conversation is the source's own thread id, and only a non-empty string is one", () => {
  assert.deepEqual(conversationOf({ text: "x", presentation: { email: { threadId: "t-1" } } }), {
    key: "t-1",
    root: false,
  });
  assert.deepEqual(
    conversationOf({ text: "x", presentation: { thread: { id: "C1:1700000000.000100" } } }),
    { key: "C1:1700000000.000100", root: false },
  );
  assert.deepEqual(
    conversationOf({ presentation: { thread: { id: "C1:1700000000.000100", root: true } } }),
    { key: "C1:1700000000.000100", root: true },
    "a message that starts a thread in a channel is a turn of the channel",
  );
  // A mail thread wins over anything else a body carries, as the SQL's coalesce does.
  assert.equal(
    conversationOf({ presentation: { email: { threadId: "m" }, thread: { id: "c", root: true } } })
      ?.key,
    "m",
  );
  for (const body of [
    null,
    "text",
    { text: "no presentation" },
    { presentation: { email: { threadId: "" } } },
    { presentation: { email: { threadId: 42 } } },
    { presentation: { thread: { id: { nested: true } } } },
    { presentation: { email: { subject: "Re: hello" } } },
  ]) {
    assert.equal(conversationOf(body), null, JSON.stringify(body));
  }
});
