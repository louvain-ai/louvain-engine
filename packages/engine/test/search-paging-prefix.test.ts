import assert from "node:assert/strict";
import { test } from "node:test";
import { fillFromListing, idPrefix } from "../src/server/tools/search-paging.js";

/**
 * A listing cursor skips by ID prefix (`idPrefix`, 16 characters): a prefix only hides the rows it names. Two ids
 * that share their first 15 characters and differ at the 16th are two prefixes, so skipping one never hides the other.
 */
test("a skipped id prefix hides exactly its own document, not one differing at the 16th character", async () => {
  const a = `${"a".repeat(15)}1${"0".repeat(48)}`;
  const b = `${"a".repeat(15)}2${"0".repeat(48)}`;
  assert.equal(a.slice(0, 15), b.slice(0, 15));
  assert.notEqual(idPrefix(a), idPrefix(b));
  const rows = [a, b].map((id) => ({ id: idPrefix(id), whole: id }));
  const got = await fillFromListing(async () => ({ rows, hasMore: false }), {
    from: 0,
    want: 10,
    skip: new Set([idPrefix(a)]),
    pageSize: 24,
  });
  assert.deepEqual(
    got.rows.map((r) => r.whole),
    [b],
    "only the skipped document is hidden",
  );
  // A cursor sealed before prefixes carried whole ids: cut the same way, they skip the same rows.
  assert.equal(idPrefix(idPrefix(a)), idPrefix(a));
});

/**
 * More means a row the next page will show. A matched search said `hasMore: true` and its next page came back empty:
 * the rows left were all ones the head had already shown, which the next page skips. `hasMore` counts only rows it
 * would show.
 */
const listed = (ids: string[]) => ids.map((id) => ({ id }));
const pages =
  (...ps: string[][]) =>
  async (offset: number) => {
    let at = 0;
    for (const [n, p] of ps.entries()) {
      if (offset < at + p.length || n === ps.length - 1)
        return { rows: listed(p.slice(offset - at)), hasMore: n < ps.length - 1 };
      at += p.length;
    }
    return { rows: [], hasMore: false };
  };
const fill = (page: ReturnType<typeof pages>, want: number, skip: string[]) =>
  fillFromListing(page, { from: 0, want, skip: new Set(skip), pageSize: 3 });

test("rows left that the next page would skip are not more", async () => {
  const got = await fill(pages(["a", "b", "c", "d", "e"]), 3, ["d", "e"]);
  assert.deepEqual(
    got.rows.map((r) => r.id),
    ["a", "b", "c"],
  );
  assert.equal(got.hasMore, false);
});

test("a page the head filled says more only when the listing holds a row not yet shown", async () => {
  assert.equal((await fill(pages(["a", "b"]), 0, ["a", "b"])).hasMore, false);
  assert.equal((await fill(pages(["a", "b"]), 0, ["a"])).hasMore, true);
});

test("the look-ahead reads past a page of skips to find whether more remains", async () => {
  const none = await fill(pages(["a", "b", "c"], ["d", "e"]), 2, ["c", "d", "e"]);
  assert.deepEqual([none.rows.map((r) => r.id), none.hasMore], [["a", "b"], false]);
  const one = await fill(pages(["a", "b", "c"], ["d", "e"]), 2, ["c", "d"]);
  assert.deepEqual([one.rows.map((r) => r.id), one.hasMore, one.next], [["a", "b"], true, 4]);
});
