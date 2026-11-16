import type { Sent } from "./statements.js";

/**
 * The shape of a plan: `EXPLAIN (FORMAT JSON)` of a statement as it was sent (its values, under the `set local`
 * settings that were in force), reduced to its node types and the relations and indexes they read, without a cost or
 * a row count. On a corpus of a few dozen rows a planner's choice is a weak signal, so a changed shape is reported,
 * and a fenced read whose scan of some table changes kind is named (`scansOf`); neither fails.
 */
type PlanNode = {
  "Node Type": string;
  "Relation Name"?: string;
  "Index Name"?: string;
  Plans?: PlanNode[];
};

type Unsafe = {
  unsafe: (text: string, values?: unknown[]) => Promise<Record<string, unknown>[]>;
};
type Driver = { begin: <T>(fn: (tx: Unsafe) => Promise<T>) => Promise<T> };

const nodeName = (n: PlanNode) =>
  [
    n["Node Type"],
    n["Relation Name"] && `on ${n["Relation Name"]}`,
    n["Index Name"] && `using ${n["Index Name"]}`,
  ]
    .filter(Boolean)
    .join(" ");

function shape(n: PlanNode): string {
  const below = (n.Plans ?? []).map(shape);
  if (below.length === 0) return nodeName(n);
  if (below.length === 1) return `${nodeName(n)} > ${below[0]}`;
  return `${nodeName(n)} (${below.join(", ")})`;
}

/** The plan's shape, or why there is none: a setting has no plan, and a statement Postgres cannot explain says so. */
export async function planOf(sql: unknown, s: Sent): Promise<string | null> {
  if (/^\s*set\b/i.test(s.text)) return null;
  try {
    const rows = await (sql as Driver).begin(async (tx) => {
      if (s.preamble) await tx.unsafe(s.preamble);
      return tx.unsafe(`explain (format json) ${s.text}`, s.values);
    });
    const [plan] = (rows[0]?.["QUERY PLAN"] ?? []) as { Plan: PlanNode }[];
    return plan ? shape(plan.Plan) : "none";
  } catch (err) {
    return `not explained (${err instanceof Error ? err.message.split("\n")[0] : "unknown"})`;
  }
}

/** Each table a plan scans, with the kinds of scan, as `table: Seq Scan, Index Scan`. */
export function scansOf(plan: string | null): string[] {
  const found = [...(plan ?? "").matchAll(/([A-Z][\w ]*Scan) on (\w+)/g)].map(
    ([, kind, table]) => `${table}: ${kind}`,
  );
  return [...new Set(found)].sort();
}
