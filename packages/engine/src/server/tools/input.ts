/**
 * A tool call's arguments, parsed once by the very schema `tools/list` serves (`openToolArgs`): an argument the tool
 * does not declare is refused by name, never dropped (dropped, a filter would return an unfiltered page as if it had
 * matched), and a wrong one is refused with a sentence naming the argument and what it takes.
 */
import type { z } from "zod";
import { ToolInputError } from "./arguments.js";
import { openToolArgs } from "./schema.js";

type Issue = z.core.$ZodIssue;

/** The arguments `name` declares, parsed; an argument left `undefined` is as if it were not sent. */
export function toolArgs(
  name: string,
  args: Record<string, unknown>,
  settings: Parameters<typeof openToolArgs>[1],
): Record<string, unknown> {
  const schema = openToolArgs(name, settings);
  if (!schema) throw new Error(`unknown tool: ${name}`);
  const asked = Object.fromEntries(Object.entries(args).filter(([, v]) => v !== undefined));
  const result = schema.safeParse(asked);
  if (result.success) return result.data;
  const stray = result.error.issues.find((i) => i.code === "unrecognized_keys");
  if (stray)
    throw new ToolInputError(
      `${name} has no ${stray.keys.map((key) => `"${key}"`).join(", ")} argument here; it takes ${Object.keys(schema.shape).join(", ")}.`,
    );
  const issue = result.error.issues[0];
  throw new ToolInputError(
    `${name}: ${issue ? sentenceOf(issue, asked) : "its arguments are not valid."}`,
  );
}

/** One refusal as a sentence: the argument by name, what it takes, and what it was given. */
function sentenceOf(issue: Issue, asked: Record<string, unknown>): string {
  const [arg, item] = issue.path;
  const key = String(arg ?? "");
  const given = asked[key];
  if (given === undefined) return `a "${key}" is required.`;
  if (item !== undefined)
    return `"${key}" must be a list of text ids; item ${Number(item) + 1} is not one.`;
  if (issue.code === "invalid_type")
    return `"${key}" must be ${kind(issue.expected)}, not ${shown(given)}.`;
  if (issue.code === "invalid_value")
    return `"${key}" must be one of ${issue.values.map((v) => `"${String(v)}"`).join(", ")}, not ${shown(given)}.`;
  if (issue.code === "too_big") return `"${key}" holds at most ${String(issue.maximum)} items.`;
  if (issue.code === "invalid_format")
    return `"${key}" must be a ${issue.format}, not ${shown(given)}.`;
  if (issue.code === "invalid_union")
    return `"${key}" must be ${formsOf(issue)}, not ${shown(given)}.`;
  return `"${key}" is not valid here (${issue.message}).`;
}

/** The forms a union accepts, as its branches' formats say them ("a date or a date-time"). */
function formsOf(issue: Extract<Issue, { code: "invalid_union" }>): string {
  const forms = issue.errors.flatMap((branch) =>
    branch.flatMap((i) => (i.code === "invalid_format" ? [`a ${i.format}`] : [])),
  );
  return forms.length > 0 ? forms.join(" or ") : "one of the forms the schema allows";
}

const KINDS: Record<string, string> = {
  string: "text",
  number: "a number",
  array: "a list",
  boolean: "true or false",
};
const kind = (expected: string): string => KINDS[expected] ?? expected;

/** What a caller sent, said briefly: its type, and a short value where one helps. */
function shown(value: unknown): string {
  if (Array.isArray(value)) return "a list";
  if (value === null) return "null";
  if (typeof value === "string")
    return `the text "${value.length > 40 ? `${value.slice(0, 39)}…` : value}"`;
  if (typeof value === "number" || typeof value === "boolean")
    return `${typeof value} ${String(value)}`;
  return typeof value;
}
