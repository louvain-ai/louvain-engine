import { readFileSync } from "node:fs";
import type { Agent } from "./agent/agent.js";
import { answerOne } from "./agent/answer.js";
import type { Outcome, Question } from "./agent/types.js";
import { writeOutputs } from "./outputs.js";

/**
 * The run over the questions, in file order, one at a time. A question does not start when the spend so far plus the
 * dearest question so far could pass the budget. One that failed before any token was not asked: it is listed, and
 * three in a row stop the run. Three that end on a provider error stop it too, naming every question still to ask.
 */
export type Prices = { input: number; output: number; cacheRead: number; cacheWrite: number };
export type RunSettings = { budgetUsd: number; prices: Prices; out: string };

const PROVIDER_ERROR =
  /\b5\d\d\b|overloaded|capacity|credential validation|temporarily unavailable/i;
const PROVIDER_STOP = 3;

/** The benchmark's questions, all of them or those whose ids are listed. */
export function questionsFrom(file: string, only: ReadonlySet<string> | null): Question[] {
  const rows = readFileSync(file, "utf8")
    .split("\n")
    .filter((l) => l.trim());
  const questions = rows.map((l) => JSON.parse(l) as Question);
  return only ? questions.filter((q) => only.has(q.question_id)) : questions;
}

export async function runQuestions(
  questions: readonly Question[],
  agent: Agent,
  s: RunSettings,
): Promise<number> {
  const run = { outcomes: [] as Outcome[], notAsked: [] as string[], spent: 0 };
  const providerErrored: string[] = [];
  let dearest = 0.5;
  let failingInARow = 0;
  for (const [i, q] of questions.entries()) {
    if (failingInARow >= 3) run.notAsked.push(q.question_id);
    else if (run.spent + dearest > s.budgetUsd)
      return stopped(run, s.out, { why: `the next could pass $${s.budgetUsd}`, code: 3 });
    else {
      const o = await answerOne(q, agent);
      const cost = costOf(o, s.prices);
      if (o.stopped === "error" && cost === 0 && tokensOf(o) === 0) {
        run.notAsked.push(o.question_id);
        failingInARow += 1;
        continue;
      }
      failingInARow = 0;
      run.outcomes.push(o);
      run.spent += cost;
      dearest = run.outcomes.length === 1 ? cost : Math.max(dearest, cost);
      console.log(
        `  ${o.question_id}: ${o.stopped}, ${o.turns} turn(s), $${cost.toFixed(4)}, ${o.document_ids.length} doc(s)`,
      );
      if (o.stopped === "error" && PROVIDER_ERROR.test(o.error ?? ""))
        providerErrored.push(o.question_id);
      if (providerErrored.length >= PROVIDER_STOP) {
        const rest = [...providerErrored, ...questions.slice(i + 1).map((x) => x.question_id)];
        return stopped(run, s.out, { why: `provider errors; re-ask ${rest.join(",")}`, code: 7 });
      }
    }
  }
  writeOutputs(s.out, run);
  return 0;
}

/** A run that stops early still writes what it answered, and says why. */
function stopped(
  run: Parameters<typeof writeOutputs>[1],
  out: string,
  { why, code }: { why: string; code: number },
): number {
  console.log(`  stopped after ${run.outcomes.length} question(s): ${why}`);
  writeOutputs(out, run);
  return code;
}

const tokensOf = (o: Outcome) =>
  o.usage.input + o.usage.output + o.usage.cacheRead + o.usage.cacheWrite;

const costOf = (o: Outcome, p: Prices): number =>
  (o.usage.input * p.input +
    o.usage.output * p.output +
    o.usage.cacheRead * p.cacheRead +
    o.usage.cacheWrite * p.cacheWrite) /
  1e6;
