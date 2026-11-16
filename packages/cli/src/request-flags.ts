/**
 * A source's request is its command line: each field of its schema is a `--flag`, typed as the schema types it (read from
 * zod's own JSON Schema) and described in `--help` by its `.describe()`. The values go to the schema whole, so a wrong
 * one is refused in zod's words, by the one rule for a source that ships and a source a person wrote.
 */
import type { ParseArgsOptionsConfig } from "node:util";
import { z } from "zod";

/** One field of a request, as a flag. */
export type Field = {
  name: string;
  /** How the flag is read: a value, or present or not. */
  type: "string" | "boolean";
  /** Given more than once, it is a list. */
  multiple: boolean;
  /** Its values are numbers, read from what was typed. */
  numeric: boolean;
  required: boolean;
  description: string | undefined;
};

type Property = { type?: string; description?: string; items?: { type?: string } };

const isNumber = (type: string | undefined) => type === "number" || type === "integer";

/** The request's fields: the properties of the schema's JSON Schema, which a request that is not an object has none of. */
export function fieldsOf(request: z.ZodType): Field[] {
  const json = z.toJSONSchema(request, { io: "input", unrepresentable: "any" }) as {
    properties?: Record<string, Property>;
    required?: string[];
  };
  const required = new Set(json.required ?? []);
  return Object.entries(json.properties ?? {}).map(([name, p]) => ({
    name,
    type: p.type === "boolean" ? "boolean" : "string",
    multiple: p.type === "array",
    numeric: isNumber(p.type) || isNumber(p.items?.type),
    required: required.has(name),
    description: p.description,
  }));
}

/** The fields as `parseArgs` options. */
export const optionsOf = (fields: readonly Field[]): ParseArgsOptionsConfig =>
  Object.fromEntries(fields.map((f) => [f.name, { type: f.type, multiple: f.multiple }]));

/** The request the flags given make: each field typed, a numeric one read as a number for the schema to judge. */
export function requestOf(
  fields: readonly Field[],
  values: Readonly<Record<string, string | boolean | (string | boolean)[] | undefined>>,
): Record<string, unknown> {
  const request: Record<string, unknown> = {};
  for (const { name, numeric } of fields) {
    const value = values[name];
    if (value === undefined) continue;
    request[name] = numeric ? (Array.isArray(value) ? value.map(Number) : Number(value)) : value;
  }
  return request;
}

/** One line a field: its flag, and what it is, from the schema's description. */
export function helpOf(fields: readonly Field[]): string[] {
  const flag = (f: Field) => `--${f.name}${f.type === "string" ? " <value>" : ""}`;
  const width = Math.max(0, ...fields.map((f) => flag(f).length));
  return fields.map((f) => {
    const what = [
      f.description,
      f.required ? "required" : undefined,
      f.multiple ? "repeatable" : undefined,
    ]
      .filter(Boolean)
      .join("; ");
    return `  ${flag(f).padEnd(width)}  ${what}`.trimEnd();
  });
}
