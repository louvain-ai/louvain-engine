import type { LoopSettings } from "./types.js";

/**
 * One question's time: 180 s from its start. Every model and tool call is aborted at the deadline, and within the
 * reserve before it the next turn is the last, with tools withheld.
 */
export type Clock = { until(): AbortSignal; late(): boolean; past(): boolean };

export function clockOf(loop: LoopSettings, started: number = performance.now()): Clock {
  const deadline = started + loop.questionMs;
  return {
    until: () => AbortSignal.timeout(Math.floor(Math.max(1_000, deadline - performance.now()))),
    late: () => loop.answerReserveMs > 0 && performance.now() > deadline - loop.answerReserveMs,
    past: () => performance.now() > deadline,
  };
}
