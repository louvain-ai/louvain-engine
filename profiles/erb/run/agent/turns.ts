import { callsOf, textOf } from "../blocks.js";
import type { Block } from "../model.js";
import type { Agent } from "./agent.js";
import type { Asking } from "./asking.js";
import { type Ask, callTool } from "./call.js";
import type { Clock } from "./clock.js";
import type { LoopSettings, Outcome, Step } from "./types.js";

/**
 * The turns of one question. A turn re-sends the whole conversation, every earlier result whole. The last turn (the
 * 12th, or the first inside the reserve) withholds tools and, past the first turn, is told it is the last. An early
 * answer is set aside under the floor; a last turn with no words is nudged once. Calls run one at a time, in order.
 */
export type Ending = Pick<
  Outcome,
  "stopped" | "turns" | "forcedFinal" | "nudged" | "floorReminders"
> & {
  final: string;
  error?: string;
};

export async function askTurns(s: Asking, a: Agent, clock: Clock): Promise<Ending> {
  const q: Ask = { s, a, clock };
  const end: Ending = {
    final: "",
    stopped: "max_turns",
    turns: 0,
    forcedFinal: false,
    nudged: false,
    floorReminders: 0,
  };
  try {
    await turns(q, end);
    if (end.stopped === "max_turns" && !end.final.trim() && !clock.past()) {
      end.nudged = true;
      s.chat.say(a.texts.nudge);
      end.final = textOf(await modelTurn(q, true));
      if (end.final.trim()) end.stopped = "answered";
    }
  } catch (err) {
    end.stopped = err instanceof Error && err.name === "TimeoutError" ? "wall" : "error";
    end.error = String(err).slice(0, 300);
  }
  return end;
}

async function turns(q: Ask, end: Ending): Promise<void> {
  const { s, a, clock } = q;
  while (end.turns < a.loop.maxTurns) {
    if (clock.past()) {
      end.stopped = "wall";
      return;
    }
    end.turns += 1;
    const last = end.turns === a.loop.maxTurns || clock.late();
    if (last && end.turns > 1) s.chat.say(a.texts.lastCall);
    const reply = await modelTurn(q, last);
    const calls = callsOf(reply);
    const owed = calls.length === 0 && !last ? floorOwed(s.steps, a.loop, end) : null;
    if (owed) {
      end.floorReminders += 1;
      s.chat.say(
        a.texts.floor({
          ...owed,
          floorSearches: a.loop.floor.searches,
          floorReads: a.loop.floor.reads,
        }),
      );
    } else if (calls.length === 0 || last) {
      end.forcedFinal = last && end.turns > 1;
      end.final = textOf(reply);
      end.stopped = end.final.trim() ? "answered" : "max_turns";
      return;
    } else {
      s.chat.assistant(reply);
      for (const call of calls) await callTool(q, call, end.turns);
    }
  }
}

async function modelTurn({ s, a, clock }: Ask, last: boolean): Promise<Block[]> {
  const turn = { system: s.system, messages: s.chat.messages, tools: a.offered, final: last };
  const reply = await a.model(turn, clock.until());
  for (const k of ["input", "output", "cacheRead", "cacheWrite"] as const)
    s.usage[k] += reply.usage[k];
  return reply.content;
}

/**
 * The floor: an answer offered before 3 distinct searches and 3 distinct documents opened is set aside, at most twice
 * a question and never in the last two turns. Returns what has been done when the floor is owed, else null.
 */
export function floorOwed(
  steps: readonly Step[],
  loop: LoopSettings,
  at: Pick<Ending, "turns" | "floorReminders">,
): { searches: number; reads: number } | null {
  if (at.floorReminders >= loop.floor.times || at.turns >= loop.maxTurns - 2) return null;
  const distinct = (tool: string, arg: string, fold: (v: string) => string) =>
    new Set(steps.filter((p) => p.tool === tool).map((p) => fold(String(p.args[arg] ?? "")))).size;
  const searches = distinct("louvain_search_sources", "query", (v) => v.trim().toLowerCase());
  const reads = distinct("louvain_read_source", "sourceId", (v) => v);
  return searches < loop.floor.searches || reads < loop.floor.reads ? { searches, reads } : null;
}
