// A reader that keeps allocating: `inWorker` must report it as out of memory, not as a crash (`test/bounds.test.ts`).
const held: string[][] = [];
for (;;) held.push(Array.from({ length: 100_000 }, (_, i) => `row ${i} ${held.length}`));
