import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The benchmark's own evaluator, unmodified, with Claude Haiku 5.5 as both of its models. It runs raw (the answers as
 * published), then corrected (its three-judge consensus may rewrite a question's expected answer for this run), which
 * is the figure the board reports. A judge call that failed comes back as a row with empty reasoning and a zero; each
 * is named, and `rejudgeFailed` asks again for those rows only and says how many it replaced.
 */
export type JudgeSettings = {
  benchmark: string;
  out: string;
  python: string;
  model: string;
  rejudgeFailed: boolean;
};

type Row = {
  question_id: string;
  answer_correct: boolean;
  completeness_pct: number;
  correctness_reasoning?: string;
};

/** The score: completeness where the answer is correct, else 0, averaged over every row. */
export const scoreOf = (rows: readonly Row[]): number =>
  rows.length === 0
    ? 0
    : rows.reduce((t, r) => t + (r.answer_correct ? r.completeness_pct : 0), 0) / rows.length;

const failedRows = (rows: readonly Row[]): string[] =>
  rows.filter((r) => !(r.correctness_reasoning ?? "").trim()).map((r) => r.question_id);

export function judge(s: JudgeSettings): void {
  for (const mode of ["raw", "corrected"] as const) {
    const first = evaluate(s, mode, join(s.out, "answers.jsonl"));
    const failed = failedRows(first);
    const rows = failed.length > 0 && s.rejudgeFailed ? rejudged(s, mode, first) : first;
    const replaced = rows.filter((r, i) => r !== first[i]).length;
    const left = failedRows(rows);
    console.log(
      `${mode}: ${scoreOf(rows).toFixed(2)} over ${rows.length} questions` +
        (replaced > 0
          ? `, ${replaced} failed judge row(s) judged again (${scoreOf(first).toFixed(2)} without)`
          : "") +
        (left.length > 0 ? `; ${left.length} failed judge row(s) scored 0: ${left.join(" ")}` : ""),
    );
  }
  console.log(
    "Two runs of one configuration have differed by about 1.5 points: one run is one draw.",
  );
}

/** The failed rows asked again, each replaced only by an answer that came back with reasoning. */
function rejudged(s: JudgeSettings, mode: "raw" | "corrected", rows: Row[]): Row[] {
  const wanted = new Set(failedRows(rows));
  const answers = readFileSync(join(s.out, "answers.jsonl"), "utf8")
    .split("\n")
    .filter((l) => l.trim());
  const subset = join(s.out, `answers.rejudge.${mode}.jsonl`);
  writeFileSync(
    subset,
    `${answers.filter((l) => wanted.has((JSON.parse(l) as Row).question_id)).join("\n")}\n`,
  );
  const again = new Map(evaluate(s, mode, subset).map((r) => [r.question_id, r]));
  return rows.map((r) => {
    const fresh = again.get(r.question_id);
    return fresh && (fresh.correctness_reasoning ?? "").trim() ? fresh : r;
  });
}

function evaluate(s: JudgeSettings, mode: "raw" | "corrected", answers: string): Row[] {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY is not set: the evaluator's judge needs it");
  const tag = `${mode}${answers.includes("rejudge") ? ".rejudge" : ""}`;
  const results = join(s.out, `results.${tag}.json`);
  const args = [
    "-u",
    "-m",
    "src.scripts.answer_evaluation.metrics_based_eval",
    "--answers-file",
    answers,
  ];
  args.push("--questions-file", "questions.jsonl", "--results-file", results, "--parallelism", "4");
  args.push("--updated-questions-file", join(s.out, `questions_updated.${tag}.jsonl`));
  args.push("--uuid-index-cache-file", join(s.out, "uuid-index.json"));
  if (mode === "raw") args.push("--no-correction");
  const env = {
    PATH: process.env.PATH ?? "",
    HOME: process.env.HOME ?? "",
    LLM_PROVIDER: "anthropic",
  };
  const llm = { LLM_API_KEY: key, LLM_MODEL_NAME: s.model, CHEAP_LLM_MODEL_NAME: s.model };
  const run = spawnSync(s.python, args, {
    cwd: s.benchmark,
    stdio: ["ignore", "inherit", "inherit"],
    env: { ...env, ...llm },
  });
  if (run.status !== 0)
    throw new Error(`the evaluator exited ${run.status ?? run.signal} (${mode})`);
  return (JSON.parse(readFileSync(results, "utf8")) as { questions: Row[] }).questions;
}
