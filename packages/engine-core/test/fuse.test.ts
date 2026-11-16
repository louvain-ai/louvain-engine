import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { fuse } from "../src/search/fuse.js";

const key = (row: string) => row;

test("a row two lists found outranks one only a single list found", () => {
  const fused = fuse(
    [
      { leg: "vector", rows: ["a", "b", "c"] },
      { leg: "keyword", rows: ["c", "d"] },
    ],
    key,
  );
  assert.equal(fused[0]?.row, "c");
  assert.deepEqual(fused[0]?.legs, ["vector", "keyword"]);
  assert.deepEqual(
    fused.map((f) => f.row),
    ["c", "a", "b", "d"],
  );
});

test("each list is ranked within itself: an empty list changes nothing", () => {
  const alone = fuse([{ leg: "vector", rows: ["a", "b"] }], key);
  const withEmpty = fuse(
    [
      { leg: "vector", rows: ["a", "b"] },
      { leg: "keyword", rows: [] },
    ],
    key,
  );
  assert.deepEqual(withEmpty, alone);
});

test("a score is the sum of 1 / (60 + rank) over the lists that found the row", () => {
  const [top] = fuse(
    [
      { leg: "one", rows: ["x"] },
      { leg: "two", rows: ["y", "x"] },
    ],
    key,
  );
  assert.equal(top?.row, "x");
  assert.ok(Math.abs((top?.score ?? 0) - (1 / 61 + 1 / 62)) < 1e-12);
});

test("a penalty pushes a row down by whole ranks inside its list", () => {
  const fused = fuse([{ leg: "vector", rows: ["generated", "written"] }], key, {
    penalty: (row) => (row === "generated" ? 5 : 0),
  });
  assert.deepEqual(
    fused.map((f) => f.row),
    ["written", "generated"],
  );
});

test("the tie-break orders equal scores, and without one the lists' own order stands", () => {
  const lists = [
    { leg: "one", rows: ["b"] },
    { leg: "two", rows: ["a"] },
  ];
  assert.deepEqual(
    fuse(lists, key).map((f) => f.row),
    ["b", "a"],
  );
  assert.deepEqual(
    fuse(lists, key, { tieBreak: (x, y) => x.localeCompare(y) }).map((f) => f.row),
    ["a", "b"],
  );
});

test("the options' defaults are the published fusion: k 60, every weight 1, ranks by position", () => {
  const lists = [
    { leg: "vector", rows: ["a", "b", "c"] },
    { leg: "keyword", rows: ["c", "d"] },
  ];
  assert.deepEqual(
    fuse(lists, key, { method: "rrf", k: 60, weights: { vector: 1, keyword: 1 } }),
    fuse(lists, key),
  );
});

test("a weight scales its leg's share of the score", () => {
  const lists = [
    { leg: "vector", rows: ["meaning"] },
    { leg: "keyword", rows: ["words"] },
  ];
  assert.deepEqual(
    fuse(lists, key).map((f) => f.score),
    [1 / 61, 1 / 61],
  );
  const weighted = fuse(lists, key, { weights: { keyword: 2 } });
  assert.deepEqual(
    weighted.map((f) => [f.row, f.score]),
    [
      ["words", 2 / 61],
      ["meaning", 1 / 61],
    ],
  );
});

test("a given rank is the row's place in its leg: a gap left by a cap is kept, not closed", () => {
  const fused = fuse([{ leg: "vector", rows: ["a", "b"], ranks: [1, 4] }], key);
  assert.deepEqual(
    fused.map((f) => f.score),
    [1 / 61, 1 / 64],
  );
});

test("k is the damping constant: a larger one flattens the curve", () => {
  const [first, second] = fuse([{ leg: "vector", rows: ["a", "b"] }], key, { k: 1 });
  assert.equal(first?.score, 1 / 2);
  assert.equal(second?.score, 1 / 3);
});

type Scored = { id: string; score: number };
const id = (row: Scored) => row.id;
const scoreOf = (row: Scored) => row.score;
const convex = (
  lists: { leg: string; rows: Scored[] }[],
  tieBreak?: (a: Scored, b: Scored) => number,
) =>
  fuse(lists, id, { method: "convex", scoreOf, ...(tieBreak ? { tieBreak } : {}) }).map((f) => [
    f.row.id,
    f.score,
  ]);

test("convex: each list min-max scaled, alpha 0.75 on vector and 0.25 on keyword", () => {
  assert.deepEqual(
    convex([
      {
        leg: "vector",
        rows: [
          { id: "a", score: 0.75 },
          { id: "b", score: 0.5 },
          { id: "c", score: 0.25 },
        ],
      },
      {
        leg: "keyword",
        rows: [
          { id: "c", score: 12 },
          { id: "a", score: 2 },
        ],
      },
    ]),
    [
      ["a", 0.75],
      ["b", 0.375],
      ["c", 0.25],
    ],
  );
});

test("convex: a list whose scores are all equal scales to 1, and one row is all equal", () => {
  assert.deepEqual(
    convex([
      { leg: "vector", rows: [{ id: "a", score: 0.4 }] },
      {
        leg: "keyword",
        rows: [
          { id: "b", score: 3 },
          { id: "c", score: 3 },
        ],
      },
    ]),
    [
      ["a", 0.75],
      ["b", 0.25],
      ["c", 0.25],
    ],
  );
});

test("convex: a row one list lacks scores 0 there", () => {
  const [only] = fuse([{ leg: "keyword", rows: [{ id: "k", score: 5 }] }], id, {
    method: "convex",
    scoreOf,
  });
  assert.equal(only?.score, 0.25);
  assert.deepEqual(only?.legs, ["keyword"]);
});

test("convex: equal scores fall to tieBreak", () => {
  const lists = [
    {
      leg: "vector",
      rows: [
        { id: "y", score: 1 },
        { id: "x", score: 0 },
      ],
    },
    {
      leg: "keyword",
      rows: [
        { id: "x", score: 1 },
        { id: "y", score: 0 },
      ],
    },
  ];
  const fused = fuse(lists, id, { method: "convex", scoreOf, alpha: 0.5 });
  assert.deepEqual(
    fused.map((f) => f.score),
    [0.5, 0.5],
  );
  assert.deepEqual(
    convex(lists).map(([row]) => row),
    ["y", "x"],
  );
  const byId = (a: Scored, b: Scored) => a.id.localeCompare(b.id);
  assert.deepEqual(
    fuse(lists, id, { method: "convex", scoreOf, alpha: 0.5, tieBreak: byId }).map((f) => f.row.id),
    ["x", "y"],
  );
});

test("the types refuse convex without scoreOf, and rank options on convex", () => {
  const file = fileURLToPath(new URL("./fuse.types.ts", import.meta.url));
  const config = fileURLToPath(new URL("../tsconfig.json", import.meta.url));
  const parsed = ts.getParsedCommandLineOfConfigFile(
    config,
    {},
    { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => {} },
  );
  assert.ok(parsed);
  const options = { ...parsed.options, noEmit: true, rootDir: undefined };
  const messages = ts
    .getPreEmitDiagnostics(ts.createProgram([file], options))
    .map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n"));
  assert.deepEqual(messages, []);
});
