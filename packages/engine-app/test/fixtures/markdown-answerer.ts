import { setTimeout as wait } from "node:timers/promises";
import { definePlugin } from "@louvain/engine-core";
import { z } from "zod";
import type { AnswerEvent, BoundTool } from "../../src/ask/answerer.js";

/**
 * A test answerer that writes markdown, for the page's checks and pictures: it searches for the question, reads the
 * two best documents (none when the search matched nothing), and writes a fixed answer in markdown citing them
 * (headings, a list, a table, a quote, code). Asked about "planted", it writes what an answer must never turn into markup: raw HTML, a script, an image, a `javascript:`
 * link, and a citation that tries to close itself. Development only: `answerer: markdown()` in `engine.config.ts`.
 */

const settings = z.object({ paceMs: z.number().int().min(0).max(2_000).default(0) });

const tool = (tools: readonly BoundTool[], name: string) =>
  tools.find((t) => t.name === name) as BoundTool;

const planted = (a: string) =>
  [
    `The answer plants markup [${a}].`,
    '<img src=x onerror="alert(1)"> <script>alert(2)</script> <b style="color:red">bold?</b>',
    `[a link](javascript:alert(3)) and ![an image](https://example.com/x.png) and [${a}](javascript:alert(4))`,
    `<span class="cited">[${a}</span>] and [${a}]"><a href="x">`,
  ].join("\n\n");

const written = (a: string, b: string) =>
  [
    "## What the documents say",
    `The **Harbour Street** lease renews on *1 September 2026* for three years [${a}], and the landlord offered the same floor at 4% above the current rent [${a}].`,
    "### What to do next",
    [
      `- Confirm the renewal with Facilities by the end of the month [${a}].`,
      `- Budget the facilities fee, which is \`GBP 2,400\` a month [${b}].`,
      "- Ask whether the service level changes on renewal.",
    ].join("\n"),
    [
      "| Item | Amount | Source |",
      "| --- | --: | --- |",
      `| Rent increase | 4% | lease [${a}] |`,
      `| Facilities fee | GBP 2,400 | agreement [${b}] |`,
    ].join("\n"),
    `> The landlord has offered the same floor at 4% above the current rent [${a}].`,
    `Both documents are [the lease](${a}) and [the agreement](${b}).`,
  ].join("\n\n");

export const markdown = definePlugin({
  kind: "answerer",
  name: "markdown",
  settings,
  create: ({ paceMs: pace }) => ({
    async *answer({ question, tools, signal }): AsyncGenerator<AnswerEvent> {
      const found = await tool(tools, "search_documents").run({ query: question });
      // A search that matched nothing says so before its documents: only resemblance is no answer.
      const matched = found.text.startsWith("<<document");
      const refs = matched ? found.shown.slice(0, 2).map((s) => s.ref) : [];
      for (const ref of refs) await tool(tools, "read_document").run({ source: ref });
      const [a = "", b = a] = refs;
      if (!a) return yield { type: "no-answer", why: "sources-silent" };
      for (const ref of new Set([a, b])) yield { type: "cite", ref };
      const text = /planted/i.test(question) ? planted(a) : written(a, b);
      for (const piece of text.match(/\s*\S+/g) ?? []) {
        if (pace) await wait(pace, undefined, { signal });
        yield { type: "text", text: piece };
      }
      yield { type: "done" };
    },
  }),
});
