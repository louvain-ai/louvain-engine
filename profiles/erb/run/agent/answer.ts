import { documentIds } from "../keys.js";
import { takes } from "../tools/offer.js";
import type { Agent } from "./agent.js";
import { askingOf } from "./asking.js";
import { clockOf } from "./clock.js";
import { askTurns } from "./turns.js";
import type { Outcome, Question } from "./types.js";

/**
 * One question, asked as the scored harness asked it: the system text, the turns, then the answer settled. A citation
 * counts only if a tool returned its id; with none, the documents opened stand for it, else everything returned.
 */
export async function answerOne(question: Question, a: Agent): Promise<Outcome> {
  const started = performance.now();
  const s = askingOf(question, systemText(a));
  const { final, error, ...ending } = await askTurns(s, a, clockOf(a.loop, started));
  const cited = [...final.matchAll(/\[src:([^\]\s]+)\]/g)]
    .map((m) => m[1] ?? "")
    .filter((id, i, all) => s.returned.includes(id) && all.indexOf(id) === i);
  const citedFrom = cited.length > 0 ? "answer" : s.read.length > 0 ? "read" : "all";
  const sent = { answer: cited, read: s.read, all: s.returned }[citedFrom];
  return {
    question_id: question.question_id,
    answer: final.replace(/\s*\[src:[^\]]+\]/g, "").trim(),
    document_ids: await documentIds(a.keys, sent),
    ...ending,
    usage: s.usage,
    citedFrom,
    latencyMs: Math.round(performance.now() - started),
    ...(error ? { error } : {}),
    steps: s.steps,
  };
}

/** The harness's base text, the question line where the search takes `question`, and the guidance, joined by spaces. */
function systemText(a: Agent): string {
  const asksQuestion = takes(a.texts.tools, "louvain_search_sources", "question");
  return [a.texts.base, asksQuestion ? a.texts.questionLine : "", a.texts.guidance]
    .filter(Boolean)
    .join(" ");
}
