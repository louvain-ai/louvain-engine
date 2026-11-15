import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type Guidance, loadTexts } from "../text/index.js";
import type { Agent } from "./agent/agent.js";
import { SCORED_LOOP } from "./agent/types.js";
import { type Prices, questionsFrom, runQuestions } from "./ask.js";
import { databaseKeys } from "./keys.js";
import { messagesApi } from "./messages-api.js";
import { RERANK_MODEL, SCORED_MODEL } from "./scored.js";
import type { Place } from "./steps.js";
import { stubKeys, stubModel, stubServer } from "./stubs.js";
import { engineToken, mcpServer } from "./tools/mcp.js";
import { offeredTools } from "./tools/offer.js";

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
};

export async function check(p: Place, engine: string): Promise<void> {
  const signal = AbortSignal.timeout(60_000);
  const say = { role: "user" as const, content: [{ type: "text", text: "OK?" }] };
  await messagesApi({ ...SCORED_MODEL, maxOutputTokens: 64 })(
    { system: "Reply OK.", messages: [say], tools: [], final: true },
    signal,
  );
  console.log("anthropic: answered");
  const key = process.env.COHERE_API_KEY;
  if (!key) throw new Error("COHERE_API_KEY is not set: the scored reranker needs it");
  const rerank = await fetch("https://api.cohere.com/v2/rerank", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({ model: RERANK_MODEL, query: "check", documents: ["check"] }),
    signal,
  });
  if (!rerank.ok) throw new Error(`cohere rerank answered ${rerank.status}`);
  console.log("cohere rerank: answered");
  offeredTools(loadTexts().tools, await mcpServer(engine, engineToken(p.engineRoot)).list(signal));
  console.log("engine: serves both scored tools\nOK");
}

export async function ask(
  p: Place,
  o: AskOptions,
  budget: { usd: number; prices: Prices },
): Promise<number> {
  const texts = loadTexts(o.guidance);
  const server = o.dry ? stubServer(texts.tools) : mcpServer(o.engine, engineToken(p.engineRoot));
  const served = await server.list(AbortSignal.timeout(60_000));
  const agent: Agent = {
    model: o.dry ? stubModel() : messagesApi(SCORED_MODEL),
    server,
    served,
    offered: offeredTools(texts.tools, served),
    texts,
    keys: o.dry ? stubKeys() : databaseKeys(p.engineRoot),
    loop: SCORED_LOOP,
  };
  const questions = o.dry
    ? [{ question_id: "dry_1", question: "What did the stub say?" }]
    : questionsOf(p, o.sample);
  console.log(
    `ask: ${questions.length} question(s), ${o.dry ? "dry run" : SCORED_MODEL.model}, guidance ${o.guidance}`,
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
          readFileSync(join(p.profile, "data/sample-ids.txt"), "utf8").split(/\s+/).filter(Boolean),
        );
  return questionsFrom(join(p.state, "benchmark/questions.jsonl"), ids);
}
