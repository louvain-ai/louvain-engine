import { setTimeout as wait } from "node:timers/promises";
import { definePlugin } from "@louvain/engine-core";
import { z } from "zod";
import type { AnswerEvent, BoundTool } from "./answerer.js";

/**
 * An answerer with no model, and the example of writing one. Through the same bound tools any answerer gets, it
 * searches for the question, reads the two best documents, and answers with the sentence of each that shares most
 * words with the question, cited; when the search matched nothing, or no sentence shares a word with the question, it
 * says the sources do not say. Deterministic and free: the tests use it.
 * `paceMs` paces its words, so the streaming can be watched: `scripted({ paceMs: 40 })`.
 */

const settings = z.object({ paceMs: z.number().int().min(0).max(2_000).default(0) });

/** The small words every sentence has, which say nothing about whether a sentence answers. */
const QUIET = new Set(
  "the and for are was were what when where which who why how does did has have had with this that from into".split(
    " ",
  ),
);

const words = (text: string) =>
  new Set((text.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []).filter((w) => !QUIET.has(w)));

/**
 * The sentence of a text that shares most words with the question, and how many; the first on a tie. A sentence ends
 * at its stop, a blank line, or a line that ends short (a heading, an address line); a long line is only wrapped.
 */
function bestSentence(text: string, question: Set<string>): { sentence: string; shared: number } {
  const ends = /\n\s*\n|(?<=^[^\n]{0,63})\n|(?<=[.!?])\s+(?=\S)/m;
  // A word is shared when it begins as a question's word does ("renews" and "renewal" share "renew").
  const stems = [...question].map((w) => w.slice(0, 5));
  const shared = (s: string) =>
    stems.filter((stem) => [...words(s)].some((w) => w.startsWith(stem))).length;
  // A sentence beats a heading of the same words: a whole sentence is what an answer quotes.
  const score = (s: string) => shared(s) * 2 + (s.length >= 40 ? 1 : 0);
  const sentences = text.split(ends).map((s) => s.replace(/\s+/g, " ").trim());
  const best = sentences.reduce((top, s) => (score(s) > score(top) ? s : top), "");
  return { sentence: best, shared: shared(best) };
}

const named = (tools: readonly BoundTool[], name: string) => {
  const tool = tools.find((t) => t.name === name);
  if (!tool) throw new Error(`the scripted answerer needs a tool named ${name}`);
  return tool;
};

export const scripted = definePlugin({
  kind: "answerer",
  name: "scripted",
  settings,
  create: ({ paceMs: pace }) => ({
    async *answer({ question, tools, signal }): AsyncGenerator<AnswerEvent> {
      // Paced, a step takes as long as a dozen words, so the trail can be watched and photographed.
      const pause = async (words: number) => {
        if (pace) await wait(pace * words, undefined, { signal });
      };
      const asked = words(question);
      const found = await named(tools, "search_documents").run({ query: question });
      // A search that matched nothing says so before its documents: what only resembles the question is no answer.
      const matched = found.text.startsWith("<<document");
      const quoted: { ref: string; sentence: string }[] = [];
      for (const { ref } of matched ? found.shown.slice(0, 2) : []) {
        await pause(12);
        // A read is a fence line, the document's heading, a blank line, its text, a fence line: only the text is quoted.
        const read = (await named(tools, "read_document").run({ source: ref })).text;
        const best = bestSentence(
          read.slice(read.indexOf("\n\n") + 2, read.lastIndexOf("\n<<end ")),
          asked,
        );
        if (best.shared > 0) quoted.push({ ref, sentence: best.sentence });
      }
      await pause(12);
      if (quoted.length === 0) yield { type: "no-answer", why: "sources-silent" };
      for (const [i, { ref, sentence }] of quoted.entries()) {
        yield { type: "cite", ref };
        for (const piece of `${i ? "\n\n" : ""}${sentence} [${ref}]`.match(/\s*\S+/g) ?? []) {
          await pause(1);
          yield { type: "text", text: piece };
        }
      }
      yield { type: "done" };
    },
  }),
});
