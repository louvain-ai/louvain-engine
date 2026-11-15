import type { Usage } from "../model.js";

/** The loop's limits and the harness's injections, as the scored flags set them. */
export type LoopSettings = {
  maxTurns: number;
  questionMs: number;
  answerReserveMs: number;
  toolChars: number;
  floor: { searches: number; reads: number; times: number };
  excludeMax: number;
  asOf: string;
};

/**
 * `--max-turns 12 --floor-all --floor-searches 3 --floor-reads 3 --floor-max 2 --exclude-seen --answer-reserve-ms
 * 45000`, 180 s a question, results cut at 30,000 characters, every search as of 2031-01-01.
 */
export const SCORED_LOOP: LoopSettings = {
  maxTurns: 12,
  questionMs: 180_000,
  answerReserveMs: 45_000,
  toolChars: 30_000,
  floor: { searches: 3, reads: 3, times: 2 },
  excludeMax: 200,
  asOf: "2031-01-01",
};

export type Question = { question_id: string; question: string };

/** One tool call as the trace keeps it: what was asked, what it listed, and what the server was not sent. */
export type Step = {
  turn: number;
  tool: string;
  args: Record<string, unknown>;
  stripped?: string[];
  questionFrom?: "model" | "harness";
  excluded?: number;
  hits: string[];
  chars: number;
  capped: boolean;
  degraded?: string[];
  error?: string;
  ms: number;
};

export type Outcome = {
  question_id: string;
  answer: string;
  document_ids: string[];
  turns: number;
  usage: Usage;
  stopped: "answered" | "max_turns" | "wall" | "error";
  forcedFinal: boolean;
  nudged: boolean;
  floorReminders: number;
  citedFrom: "answer" | "read" | "all";
  latencyMs: number;
  error?: string;
  steps: Step[];
};
