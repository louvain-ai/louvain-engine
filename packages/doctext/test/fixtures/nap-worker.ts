// Naps, then answers when it started (`test/bounds.test.ts`: at most MAX_READERS run at once).
import { serveReader } from "../../src/worker.ts";

serveReader(async () => {
  const started = Date.now();
  await new Promise((r) => setTimeout(r, 400));
  return started;
});
