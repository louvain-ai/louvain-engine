import assert from "node:assert/strict";
import { test } from "node:test";
import { SEARCH_USAGE, searchArgs } from "../src/cli/search-args.js";

test("the words are every argument that is not a flag", () => {
  assert.deepEqual(searchArgs(["lease", "renewal"]), { words: "lease renewal", fullIds: false });
  assert.deepEqual(searchArgs(["--full-ids", "lease"]), { words: "lease", fullIds: true });
});

test("--question takes the next argument, or its own value, as the person's question", () => {
  assert.deepEqual(searchArgs(["--question", "When does the lease renew?", "lease renewal"]), {
    words: "lease renewal",
    fullIds: false,
    question: "When does the lease renew?",
  });
  assert.deepEqual(searchArgs(["lease", "--question=When does it renew?", "--full-ids"]), {
    words: "lease",
    fullIds: true,
    question: "When does it renew?",
  });
});

test("no words, or a --question with nothing after it, is the usage, never a search for a flag", () => {
  assert.equal(searchArgs([]), null);
  assert.equal(searchArgs(["--full-ids"]), null);
  assert.equal(searchArgs(["lease", "--question"]), null);
  assert.equal(searchArgs(["--question", "When?"]), null);
  assert.match(SEARCH_USAGE, /--question "<question>"/);
});
