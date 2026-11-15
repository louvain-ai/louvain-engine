import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Outcome } from "./agent/types.js";

/**
 * What a run leaves: `answers.jsonl` in the evaluator's shape, `answers.full.jsonl` with each question's turns and
 * tokens, `traces.jsonl` with every call, and `summary.json`. Read the summary's `degradedSearches` first: a search
 * ranked without the reranker is not the scored configuration.
 */
export function writeOutputs(
  out: string,
  run: { outcomes: Outcome[]; notAsked: string[]; spent: number },
): void {
  mkdirSync(out, { recursive: true });
  const lines = (rows: readonly unknown[]) => rows.map((r) => `${JSON.stringify(r)}\n`).join("");
  const { outcomes } = run;
  const answers = outcomes.map(({ question_id, answer, document_ids }) => ({
    question_id,
    answer,
    document_ids,
  }));
  writeFileSync(join(out, "answers.jsonl"), lines(answers));
  writeFileSync(
    join(out, "answers.full.jsonl"),
    lines(outcomes.map(({ steps: _steps, ...o }) => o)),
  );
  writeFileSync(
    join(out, "traces.jsonl"),
    lines(outcomes.map(({ question_id, stopped, steps }) => ({ question_id, stopped, steps }))),
  );
  const summary = summaryOf(run);
  writeFileSync(join(out, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
  console.log(`summary: ${JSON.stringify(summary)}`);
}

function summaryOf(run: { outcomes: Outcome[]; notAsked: string[]; spent: number }) {
  const { outcomes } = run;
  const steps = outcomes.flatMap((o) => o.steps);
  const n = Math.max(1, outcomes.length);
  const tally = (names: readonly string[]) =>
    names.reduce<Record<string, number>>((t, k) => Object.assign(t, { [k]: (t[k] ?? 0) + 1 }), {});
  return {
    questions: outcomes.length,
    notAsked: run.notAsked,
    spentUsd: Math.round(run.spent * 1e6) / 1e6,
    meanTurns: outcomes.reduce((t, o) => t + o.turns, 0) / n,
    searches: steps.filter((s) => s.tool === "louvain_search_sources").length / n,
    reads: steps.filter((s) => s.tool === "louvain_read_source").length / n,
    floorReminders: outcomes.reduce((t, o) => t + o.floorReminders, 0),
    forcedFinal: outcomes.filter((o) => o.forcedFinal).length,
    nudged: outcomes.filter((o) => o.nudged).length,
    stopped: tally(outcomes.map((o) => o.stopped)),
    strippedArguments: tally(steps.flatMap((s) => (s.stripped ?? []).map((a) => `${s.tool}.${a}`))),
    degradedSearches: tally(steps.flatMap((s) => s.degraded ?? [])),
  };
}
