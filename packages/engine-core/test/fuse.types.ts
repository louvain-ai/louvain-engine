/**
 * The fusion guarantees that are types, compiled and never run by `fuse.test.ts`: an `@ts-expect-error` that stops
 * being an error fails that compile, so each line below holds.
 */
import { fuse } from "../src/fuse.js";

const lists = [{ leg: "vector", rows: [{ id: "a", score: 0.9 }] }];
const key = (row: { id: string }) => row.id;

// Convex reads each row's score, so it does not compile without `scoreOf`.
// @ts-expect-error convex needs scoreOf
fuse(lists, key, { method: "convex" });

// Rank options belong to rank fusion: convex takes no `k`.
// @ts-expect-error k is reciprocal rank's
fuse(lists, key, { method: "convex", scoreOf: (r) => r.score, k: 60 });

export const convex = fuse(lists, key, { method: "convex", scoreOf: (r) => r.score });
export const rrf = fuse(lists, key, { k: 60, weights: { vector: 2 } });
