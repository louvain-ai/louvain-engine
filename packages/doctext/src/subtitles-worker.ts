/**
 * The transcript parse in a process of its own (`subtitles.ts` runs it through `inWorker`, which kills it at the
 * deadline and caps its heap). Its input is bounded before it is sent here; this only parses.
 */
import { subtitleText } from "./subtitles-read.js";
import { serveReader } from "./worker.js";

serveReader(({ source, maxChars }: { source: string; maxChars: number }) =>
  subtitleText(source, maxChars),
);
