// Answers with the names in its environment (`test/bounds.test.ts`: a reader holds nothing worth stealing).
import { serveReader } from "../../src/worker.ts";

serveReader(() => Object.keys(process.env).sort());
