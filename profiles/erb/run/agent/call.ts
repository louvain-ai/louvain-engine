import type { Call } from "../blocks.js";
import type { CallResult } from "../tools/mcp.js";
import { forServer, takes } from "../tools/offer.js";
import { degradedOf, hitsOf, idsIn } from "../tools/result.js";
import type { Agent } from "./agent.js";
import type { Asking } from "./asking.js";
import type { Clock } from "./clock.js";
import type { Step } from "./types.js";

/** A question being asked: its state, what it is asked with, and its clock. */
export type Ask = { s: Asking; a: Agent; clock: Clock };

/**
 * One tool call, as the scored harness made it: each search as of the run's date, with the person's question when the
 * model left it out, and leaving out (`exclude`) what earlier searches listed. The model is never told of the last.
 * The result goes back cut at the loop's limit; a call that fails is answered with why, and the loop goes on.
 */
export async function callTool({ s, a, clock }: Ask, call: Call, turn: number): Promise<void> {
  const started = performance.now();
  const { args, ...filled } = injected(s, a, call);
  const sent = forServer(a.served, call.name, args);
  const step: Step = {
    turn,
    tool: call.name,
    args,
    ...filled,
    hits: [],
    chars: 0,
    capped: false,
    ms: 0,
  };
  if (sent.stripped.length > 0) step.stripped = sent.stripped;
  let content: string;
  try {
    const result = await a.server.call(call.name, sent.args, clock.until());
    content = recorded(s, step, result);
  } catch (err) {
    step.error = String(err).slice(0, 300);
    content = `The tool failed: ${step.error}`;
  }
  Object.assign(step, { chars: content.length, capped: content.length > a.loop.toolChars });
  step.ms = Math.round(performance.now() - started);
  s.steps.push(step);
  s.chat.user({
    type: "tool_result",
    tool_use_id: call.id,
    content: content.slice(0, a.loop.toolChars),
  });
}

/** What a result listed, said ran degraded and returned, and the document a read opened; its text goes back. */
function recorded(s: Asking, step: Step, result: CallResult): string {
  step.hits = hitsOf(step.tool, result.structured);
  const degraded = degradedOf(result.structured);
  if (degraded.length > 0) step.degraded = degraded;
  for (const id of idsIn(result.structured)) if (!s.returned.includes(id)) s.returned.push(id);
  const opened = step.args.sourceId;
  const read = step.tool === "louvain_read_source" && typeof opened === "string";
  if (read && !s.read.includes(opened)) s.read.push(opened);
  return result.text;
}

/** The arguments as the harness sent them, and what it filled in. */
function injected(
  s: Asking,
  a: Agent,
  call: Call,
): Pick<Step, "args" | "questionFrom" | "excluded"> {
  const scored = a.texts.tools;
  const args = { ...call.input };
  const filled: Pick<Step, "questionFrom" | "excluded"> = {};
  if (takes(scored, call.name, "asOf") && args.asOf === undefined) args.asOf = a.loop.asOf;
  if (takes(scored, call.name, "question")) {
    const asked = typeof args.question === "string" && args.question.trim().length > 0;
    filled.questionFrom = asked ? "model" : "harness";
    if (!asked) args.question = s.question.question;
  }
  if (takes(scored, call.name, "exclude") && args.exclude === undefined) {
    const listed = s.steps.filter((p) => p.tool === call.name).flatMap((p) => p.hits);
    const seen = [...new Set(listed)].slice(0, a.loop.excludeMax);
    if (seen.length > 0) {
      args.exclude = seen;
      filled.excluded = seen.length;
    }
  }
  return { args, ...filled };
}
