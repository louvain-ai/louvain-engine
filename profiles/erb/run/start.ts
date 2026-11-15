import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type Guidance, loadTexts } from "../text/index.js";
import type { Agent } from "./agent/agent.js";
import { SCORED_LOOP } from "./agent/types.js";
import { type Prices, questionsFrom, runQuestions } from "./ask.js";
import { embedderAnswers } from "./embedder.js";
import { databaseKeys } from "./keys.js";
import type { Place } from "./steps.js";
import { stubKeys, stubModel, stubServer } from "./stubs.js";
import { engineToken, mcpServer } from "./tools/mcp.js";
import { offeredTools } from "./tools/offer.js";
import type { Variant } from "./variants.js";

/**
 * The two steps that spend: `check`, which costs a tiny call to each provider and must pass before a run, and `ask`,
 * the agent over the questions under a hard budget. A dry run spends nothing: a stub model, a stub server, one question.
 */
export type AskOptions = {
  guidance: Guidance;
  sample: "all" | "every-fifth";
  engine: string;
  out: string;
  dry: boolean;
  variant: Variant;
};

export async function check(p: Place, engine: string, variant: Variant): Promise<void> {
  const signal = AbortSignal.timeout(60_000);
  await embedderAnswers(p, signal);
  await variant.check(signal, p);
  offeredTools(loadTexts().tools, await mcpServer(engine, engineToken(p.state)).list(signal));
  console.log("engine: serves both scored tools\nOK");
}

export async function ask(
  p: Place,
  o: AskOptions,
  budget: { usd: number; prices: Prices },
): Promise<number> {
  const { variant } = o;
  const texts = loadTexts(o.guidance);
  const server = o.dry ? stubServer(texts.tools) : mcpServer(o.engine, engineToken(p.state));
  const served = await server.list(AbortSignal.timeout(60_000));
  const agent: Agent = {
    model: o.dry ? stubModel() : variant.model(),
    server,
    served,
    offered: offeredTools(texts.tools, served),
    texts,
    keys: o.dry ? stubKeys() : databaseKeys(p),
    loop: SCORED_LOOP,
  };
  const questions = o.dry
    ? [{ question_id: "dry_1", question: "What did the stub say?" }]
    : questionsOf(p, o.sample);
  console.log(
    `ask: ${questions.length} question(s), ${o.dry ? "dry run" : variant.answerer}, guidance ${o.guidance}`,
  );
  return runQuestions(questions, agent, {
    budgetUsd: budget.usd,
    prices: budget.prices,
    out: o.out,
  });
}

/** All 500, or the 100 the scored figures were measured on (`data/sample-ids.txt`: every fifth, in file order). */
function questionsOf(p: Place, sample: AskOptions["sample"]) {
  const ids =
    sample === "all"
      ? null
      : new Set(
          readFileSync(join(p.data, "data/sample-ids.txt"), "utf8").split(/\s+/).filter(Boolean),
        );
  return questionsFrom(join(p.state, "benchmark/questions.jsonl"), ids);
}
