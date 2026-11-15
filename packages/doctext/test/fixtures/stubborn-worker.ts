// A reader that ignores SIGTERM and never answers: `inWorker` must still end it at the deadline (`test/bounds.test.ts`).
process.on("SIGTERM", () => {});
setInterval(() => {}, 1_000);
